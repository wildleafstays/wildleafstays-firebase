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
import { PaymentFinanceReadService } from "../application/payment-finance-read-service.js";
import { PaymentRefundCommandService } from "../application/payment-refund-command-service.js";
import { RazorpayWebhookService } from "../application/razorpay-webhook-service.js";
import { registerRazorpayWebhookRoutes } from "./razorpay-webhook-routes.js";
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

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface ReconciliationParams extends PropertyParams {
  reconciliationCaseId: string;
}

interface ReconciliationListQuery {
  status?: "OPEN" | "RESOLVED";
  requiredAction?: "REFUND_REQUIRED" | "MANUAL_REVIEW";
  reasonCode?:
    | "INVENTORY_HOLD_EXPIRED"
    | "INVENTORY_HOLD_NOT_ACTIVE"
    | "INVENTORY_HOLD_UNAVAILABLE"
    | "RESERVATION_STATE_MISMATCH"
    | "DUPLICATE_VERIFIED_PAYMENT";
  limit?: number;
  cursor?: string;
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

const propertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const reconciliationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "reconciliationCaseId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    reconciliationCaseId: { type: "string", format: "uuid" }
  }
} as const;

const reconciliationListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["OPEN", "RESOLVED"] },
    requiredAction: { type: "string", enum: ["REFUND_REQUIRED", "MANUAL_REVIEW"] },
    reasonCode: {
      type: "string",
      enum: [
        "INVENTORY_HOLD_EXPIRED",
        "INVENTORY_HOLD_NOT_ACTIVE",
        "INVENTORY_HOLD_UNAVAILABLE",
        "RESERVATION_STATE_MISMATCH",
        "DUPLICATE_VERIFIED_PAYMENT"
      ]
    },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9_-]+$" }
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
  const financeRead = new PaymentFinanceReadService();
  const refundCommand = deps.razorpayProvider
    ? new PaymentRefundCommandService(deps.db, deps.razorpayProvider)
    : null;
  const razorpayOrders = deps.razorpayProvider
    ? new RazorpayOrderService(deps.db, deps.razorpayProvider)
    : null;
  const razorpayWebhook = deps.razorpayProvider
    ? new RazorpayWebhookService(deps.db, deps.razorpayProvider)
    : null;

  if (razorpayWebhook) {
    await registerRazorpayWebhookRoutes(app, razorpayWebhook);
  }

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

  app.get<{ Params: ReservationParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reservations/:reservationId/payment-history",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Payments"],
        summary: "Get finance payment history for a reservation",
        description:
          "Returns the server-owned payment, verified evidence, reconciliation and refund lifecycle for one reservation. Provider payload hashes and refund idempotency keys are deliberately not exposed.",
        security: [{ bearerAuth: [] }],
        params: reservationParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      return deps.db.transaction().execute((trx) =>
        financeRead.getReservationPaymentHistory(trx, actor, {
          organizationId: request.params.organizationId,
          propertyId: request.params.propertyId,
          reservationId: request.params.reservationId
        })
      );
    }
  );

  app.get<{ Params: PropertyParams; Querystring: ReconciliationListQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/payment-reconciliations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Payments"],
        summary: "List payment reconciliation cases for finance operations",
        description:
          "Returns a read-only, cursor-paginated reconciliation queue scoped to one property. Filters never mutate payment, reservation, inventory or refund state.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        querystring: reconciliationListQuerySchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      return deps.db.transaction().execute((trx) =>
        financeRead.listReconciliations(trx, actor, {
          organizationId: request.params.organizationId,
          propertyId: request.params.propertyId,
          filters: request.query
        })
      );
    }
  );

  app.get<{ Params: ReconciliationParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/payment-reconciliations/:reconciliationCaseId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Payments"],
        summary: "Get payment reconciliation detail",
        description:
          "Returns verified payment evidence plus the complete immutable refund request, submission, provider-event and finalization history for one reconciliation case.",
        security: [{ bearerAuth: [] }],
        params: reconciliationParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      return deps.db.transaction().execute((trx) =>
        financeRead.getReconciliationDetail(trx, actor, {
          organizationId: request.params.organizationId,
          propertyId: request.params.propertyId,
          reconciliationCaseId: request.params.reconciliationCaseId
        })
      );
    }
  );
  if (refundCommand) {
    app.post<{ Params: ReconciliationParams }>(
      "/v1/partner/organizations/:organizationId/properties/:propertyId/payment-reconciliations/:reconciliationCaseId/refund-submission",
      {
        preHandler: authenticate,
        schema: {
          tags: ["Payments"],
          summary: "Submit or resume the canonical refund for a reconciliation case",
          description:
            "Requires settlement.manage. The server resolves the immutable refund request from the reconciliation case and never accepts amount, currency, provider payment identity, provider refund identity or provider idempotency identity from the client. Repeated commands reuse the existing non-failed attempt; a new provider attempt is permitted only after a verified failed refund lifecycle.",
          security: [{ bearerAuth: [] }],
          params: reconciliationParamsSchema
        }
      },
      async (request, reply) => {
        const actor = request.actor;
        if (!actor) throw new AuthenticationError();

        const result = await refundCommand.submit(
          actor,
          {
            organizationId: request.params.organizationId,
            propertyId: request.params.propertyId,
            reconciliationCaseId: request.params.reconciliationCaseId
          },
          requestMetadata(request, "partner-api")
        );

        return reply.status(result.created ? 201 : 200).send(result);
      }
    );
  }

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
