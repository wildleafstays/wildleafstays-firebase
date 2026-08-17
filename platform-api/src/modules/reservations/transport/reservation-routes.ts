import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { HeldReservationService } from "../application/held-reservation-service.js";

export interface ReservationRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface QuoteParams {
  organizationId: string;
  propertyId: string;
  quoteId: string;
}

interface ReservationParams {
  organizationId: string;
  propertyId: string;
  reservationId: string;
}

interface CreateHeldReservationBody extends JsonObject {
  leadGuest: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
}

const quoteParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "quoteId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    quoteId: { type: "string", format: "uuid" }
  }
} as const;

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

export async function registerReservationRoutes(
  app: FastifyInstance,
  deps: ReservationRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new HeldReservationService();

  app.post<{ Params: QuoteParams; Body: CreateHeldReservationBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quotes/:quoteId/reservation",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Reservations"],
        summary: "Create the canonical HELD reservation from a final quote and active hold",
        description:
          "Creates exactly one canonical HELD reservation from the immutable final quote and its active quote-linked inventory hold. The accepted financial aggregates and lead guest are snapshotted immutably. Inventory remains held; it is deliberately not converted to confirmed allocation before the later payment/confirmation transition.",
        security: [{ bearerAuth: [] }],
        params: quoteParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["leadGuest"],
          properties: {
            leadGuest: {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 160 },
                email: {
                  anyOf: [{ type: "string", minLength: 3, maxLength: 320 }, { type: "null" }]
                },
                phone: {
                  anyOf: [{ type: "string", minLength: 8, maxLength: 24 }, { type: "null" }]
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      const key = requireIdempotencyKey(request.headers);
      const body = {
        leadGuest: {
          name: request.body.leadGuest.name,
          email: request.body.leadGuest.email ?? null,
          phone: request.body.leadGuest.phone ?? null
        }
      };

      const result = await idempotency.execute(
        {
          scopeKey: `reservation.held.create:${request.params.quoteId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => {
          const response = await service.createFromQuoteHold(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              quoteId: request.params.quoteId,
              leadGuest: body.leadGuest
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

  app.get<{ Params: ReservationParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reservations/:reservationId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Reservations"],
        summary: "Get a canonical reservation and its accepted immutable financial snapshot",
        security: [{ bearerAuth: [] }],
        params: reservationParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();

      return deps.db
        .transaction()
        .execute((trx) =>
          service.getReservation(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.reservationId
          )
        );
    }
  );
}
