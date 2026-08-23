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
import { QuoteHoldService } from "../application/quote-hold-service.js";
import { QuoteService } from "../application/quote-service.js";
import type { QuoteUnitRequest } from "../domain/quote.js";

export interface QuoteRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface QuoteParams extends PropertyParams {
  quoteId: string;
}

interface CreateQuoteBody extends JsonObject {
  rateProductId: string;
  arrivalDate: string;
  departureDate: string;
  ttlSeconds?: number;
  promotionCode?: string | null;
  units: QuoteUnitRequest[];
}

const propertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

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

export async function registerQuoteRoutes(
  app: FastifyInstance,
  deps: QuoteRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new QuoteService();
  const holdService = new QuoteHoldService();

  app.post<{ Params: PropertyParams; Body: CreateQuoteBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quotes",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quotes"],
        summary: "Create an immutable quote snapshot",
        description:
          "Creates an immutable availability and price snapshot. Commercial tax, fee, guest-age and cancellation rules are snapshotted first; when promotion settings are explicitly configured, automatic or requested promotions are evaluated into a separate immutable final-pricing extension and the quote becomes hold-eligible.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rateProductId", "arrivalDate", "departureDate", "units"],
          properties: {
            rateProductId: { type: "string", format: "uuid" },
            arrivalDate: { type: "string", format: "date" },
            departureDate: { type: "string", format: "date" },
            ttlSeconds: { type: "integer", minimum: 60, maximum: 1800, default: 900 },
            promotionCode: {
              anyOf: [
                {
                  type: "string",
                  minLength: 3,
                  maxLength: 40,
                  pattern: "^[A-Za-z0-9_-]+$"
                },
                { type: "null" }
              ]
            },
            units: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["adults", "childAges"],
                properties: {
                  adults: { type: "integer", minimum: 1, maximum: 100 },
                  childAges: {
                    type: "array",
                    maxItems: 100,
                    items: { type: "integer", minimum: 0, maximum: 17 }
                  }
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
        rateProductId: request.body.rateProductId,
        arrivalDate: request.body.arrivalDate,
        departureDate: request.body.departureDate,
        ttlSeconds: request.body.ttlSeconds ?? 900,
        promotionCode: request.body.promotionCode ?? null,
        units: request.body.units
      };

      const result = await idempotency.execute(
        {
          scopeKey: `quote.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createQuote(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              ...body
            },
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: QuoteParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quotes/:quoteId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quotes"],
        summary: "Get an immutable quote snapshot",
        security: [{ bearerAuth: [] }],
        params: quoteParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      return deps.db
        .transaction()
        .execute((trx) =>
          service.getQuote(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.quoteId
          )
        );
    }
  );

  app.post<{ Params: QuoteParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quotes/:quoteId/hold",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quotes"],
        summary: "Atomically convert a final quote into an inventory hold",
        description:
          "Locks the immutable quote, verifies final commercial completeness and expiry, revalidates live canonical inventory, creates one inventory hold, and persists an immutable quote-to-hold link. Repeated commands for the same quote return the existing active hold.",
        security: [{ bearerAuth: [] }],
        params: quoteParamsSchema,
        headers: idempotencyHeaders
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const requestBody = { quoteId: request.params.quoteId };

      const result = await idempotency.execute(
        {
          scopeKey: `quote.hold.create:${request.params.quoteId}:user:${actor.userId}`,
          key,
          requestBody
        },
        async (trx) => {
          const body = await holdService.createFromQuote(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              quoteId: request.params.quoteId
            },
            requestMetadata(request, "partner-api")
          );
          return { statusCode: body.created ? 201 : 200, body };
        }
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );
}
