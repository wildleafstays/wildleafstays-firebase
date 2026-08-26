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
import { InventoryService } from "../application/inventory-service.js";
import type {
  InventoryBlockScope,
  InventoryBlockType,
  InventoryBucketType
} from "../domain/inventory.js";

export interface InventoryRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface BlockParams extends PropertyParams {
  blockId: string;
}

interface AvailabilityQuery {
  startDate: string;
  endDate: string;
}

interface ListBlocksQuery extends AvailabilityQuery {
  includeReleased?: boolean;
}

interface SetControlsBody extends JsonObject {
  bucketType: InventoryBucketType;
  roomCategoryId?: string;
  startDate: string;
  endDate: string;
  stopSell?: boolean;
  overbookingLimit?: number;
  capacityOverride?: number;
}

interface CreateBlockBody extends JsonObject {
  scopeType: InventoryBlockScope;
  roomCategoryId?: string;
  physicalUnitId?: string;
  blockType: InventoryBlockType;
  startDate: string;
  endDate: string;
  quantity?: number;
  reason: string;
}

interface ReleaseBlockBody extends JsonObject {
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

const blockParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "blockId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    blockId: { type: "string", format: "uuid" }
  }
} as const;

const dateQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["startDate", "endDate"],
  properties: {
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" }
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

export async function registerInventoryRoutes(
  app: FastifyInstance,
  deps: InventoryRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new InventoryService();
  const holdService = new InventoryHoldService();

  app.get<{ Params: PropertyParams; Querystring: AvailabilityQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/availability",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory"],
        summary: "Get canonical nightly inventory availability",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        querystring: dateQuerySchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      return deps.db.transaction().execute(async (trx) => {
        await holdService.expireDueForProperty(
          trx,
          actor,
          request.params.organizationId,
          request.params.propertyId,
          requestMetadata(request, "partner-api")
        );

        return service.getAvailability(
          trx,
          actor,
          request.params.organizationId,
          request.params.propertyId,
          request.query.startDate,
          request.query.endDate
        );
      });
    }
  );

  app.put<{ Params: PropertyParams; Body: SetControlsBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/controls",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory"],
        summary: "Set daily inventory capacity, stop-sell or overbooking controls",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["bucketType", "startDate", "endDate"],
          properties: {
            bucketType: {
              type: "string",
              enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
            },
            roomCategoryId: { type: "string", format: "uuid" },
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            stopSell: { type: "boolean" },
            overbookingLimit: { type: "integer", minimum: 0, maximum: 1000 },
            capacityOverride: { type: "integer", minimum: 0, maximum: 1000 }
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
          scopeKey: `inventory.controls:${request.params.propertyId}:${request.body.bucketType}:${request.body.roomCategoryId ?? "FULL"}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setControls(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              bucketType: request.body.bucketType,
              roomCategoryId: request.body.roomCategoryId ?? null,
              startDate: request.body.startDate,
              endDate: request.body.endDate,
              stopSell: request.body.stopSell ?? null,
              overbookingLimit: request.body.overbookingLimit ?? null,
              capacityOverride: request.body.capacityOverride ?? null
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

  app.post<{ Params: PropertyParams; Body: CreateBlockBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/blocks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory"],
        summary: "Create a dated inventory or maintenance block",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["scopeType", "blockType", "startDate", "endDate", "reason"],
          properties: {
            scopeType: {
              type: "string",
              enum: ["PROPERTY", "ROOM_CATEGORY", "PHYSICAL_UNIT"]
            },
            roomCategoryId: { type: "string", format: "uuid" },
            physicalUnitId: { type: "string", format: "uuid" },
            blockType: {
              type: "string",
              enum: [
                "MAINTENANCE",
                "RENOVATION",
                "OWNER_USE",
                "STAFF_USE",
                "REGULATORY_CLOSURE",
                "WILDLEAF_QUALITY",
                "MANUAL"
              ]
            },
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            quantity: { type: "integer", minimum: 1, maximum: 1000 },
            reason: { type: "string", minLength: 1, maxLength: 3000 }
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
          scopeKey: `inventory.block.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createBlock(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              scopeType: request.body.scopeType,
              roomCategoryId: request.body.roomCategoryId ?? null,
              physicalUnitId: request.body.physicalUnitId ?? null,
              blockType: request.body.blockType,
              startDate: request.body.startDate,
              endDate: request.body.endDate,
              quantity: request.body.quantity ?? 1,
              reason: request.body.reason
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

  app.post<{ Params: BlockParams; Body: ReleaseBlockBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/blocks/:blockId/release",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory"],
        summary: "Release an active inventory block",
        security: [{ bearerAuth: [] }],
        params: blockParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["releaseReason"],
          properties: {
            releaseReason: { type: "string", minLength: 1, maxLength: 3000 }
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
          scopeKey: `inventory.block.release:${request.params.blockId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.releaseBlock(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.blockId,
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

  app.get<{ Params: PropertyParams; Querystring: ListBlocksQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/inventory/blocks",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Inventory"],
        summary: "List inventory blocks overlapping a date range",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["startDate", "endDate"],
          properties: {
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            includeReleased: { type: "boolean", default: false }
          }
        }
      }
    },
    async (request) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      return service.listBlocks(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.propertyId,
        request.query.startDate,
        request.query.endDate,
        request.query.includeReleased ?? false
      );
    }
  );
}
