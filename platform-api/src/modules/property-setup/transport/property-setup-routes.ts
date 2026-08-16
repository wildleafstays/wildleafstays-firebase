import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import type { AccommodationType, StructureType } from "../domain/property-setup.js";
import { PropertySetupService } from "../application/property-setup-service.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";

export interface PropertySetupRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface StructureParams extends PropertyParams {
  structureId: string;
}

interface CreateStructureBody extends JsonObject {
  code?: string;
  name: string;
  structureType: StructureType;
  sortOrder?: number;
  hasLift?: boolean;
  wheelchairAccessible?: boolean;
}

interface CreateFloorBody extends JsonObject {
  code?: string;
  name: string;
  floorNumber?: number;
  sortOrder?: number;
  liftAccessible?: boolean;
  wheelchairAccessible?: boolean;
}

interface CreateRoomCategoryBody extends JsonObject {
  code: string;
  name: string;
  accommodationType: AccommodationType;
  description?: string;
  baseOccupancy?: number;
  maxAdults?: number;
  maxChildren?: number;
  maxOccupancy?: number;
  sizeSqm?: number;
  bedConfiguration?: string;
  extraBedAllowed?: boolean;
  defaultViewLabel?: string;
  sortOrder?: number;
}

interface CreatePhysicalUnitBody extends JsonObject {
  roomCategoryId: string;
  structureId?: string;
  floorId?: string;
  unitCode: string;
  displayName?: string;
  hasView?: boolean;
  viewLabel?: string;
  wheelchairAccessible?: boolean;
  stepFreeAccessible?: boolean;
  liftAccessible?: boolean;
  smokingPolicy?: "NON_SMOKING" | "SMOKING";
  internalNotes?: string;
  sortOrder?: number;
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

const structureParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "structureId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    structureId: { type: "string", format: "uuid" }
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

export async function registerPropertySetupRoutes(
  app: FastifyInstance,
  deps: PropertySetupRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new PropertySetupService();

  app.get<{ Params: PropertyParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/layout",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Setup"],
        summary: "Get physical property layout and accommodation master data",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema
      }
    },
    async (request) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }
      return service.getLayout(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.propertyId
      );
    }
  );

  app.post<{ Params: PropertyParams; Body: CreateStructureBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/structures",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Setup"],
        summary: "Create a building, wing, block, tower or cluster",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "structureType"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 50 },
            name: { type: "string", minLength: 1, maxLength: 150 },
            structureType: {
              type: "string",
              enum: ["BUILDING", "WING", "BLOCK", "TOWER", "CLUSTER", "OTHER"]
            },
            sortOrder: { type: "integer", minimum: 0, default: 0 },
            hasLift: { type: "boolean", default: false },
            wheelchairAccessible: { type: "boolean", default: false }
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
          scopeKey: `property.structure.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createStructure(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              code: request.body.code?.trim() || null,
              name: request.body.name.trim(),
              structureType: request.body.structureType,
              sortOrder: request.body.sortOrder ?? 0,
              hasLift: request.body.hasLift ?? false,
              wheelchairAccessible: request.body.wheelchairAccessible ?? false
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

  app.post<{ Params: StructureParams; Body: CreateFloorBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/structures/:structureId/floors",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Setup"],
        summary: "Create a floor in a property structure",
        security: [{ bearerAuth: [] }],
        params: structureParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 50 },
            name: { type: "string", minLength: 1, maxLength: 150 },
            floorNumber: { type: "integer", minimum: -20, maximum: 200 },
            sortOrder: { type: "integer", minimum: 0, default: 0 },
            liftAccessible: { type: "boolean", default: false },
            wheelchairAccessible: { type: "boolean", default: false }
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
          scopeKey: `property.floor.create:${request.params.structureId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createFloor(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              structureId: request.params.structureId,
              code: request.body.code?.trim() || null,
              name: request.body.name.trim(),
              floorNumber: request.body.floorNumber ?? null,
              sortOrder: request.body.sortOrder ?? 0,
              liftAccessible: request.body.liftAccessible ?? false,
              wheelchairAccessible: request.body.wheelchairAccessible ?? false
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

  app.post<{ Params: PropertyParams; Body: CreateRoomCategoryBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/room-categories",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Setup"],
        summary: "Create a room or accommodation category",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name", "accommodationType"],
          properties: {
            code: { type: "string", minLength: 1, maxLength: 50 },
            name: { type: "string", minLength: 1, maxLength: 150 },
            accommodationType: {
              type: "string",
              enum: [
                "ROOM",
                "SUITE",
                "COTTAGE",
                "HUT",
                "VILLA",
                "APARTMENT",
                "DORM",
                "TENT",
                "OTHER"
              ]
            },
            description: { type: "string", maxLength: 3000 },
            baseOccupancy: { type: "integer", minimum: 1, maximum: 50, default: 2 },
            maxAdults: { type: "integer", minimum: 1, maximum: 50, default: 2 },
            maxChildren: { type: "integer", minimum: 0, maximum: 50, default: 0 },
            maxOccupancy: { type: "integer", minimum: 1, maximum: 100, default: 2 },
            sizeSqm: { type: "number", exclusiveMinimum: 0, maximum: 10000 },
            bedConfiguration: { type: "string", maxLength: 500 },
            extraBedAllowed: { type: "boolean", default: false },
            defaultViewLabel: { type: "string", maxLength: 150 },
            sortOrder: { type: "integer", minimum: 0, default: 0 }
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
          scopeKey: `property.room-category.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createRoomCategory(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              code: request.body.code.trim().toUpperCase(),
              name: request.body.name.trim(),
              accommodationType: request.body.accommodationType,
              description: request.body.description?.trim() || null,
              baseOccupancy: request.body.baseOccupancy ?? 2,
              maxAdults: request.body.maxAdults ?? 2,
              maxChildren: request.body.maxChildren ?? 0,
              maxOccupancy: request.body.maxOccupancy ?? 2,
              sizeSqm: request.body.sizeSqm ?? null,
              bedConfiguration: request.body.bedConfiguration?.trim() || null,
              extraBedAllowed: request.body.extraBedAllowed ?? false,
              defaultViewLabel: request.body.defaultViewLabel?.trim() || null,
              sortOrder: request.body.sortOrder ?? 0
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

  app.post<{ Params: PropertyParams; Body: CreatePhysicalUnitBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/units",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Setup"],
        summary: "Create an actual room, hut, cottage, villa or other physical unit",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["roomCategoryId", "unitCode"],
          properties: {
            roomCategoryId: { type: "string", format: "uuid" },
            structureId: { type: "string", format: "uuid" },
            floorId: { type: "string", format: "uuid" },
            unitCode: { type: "string", minLength: 1, maxLength: 80 },
            displayName: { type: "string", maxLength: 150 },
            hasView: { type: "boolean", default: false },
            viewLabel: { type: "string", maxLength: 150 },
            wheelchairAccessible: { type: "boolean", default: false },
            stepFreeAccessible: { type: "boolean", default: false },
            liftAccessible: { type: "boolean", default: false },
            smokingPolicy: {
              type: "string",
              enum: ["NON_SMOKING", "SMOKING"],
              default: "NON_SMOKING"
            },
            internalNotes: { type: "string", maxLength: 2000 },
            sortOrder: { type: "integer", minimum: 0, default: 0 }
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
          scopeKey: `property.unit.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createPhysicalUnit(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              roomCategoryId: request.body.roomCategoryId,
              structureId: request.body.structureId ?? null,
              floorId: request.body.floorId ?? null,
              unitCode: request.body.unitCode.trim().toUpperCase(),
              displayName: request.body.displayName?.trim() || null,
              hasView: request.body.hasView ?? false,
              viewLabel: request.body.viewLabel?.trim() || null,
              wheelchairAccessible: request.body.wheelchairAccessible ?? false,
              stepFreeAccessible: request.body.stepFreeAccessible ?? false,
              liftAccessible: request.body.liftAccessible ?? false,
              smokingPolicy: request.body.smokingPolicy ?? "NON_SMOKING",
              internalNotes: request.body.internalNotes?.trim() || null,
              sortOrder: request.body.sortOrder ?? 0
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
}
