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
import { InventoryAllocationService } from "../application/inventory-allocation-service.js";

export interface InventoryAllocationRouteDependencies {
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

interface AllocationParams extends PropertyParams {
  allocationId: string;
}

interface ConfirmHoldBody extends JsonObject {
  confirmationReference: string;
}

interface ReleaseAllocationBody extends JsonObject {
  releaseReason: string;
}

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

const allocationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "allocationId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    allocationId: { type: "string", format: "uuid" }
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

export async function registerInventoryAllocationRoutes(
  app: FastifyInstance,
  deps: InventoryAllocationRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new InventoryAllocationService();

  app.post<{ Params: HoldParams; Body: ConfirmHoldBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/holds/:holdId/confirm",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Allocations"],
        summary: "Convert an active hold into confirmed inventory",
        security: [{ bearerAuth: [] }],
        params: holdParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["confirmationReference"],
          properties: {
            confirmationReference: {
              type: "string",
              minLength: 3,
              maxLength: 200
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
          scopeKey: `inventory.allocation.confirm:${request.params.holdId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.confirmHold(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.holdId,
            request.body.confirmationReference,
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

  app.get<{ Params: AllocationParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/allocations/:allocationId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Allocations"],
        summary: "Get a confirmed inventory allocation",
        security: [{ bearerAuth: [] }],
        params: allocationParamsSchema
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
          service.getAllocation(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.allocationId
          )
        );
    }
  );

  app.post<{ Params: AllocationParams; Body: ReleaseAllocationBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/allocations/:allocationId/release",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory Allocations"],
        summary: "Release confirmed inventory exactly once",
        security: [{ bearerAuth: [] }],
        params: allocationParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["releaseReason"],
          properties: {
            releaseReason: {
              type: "string",
              minLength: 1,
              maxLength: 1000
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
          scopeKey: `inventory.allocation.release:${request.params.allocationId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.releaseAllocation(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.allocationId,
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
