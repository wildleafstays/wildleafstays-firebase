import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { RazorpayOrderService } from "../application/razorpay-order-service.js";
import type { RazorpayProvider } from "../infrastructure/razorpay-provider.js";
import { BeginPaymentService } from "../../reservations/application/begin-payment-service.js";

export interface PaymentRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
  razorpayProvider: RazorpayProvider | null;
}

interface ReservationParams {
  organizationId: string;
  propertyId: string;
  reservationId: string;
}

interface PaymentIntentParams extends ReservationParams {
  paymentIntentId: string;
}

const reservationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "reservationId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    reservationId: { type: "string", format: "uuid" }
  }
} as const;

const paymentIntentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "reservationId", "paymentIntentId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    reservationId: { type: "string", format: "uuid" },
    paymentIntentId: { type: "string", format: "uuid" }
  }
} as const;

const idempotencyHeaders = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 8,
      maxLength: 200,
      pattern: "^[A-Za-z0-9._:-]+$"
    }
  }
} as const;

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const key = headers["idempotency-key"];
  if (typeof key !== "string") {
    throw new ValidationError("Idempotency key is required");
  }
  return key;
}

export async function registerPaymentRoutes(
  app: FastifyInstance,
  deps: PaymentRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new BeginPaymentService();
  const razorpayOrders = deps.razorpayProvider
    ? new RazorpayOrderService(deps.db, deps.razorpayProvider)
    : null;

  app.post<{ Params: ReservationParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reservations/:reservationId/payment-intent",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Payments"],
        summary: "Begin payment for a HELD reservation",
        description:
          "Creates one provider-neutral payment intent from the immutable reservation amount and currency, then moves the reservation from HELD to PAYMENT_PENDING atomically. It does not call Razorpay or any other payment provider and does not confirm inventory.",
        security: [{ bearerAuth: [] }],
        params: reservationParamsSchema,
        headers: idempotencyHeaders
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `payment.begin:${request.params.reservationId}:user:${actor.userId}`,
          key,
          requestBody: {}
        },
        async (trx) => {
          const response = await service.beginPayment(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              reservationId: request.params.reservationId
            },
            requestMetadata(request, "partner-api")
          );
          return { statusCode: response.created ? 201 : 200, body: response };
        }
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: PaymentIntentParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reservations/:reservationId/payment-intents/:paymentIntentId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Payments"],
        summary: "Get a reservation payment intent",
        security: [{ bearerAuth: [] }],
        params: paymentIntentParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      return deps.db.transaction().execute((trx) =>
        service.getPaymentIntent(trx, actor, {
          organizationId: request.params.organizationId,
          propertyId: request.params.propertyId,
          reservationId: request.params.reservationId,
          paymentIntentId: request.params.paymentIntentId
        })
      );
    }
  );
  if (razorpayOrders) {
    app.put<{ Params: PaymentIntentParams }>(
      "/v1/partner/organizations/:organizationId/properties/:propertyId/reservations/:reservationId/payment-intents/:paymentIntentId/razorpay-order",
      {
        preHandler: authenticate,
        schema: {
          tags: ["Payments"],
          summary: "Prepare or resume Razorpay checkout for a payment intent",
          description:
            "Creates or reuses one server-owned Razorpay order for the immutable PENDING payment intent. The operation is idempotent by payment intent and deterministic Razorpay receipt. It never accepts amount, currency or provider order identity from the client.",
          security: [{ bearerAuth: [] }],
          params: paymentIntentParamsSchema
        }
      },
      async (request, reply) => {
        const actor = request.actor;
        if (!actor) throw new AuthenticationError();

        const result = await razorpayOrders.prepareCheckout(
          actor,
          {
            organizationId: request.params.organizationId,
            propertyId: request.params.propertyId,
            reservationId: request.params.reservationId,
            paymentIntentId: request.params.paymentIntentId
          },
          requestMetadata(request, "partner-api")
        );

        return reply.status(result.created ? 201 : 200).send(result);
      }
    );
  }
}
