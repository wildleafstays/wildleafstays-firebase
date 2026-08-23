import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import { CreatePropertyDraftService } from "../application/create-property-draft-service.js";
import { GetPropertyService } from "../application/get-property-service.js";
import { ListPropertiesService } from "../application/list-properties-service.js";
import { SavePropertyProfileService } from "../application/save-property-profile-service.js";
import type { PropertyType, SaleMode } from "../domain/property-profile.js";

export interface PropertyRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface OrganizationParams {
  organizationId: string;
}

interface PropertyParams extends OrganizationParams {
  propertyId: string;
}

interface CreatePropertyBody extends JsonObject {
  name: string;
  timezone?: string;
}

interface SavePropertyProfileBody extends JsonObject {
  version: number;
  name: string;
  timezone: string;
  propertyType?: PropertyType;
  saleMode?: SaleMode;
  shortDescription?: string;
  description?: string;
  addressLine1?: string;
  addressLine2?: string;
  locality?: string;
  city?: string;
  stateRegion?: string;
  postalCode?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  contactPhone?: string;
  contactEmail?: string;
  checkInTime?: string;
  checkOutTime?: string;
}

const uuidParams = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId"],
  properties: {
    organizationId: { type: "string", format: "uuid" }
  }
} as const;

const propertyParams = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
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

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const nullableNumber = {
  anyOf: [{ type: "number" }, { type: "null" }]
} as const;

const propertySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "organizationId",
    "publicSlug",
    "name",
    "status",
    "timezone",
    "version",
    "propertyType",
    "saleMode",
    "shortDescription",
    "description",
    "addressLine1",
    "addressLine2",
    "locality",
    "city",
    "stateRegion",
    "postalCode",
    "countryCode",
    "latitude",
    "longitude",
    "contactPhone",
    "contactEmail",
    "checkInTime",
    "checkOutTime",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    organizationId: { type: "string", format: "uuid" },
    publicSlug: nullableString,
    name: { type: "string" },
    status: { type: "string" },
    timezone: { type: "string" },
    version: { type: "integer", minimum: 1 },
    propertyType: nullableString,
    saleMode: nullableString,
    shortDescription: nullableString,
    description: nullableString,
    addressLine1: nullableString,
    addressLine2: nullableString,
    locality: nullableString,
    city: nullableString,
    stateRegion: nullableString,
    postalCode: nullableString,
    countryCode: { type: "string" },
    latitude: nullableNumber,
    longitude: nullableNumber,
    contactPhone: nullableString,
    contactEmail: nullableString,
    checkInTime: nullableString,
    checkOutTime: nullableString,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const propertyEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["property"],
  properties: {
    property: propertySchema
  }
} as const;

const createPropertyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 2, maxLength: 200 },
    timezone: { type: "string", minLength: 1, maxLength: 100, default: "Asia/Kolkata" }
  }
} as const;

const saveProfileBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "name", "timezone"],
  properties: {
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 2, maxLength: 200 },
    timezone: { type: "string", minLength: 1, maxLength: 100 },
    propertyType: {
      type: "string",
      enum: [
        "HOTEL",
        "RESORT",
        "VILLA",
        "HOMESTAY",
        "COTTAGE_CLUSTER",
        "APARTMENT",
        "HOSTEL",
        "OTHER"
      ]
    },
    saleMode: {
      type: "string",
      enum: ["ROOMS_ONLY", "FULL_PROPERTY_ONLY", "BOTH"]
    },
    shortDescription: { type: "string", maxLength: 500 },
    description: { type: "string", maxLength: 10000 },
    addressLine1: { type: "string", maxLength: 250 },
    addressLine2: { type: "string", maxLength: 250 },
    locality: { type: "string", maxLength: 150 },
    city: { type: "string", maxLength: 150 },
    stateRegion: { type: "string", maxLength: 150 },
    postalCode: { type: "string", maxLength: 20 },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$", default: "IN" },
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
    contactPhone: { type: "string", maxLength: 40 },
    contactEmail: { type: "string", maxLength: 320 },
    checkInTime: {
      type: "string",
      pattern: "^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
    },
    checkOutTime: {
      type: "string",
      pattern: "^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
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

export async function registerPropertyRoutes(
  app: FastifyInstance,
  deps: PropertyRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const createService = new CreatePropertyDraftService();
  const getService = new GetPropertyService();
  const listService = new ListPropertiesService();
  const saveService = new SavePropertyProfileService();

  app.post<{ Params: OrganizationParams; Body: CreatePropertyBody }>(
    "/v1/partner/organizations/:organizationId/properties",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Properties"],
        summary: "Create a property draft",
        security: [{ bearerAuth: [] }],
        params: uuidParams,
        headers: idempotencyHeaders,
        body: createPropertyBodySchema,
        response: { 201: propertyEnvelopeSchema }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      const key = requireIdempotencyKey(request.headers);
      const body = request.body;
      const result = await idempotency.execute(
        {
          scopeKey: `property.create:organization:${request.params.organizationId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await createService.execute(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              name: body.name.trim(),
              timezone: body.timezone ?? "Asia/Kolkata"
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

  app.get<{ Params: OrganizationParams }>(
    "/v1/partner/organizations/:organizationId/properties",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Properties"],
        summary: "List properties visible to the organization member",
        security: [{ bearerAuth: [] }],
        params: uuidParams,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["properties"],
            properties: {
              properties: { type: "array", items: propertySchema }
            }
          }
        }
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      return listService.execute(deps.db, actor, request.params.organizationId);
    }
  );

  app.get<{ Params: PropertyParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Properties"],
        summary: "Get a property",
        security: [{ bearerAuth: [] }],
        params: propertyParams,
        response: { 200: propertyEnvelopeSchema }
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      return getService.execute(
        deps.db,
        actor,
        request.params.organizationId,
        request.params.propertyId
      );
    }
  );

  app.put<{ Params: PropertyParams; Body: SavePropertyProfileBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/profile",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Properties"],
        summary: "Save a complete editable property profile using optimistic concurrency",
        security: [{ bearerAuth: [] }],
        params: propertyParams,
        headers: idempotencyHeaders,
        body: saveProfileBodySchema,
        response: { 200: propertyEnvelopeSchema }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      const key = requireIdempotencyKey(request.headers);
      const body = request.body;
      const result = await idempotency.execute(
        {
          scopeKey: `property.profile.save:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 200,
          body: await saveService.execute(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              expectedVersion: body.version,
              name: body.name.trim(),
              timezone: body.timezone,
              propertyType: body.propertyType ?? null,
              saleMode: body.saleMode ?? null,
              shortDescription: body.shortDescription?.trim() || null,
              description: body.description?.trim() || null,
              addressLine1: body.addressLine1?.trim() || null,
              addressLine2: body.addressLine2?.trim() || null,
              locality: body.locality?.trim() || null,
              city: body.city?.trim() || null,
              stateRegion: body.stateRegion?.trim() || null,
              postalCode: body.postalCode?.trim() || null,
              countryCode: body.countryCode ?? "IN",
              latitude: body.latitude ?? null,
              longitude: body.longitude ?? null,
              contactPhone: body.contactPhone?.trim() || null,
              contactEmail: body.contactEmail?.trim().toLowerCase() || null,
              checkInTime: body.checkInTime ?? null,
              checkOutTime: body.checkOutTime ?? null
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
