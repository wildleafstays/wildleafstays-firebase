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
import { PromotionRuleService } from "../application/promotion-rule-service.js";
import type {
  PromotionAppliesTo,
  PromotionDiscountType,
  PromotionKind,
  PromotionMode,
  PromotionStackingMode
} from "../domain/promotion-rules.js";
import type { CommercialScopeType } from "../domain/commercial-rules.js";

export interface PromotionRuleRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface CampaignParams extends PropertyParams {
  promotionId: string;
}

interface PromotionSettingsBody extends JsonObject {
  effectiveFrom: string;
  promotionMode: PromotionMode;
  expectedVersion: number;
}

interface CreateCampaignBody extends JsonObject {
  code: string;
  name: string;
  description: string | null;
  promotionKind: PromotionKind;
  publicCode: string | null;
}

interface CreateVersionBody extends JsonObject {
  effectiveFrom: string;
  bookingWindowStart: string | null;
  bookingWindowEnd: string | null;
  arrivalWindowStart: string | null;
  arrivalWindowEnd: string | null;
  minimumStayNights: number;
  minimumSpendMinor: number | null;
  discountType: PromotionDiscountType;
  discountValue: number;
  maximumDiscountMinor: number | null;
  appliesTo: PromotionAppliesTo;
  priority: number;
  stackingMode: PromotionStackingMode;
  stackGroup: string | null;
  expectedCurrentVersion: number;
}

interface CreateAssignmentBody extends JsonObject {
  effectiveFrom: string;
  scopeType: CommercialScopeType;
  ratePlanId: string | null;
  rateProductId: string | null;
  enabled: boolean;
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

const campaignParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "promotionId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    promotionId: { type: "string", format: "uuid" }
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
  if (typeof key !== "string") throw new ValidationError("Idempotency key is required");
  return key;
}

export async function registerPromotionRuleRoutes(
  app: FastifyInstance,
  deps: PromotionRuleRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const service = new PromotionRuleService();
  const idempotency = new IdempotencyService(deps.db);
  const base =
    "/v1/partner/organizations/:organizationId/properties/:propertyId/commercial/promotions";

  app.get<{ Params: PropertyParams }>(
    base,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Promotions"],
        summary: "Get promotion configuration",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      return deps.db
        .transaction()
        .execute((trx) =>
          service.getConfiguration(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId
          )
        );
    }
  );

  app.put<{ Params: PropertyParams; Body: PromotionSettingsBody }>(
    `${base}/settings`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Promotions"],
        summary: "Append promotion settings",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["effectiveFrom", "promotionMode", "expectedVersion"],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            promotionMode: { type: "string", enum: ["NO_PROMOTIONS", "POLICIES"] },
            expectedVersion: { type: "integer", minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `promotion.settings:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setSettings(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              ...request.body
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PropertyParams; Body: CreateCampaignBody }>(
    `${base}/campaigns`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Promotions"],
        summary: "Create a promotion campaign",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name", "description", "promotionKind", "publicCode"],
          properties: {
            code: { type: "string", minLength: 2, maxLength: 40 },
            name: { type: "string", minLength: 2, maxLength: 120 },
            description: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
            promotionKind: { type: "string", enum: ["AUTOMATIC", "PROMO_CODE"] },
            publicCode: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `promotion.campaign.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createCampaign(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              ...request.body
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: CampaignParams; Body: CreateVersionBody }>(
    `${base}/campaigns/:promotionId/versions`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Promotions"],
        summary: "Append a promotion campaign version",
        security: [{ bearerAuth: [] }],
        params: campaignParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "effectiveFrom",
            "bookingWindowStart",
            "bookingWindowEnd",
            "arrivalWindowStart",
            "arrivalWindowEnd",
            "minimumStayNights",
            "minimumSpendMinor",
            "discountType",
            "discountValue",
            "maximumDiscountMinor",
            "appliesTo",
            "priority",
            "stackingMode",
            "stackGroup",
            "expectedCurrentVersion"
          ],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            bookingWindowStart: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
            bookingWindowEnd: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
            arrivalWindowStart: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
            arrivalWindowEnd: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
            minimumStayNights: { type: "integer", minimum: 1, maximum: 365 },
            minimumSpendMinor: {
              anyOf: [{ type: "integer", minimum: 0, maximum: 100000000 }, { type: "null" }]
            },
            discountType: { type: "string", enum: ["PERCENTAGE", "FIXED_AMOUNT"] },
            discountValue: { type: "integer", minimum: 1, maximum: 100000000 },
            maximumDiscountMinor: {
              anyOf: [{ type: "integer", minimum: 1, maximum: 100000000 }, { type: "null" }]
            },
            appliesTo: {
              type: "string",
              enum: ["ACCOMMODATION", "ACCOMMODATION_AND_EXTRA_GUEST"]
            },
            priority: { type: "integer", minimum: 0, maximum: 100000 },
            stackingMode: { type: "string", enum: ["EXCLUSIVE", "STACKABLE"] },
            stackGroup: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
            expectedCurrentVersion: { type: "integer", minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `promotion.campaign.version:${request.params.promotionId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createCampaignVersion(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              promotionCampaignId: request.params.promotionId,
              ...request.body
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: CampaignParams; Body: CreateAssignmentBody }>(
    `${base}/campaigns/:promotionId/assignments`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Promotions"],
        summary: "Append a promotion assignment state",
        security: [{ bearerAuth: [] }],
        params: campaignParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["effectiveFrom", "scopeType", "ratePlanId", "rateProductId", "enabled"],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            scopeType: { type: "string", enum: ["PROPERTY", "RATE_PLAN", "RATE_PRODUCT"] },
            ratePlanId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
            rateProductId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
            enabled: { type: "boolean" }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `promotion.assignment:${request.params.promotionId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createAssignment(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              promotionCampaignId: request.params.promotionId,
              ...request.body
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );
}
