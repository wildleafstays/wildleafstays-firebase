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
import { InventoryHoldService } from "../application/inventory-hold-service.js";
import type { InventoryBucketType } from "../domain/inventory.js";

export interface InventoryHoldRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface HoldParams extends PropertyParams {
  holdId: string;
}

interface HoldItemBody extends JsonObject {
  bucketType: InventoryBucketType;
  roomCategoryId?: string;
  quantity: number;
}

interface CreateHoldBody extends JsonObject {
  startDate: string;
  endDate: string;
  ttlSeconds?: number;
  clientReference?: string;
  items: HoldItemBody[];
}

interface ReleaseHoldBody extends JsonObject {
  releaseReason: string;
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

const holdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "holdId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    holdId: { type: "string", format: "uuid" }
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

export async function registerInventoryHoldRoutes(
  app: FastifyInstance,
  deps: InventoryHoldRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new InventoryHoldService();

  app.post<{ Params: PropertyParams; Body: CreateHoldBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/holds",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Holds"],
        summary: "Atomically place temporary inventory on hold",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["startDate", "endDate", "items"],
          properties: {
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            ttlSeconds: { type: "integer", minimum: 60, maximum: 1800, default: 900 },
            clientReference: { type: "string", minLength: 1, maxLength: 200 },
            items: {
              type: "array",
              minItems: 1,
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["bucketType", "quantity"],
                properties: {
                  bucketType: {
                    type: "string",
                    enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
                  },
                  roomCategoryId: { type: "string", format: "uuid" },
                  quantity: { type: "integer", minimum: 1, maximum: 1000 }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `inventory.hold.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createHold(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              startDate: request.body.startDate,
              endDate: request.body.endDate,
              ttlSeconds: request.body.ttlSeconds ?? 900,
              clientReference: request.body.clientReference ?? null,
              items: request.body.items.map((item) => ({
                bucketType: item.bucketType,
                roomCategoryId: item.roomCategoryId ?? null,
                quantity: item.quantity
              }))
            },
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: HoldParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/holds/:holdId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Holds"],
        summary: "Get an inventory hold and lazily expire it when due",
        security: [{ bearerAuth: [] }],
        params: holdParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      return deps.db
        .transaction()
        .execute((trx) =>
          service.getHold(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.holdId,
            requestMetadata(request, "partner-api")
          )
        );
    }
  );

  app.post<{ Params: HoldParams; Body: ReleaseHoldBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/holds/:holdId/release",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Holds"],
        summary: "Release a temporary inventory hold",
        security: [{ bearerAuth: [] }],
        params: holdParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["releaseReason"],
          properties: {
            releaseReason: { type: "string", minLength: 1, maxLength: 1000 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `inventory.hold.release:${request.params.holdId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.releaseHold(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.holdId,
            request.body.releaseReason,
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );
}
