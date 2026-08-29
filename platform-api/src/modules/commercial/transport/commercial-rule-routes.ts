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
import { CommercialRuleService } from "../application/commercial-rule-service.js";
import { PlatformHotelGstService } from "../application/platform-hotel-gst-service.js";
import type {
  CancellationPenaltyType,
  CancellationTriggerType,
  CommercialScopeType,
  FeeApplicationBasis,
  FeeCalculationType,
  PriceMode,
  TaxSelectionBasis
} from "../domain/commercial-rules.js";

export interface CommercialRuleRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface PolicyParams extends PropertyParams {
  policyId: string;
}

interface SettingsBody extends JsonObject {
  effectiveFrom: string;
  taxMode: "NO_TAX" | "POLICIES";
  feeMode: "NO_FEES" | "POLICIES";
  expectedVersion: number;
}

interface CreatePolicyBody extends JsonObject {
  code: string;
  name: string;
  description?: string | null;
}

interface TaxVersionBody extends JsonObject {
  effectiveFrom: string;
  priceMode: PriceMode;
  selectionBasis: TaxSelectionBasis;
  minimumBasisMinor?: number | null;
  maximumBasisMinor?: number | null;
  appliesToAccommodation: boolean;
  appliesToExtraGuest: boolean;
  appliesToFee: boolean;
  expectedCurrentVersion: number;
  components: Array<{
    code: string;
    name: string;
    rateBasisPoints: number;
    sortOrder: number;
  }>;
}

interface AssignmentBody extends JsonObject {
  effectiveFrom: string;
  scopeType: CommercialScopeType;
  ratePlanId?: string | null;
  rateProductId?: string | null;
  enabled: boolean;
}

interface FeeVersionBody extends JsonObject {
  effectiveFrom: string;
  calculationType: FeeCalculationType;
  applicationBasis: FeeApplicationBasis;
  amountMinor?: number | null;
  rateBasisPoints?: number | null;
  priceMode: PriceMode;
  taxable: boolean;
  taxPolicyId?: string | null;
  expectedCurrentVersion: number;
}

interface CancellationVersionBody extends JsonObject {
  effectiveFrom: string;
  arrivalLocalTime: string;
  policyText?: string | null;
  expectedCurrentVersion: number;
  tiers: Array<{
    triggerType: CancellationTriggerType;
    minimumMinutesBeforeArrival?: number | null;
    penaltyType: CancellationPenaltyType;
    penaltyValue: number;
  }>;
}

interface CancellationAssignmentBody extends JsonObject {
  ratePlanId: string;
  cancellationPolicyId: string;
  effectiveFrom: string;
}

interface GuestAgeBody extends JsonObject {
  effectiveFrom: string;
  infantMaxAge?: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
  expectedVersion: number;
}

interface HotelGstConsentBody extends JsonObject {
  ruleVersionId: string;
  accepted: boolean;
}

interface PlatformHotelGstRuleBody extends JsonObject {
  effectiveFrom: string;
  thresholdMinor: number;
  lowerRateBasisPoints: number;
  upperRateBasisPoints: number;
  lowerItcAvailable: boolean;
  upperItcAvailable: boolean;
  sourceUrl: string;
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

const policyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "policyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    policyId: { type: "string", format: "uuid" }
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

const policyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "name"],
  properties: {
    code: { type: "string", minLength: 2, maxLength: 40 },
    name: { type: "string", minLength: 2, maxLength: 120 },
    description: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] }
  }
} as const;

const assignmentBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["effectiveFrom", "scopeType", "enabled"],
  properties: {
    effectiveFrom: { type: "string", format: "date" },
    scopeType: { type: "string", enum: ["PROPERTY", "RATE_PLAN", "RATE_PRODUCT"] },
    ratePlanId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    rateProductId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
    enabled: { type: "boolean" }
  }
} as const;

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const key = headers["idempotency-key"];
  if (typeof key !== "string") throw new ValidationError("Idempotency key is required");
  return key;
}

export async function registerCommercialRuleRoutes(
  app: FastifyInstance,
  deps: CommercialRuleRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new CommercialRuleService();
  const hotelGst = new PlatformHotelGstService();
  const base = "/v1/partner/organizations/:organizationId/properties/:propertyId/commercial";

  app.get<{ Params: PropertyParams }>(
    `${base}/hotel-gst-consent`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Get the platform-controlled Indian hotel GST rule and property consent",
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
          hotelGst.getOwnerConsent(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId
          )
        );
    }
  );

  app.put<{ Params: PropertyParams; Body: HotelGstConsentBody }>(
    `${base}/hotel-gst-consent`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Accept the platform-controlled Indian hotel GST rule",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ruleVersionId", "accepted"],
          properties: {
            ruleVersionId: { type: "string", format: "uuid" },
            accepted: { type: "boolean", const: true }
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
          scopeKey: `commercial.hotel-gst.consent:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await hotelGst.acceptOwnerConsent(
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

  app.get(
    "/v1/platform/commercial/hotel-gst-rules",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "List platform Indian hotel GST rule versions",
        security: [{ bearerAuth: [] }]
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      return deps.db.transaction().execute((trx) => hotelGst.listRules(trx, actor));
    }
  );

  app.post<{ Body: PlatformHotelGstRuleBody }>(
    "/v1/platform/commercial/hotel-gst-rules",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append a platform Indian hotel GST rule version",
        security: [{ bearerAuth: [] }],
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "effectiveFrom",
            "thresholdMinor",
            "lowerRateBasisPoints",
            "upperRateBasisPoints",
            "lowerItcAvailable",
            "upperItcAvailable",
            "sourceUrl"
          ],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            thresholdMinor: { type: "integer", minimum: 1 },
            lowerRateBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            upperRateBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            lowerItcAvailable: { type: "boolean" },
            upperItcAvailable: { type: "boolean" },
            sourceUrl: { type: "string", format: "uri", maxLength: 2000 }
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
          scopeKey: `platform.hotel-gst.rule:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await hotelGst.createRule(
            trx,
            actor,
            request.body,
            requestMetadata(request, "platform-api")
          )
        })
      );
      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: PropertyParams }>(
    base,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Get property commercial-rule configuration",
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

  app.put<{ Params: PropertyParams; Body: SettingsBody }>(
    `${base}/settings`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append a property commercial settings version",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["effectiveFrom", "taxMode", "feeMode", "expectedVersion"],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            taxMode: { type: "string", enum: ["NO_TAX", "POLICIES"] },
            feeMode: { type: "string", enum: ["NO_FEES", "POLICIES"] },
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
          scopeKey: `commercial.settings:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setPropertyCommercialSettings(
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

  const createPolicyRoute = (
    suffix: "tax-policies" | "fee-policies" | "cancellation-policies",
    kind: "tax" | "fee" | "cancellation"
  ) => {
    app.post<{ Params: PropertyParams; Body: CreatePolicyBody }>(
      `${base}/${suffix}`,
      {
        preHandler: authenticate,
        schema: {
          tags: ["Commercial Rules"],
          summary: `Create a ${kind} policy header`,
          security: [{ bearerAuth: [] }],
          params: propertyParamsSchema,
          headers: idempotencyHeaders,
          body: policyBodySchema
        }
      },
      async (request, reply) => {
        const actor = request.actor;
        if (!actor) throw new AuthenticationError();
        const key = requireIdempotencyKey(request.headers);
        const result = await idempotency.execute(
          {
            scopeKey: `commercial.${kind}.policy.create:${request.params.propertyId}:user:${actor.userId}`,
            key,
            requestBody: request.body
          },
          async (trx) => {
            const input = {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              code: request.body.code,
              name: request.body.name,
              description: request.body.description ?? null
            };
            const body =
              kind === "tax"
                ? await service.createTaxPolicy(
                    trx,
                    actor,
                    input,
                    requestMetadata(request, "partner-api")
                  )
                : kind === "fee"
                  ? await service.createFeePolicy(
                      trx,
                      actor,
                      input,
                      requestMetadata(request, "partner-api")
                    )
                  : await service.createCancellationPolicy(
                      trx,
                      actor,
                      input,
                      requestMetadata(request, "partner-api")
                    );
            return { statusCode: 201, body };
          }
        );
        if (result.replayed) void reply.header("idempotency-replayed", "true");
        return reply.status(result.statusCode).send(result.body);
      }
    );
  };

  createPolicyRoute("tax-policies", "tax");
  createPolicyRoute("fee-policies", "fee");
  createPolicyRoute("cancellation-policies", "cancellation");

  app.post<{ Params: PolicyParams; Body: TaxVersionBody }>(
    `${base}/tax-policies/:policyId/versions`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Create and seal an immutable tax policy version",
        security: [{ bearerAuth: [] }],
        params: policyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "effectiveFrom",
            "priceMode",
            "selectionBasis",
            "appliesToAccommodation",
            "appliesToExtraGuest",
            "appliesToFee",
            "expectedCurrentVersion",
            "components"
          ],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            priceMode: { type: "string", enum: ["EXCLUSIVE", "INCLUSIVE"] },
            selectionBasis: {
              type: "string",
              enum: ["ALWAYS", "NIGHTLY_UNIT_RATE", "NIGHTLY_TAXABLE_AMOUNT", "STAY_TAXABLE_AMOUNT"]
            },
            minimumBasisMinor: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
            maximumBasisMinor: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
            appliesToAccommodation: { type: "boolean" },
            appliesToExtraGuest: { type: "boolean" },
            appliesToFee: { type: "boolean" },
            expectedCurrentVersion: { type: "integer", minimum: 0 },
            components: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "name", "rateBasisPoints", "sortOrder"],
                properties: {
                  code: { type: "string", minLength: 1, maxLength: 40 },
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  rateBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
                  sortOrder: { type: "integer", minimum: 0, maximum: 1000 }
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
        effectiveFrom: request.body.effectiveFrom,
        priceMode: request.body.priceMode,
        selectionBasis: request.body.selectionBasis,
        minimumBasisMinor: request.body.minimumBasisMinor ?? null,
        maximumBasisMinor: request.body.maximumBasisMinor ?? null,
        appliesToAccommodation: request.body.appliesToAccommodation,
        appliesToExtraGuest: request.body.appliesToExtraGuest,
        appliesToFee: request.body.appliesToFee,
        expectedCurrentVersion: request.body.expectedCurrentVersion,
        components: request.body.components
      };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.tax.version:${request.params.policyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createTaxPolicyVersion(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              taxPolicyId: request.params.policyId,
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

  app.post<{ Params: PolicyParams; Body: AssignmentBody }>(
    `${base}/tax-policies/:policyId/assignments`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append an effective tax assignment state",
        security: [{ bearerAuth: [] }],
        params: policyParamsSchema,
        headers: idempotencyHeaders,
        body: assignmentBodySchema
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const body = {
        effectiveFrom: request.body.effectiveFrom,
        scopeType: request.body.scopeType,
        ratePlanId: request.body.ratePlanId ?? null,
        rateProductId: request.body.rateProductId ?? null,
        enabled: request.body.enabled
      };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.tax.assignment:${request.params.policyId}:${body.scopeType}:${body.ratePlanId ?? body.rateProductId ?? "PROPERTY"}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createTaxAssignment(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              taxPolicyId: request.params.policyId,
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

  app.post<{ Params: PolicyParams; Body: FeeVersionBody }>(
    `${base}/fee-policies/:policyId/versions`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Create an immutable fee policy version",
        security: [{ bearerAuth: [] }],
        params: policyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "effectiveFrom",
            "calculationType",
            "applicationBasis",
            "priceMode",
            "taxable",
            "expectedCurrentVersion"
          ],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            calculationType: { type: "string", enum: ["FIXED", "PERCENTAGE"] },
            applicationBasis: {
              type: "string",
              enum: [
                "PER_STAY",
                "PER_NIGHT",
                "PER_UNIT_PER_STAY",
                "PER_UNIT_PER_NIGHT",
                "STAY_CHARGES"
              ]
            },
            amountMinor: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
            rateBasisPoints: {
              anyOf: [{ type: "integer", minimum: 0, maximum: 10000 }, { type: "null" }]
            },
            priceMode: { type: "string", enum: ["EXCLUSIVE", "INCLUSIVE"] },
            taxable: { type: "boolean" },
            taxPolicyId: { anyOf: [{ type: "string", format: "uuid" }, { type: "null" }] },
            expectedCurrentVersion: { type: "integer", minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const body = {
        effectiveFrom: request.body.effectiveFrom,
        calculationType: request.body.calculationType,
        applicationBasis: request.body.applicationBasis,
        amountMinor: request.body.amountMinor ?? null,
        rateBasisPoints: request.body.rateBasisPoints ?? null,
        priceMode: request.body.priceMode,
        taxable: request.body.taxable,
        taxPolicyId: request.body.taxPolicyId ?? null,
        expectedCurrentVersion: request.body.expectedCurrentVersion
      };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.fee.version:${request.params.policyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createFeePolicyVersion(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              feePolicyId: request.params.policyId,
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

  app.post<{ Params: PolicyParams; Body: AssignmentBody }>(
    `${base}/fee-policies/:policyId/assignments`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append an effective fee assignment state",
        security: [{ bearerAuth: [] }],
        params: policyParamsSchema,
        headers: idempotencyHeaders,
        body: assignmentBodySchema
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const body = {
        effectiveFrom: request.body.effectiveFrom,
        scopeType: request.body.scopeType,
        ratePlanId: request.body.ratePlanId ?? null,
        rateProductId: request.body.rateProductId ?? null,
        enabled: request.body.enabled
      };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.fee.assignment:${request.params.policyId}:${body.scopeType}:${body.ratePlanId ?? body.rateProductId ?? "PROPERTY"}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createFeeAssignment(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              feePolicyId: request.params.policyId,
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

  app.post<{ Params: PolicyParams; Body: CancellationVersionBody }>(
    `${base}/cancellation-policies/:policyId/versions`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Create and seal an immutable cancellation policy version",
        security: [{ bearerAuth: [] }],
        params: policyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["effectiveFrom", "arrivalLocalTime", "expectedCurrentVersion", "tiers"],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            arrivalLocalTime: { type: "string", minLength: 5, maxLength: 8 },
            policyText: { anyOf: [{ type: "string", maxLength: 5000 }, { type: "null" }] },
            expectedCurrentVersion: { type: "integer", minimum: 0 },
            tiers: {
              type: "array",
              minItems: 2,
              maxItems: 30,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["triggerType", "penaltyType", "penaltyValue"],
                properties: {
                  triggerType: { type: "string", enum: ["CANCELLATION", "NO_SHOW"] },
                  minimumMinutesBeforeArrival: {
                    anyOf: [{ type: "null" }, { type: "integer", minimum: 0 }]
                  },
                  penaltyType: {
                    type: "string",
                    enum: ["PERCENTAGE_OF_STAY", "FIXED_AMOUNT", "NIGHTS"]
                  },
                  penaltyValue: { type: "integer", minimum: 0, maximum: 100000000 }
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
        effectiveFrom: request.body.effectiveFrom,
        arrivalLocalTime: request.body.arrivalLocalTime,
        policyText: request.body.policyText ?? null,
        expectedCurrentVersion: request.body.expectedCurrentVersion,
        tiers: request.body.tiers.map((tier) => ({
          triggerType: tier.triggerType,
          minimumMinutesBeforeArrival: tier.minimumMinutesBeforeArrival ?? null,
          penaltyType: tier.penaltyType,
          penaltyValue: tier.penaltyValue
        }))
      };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.cancellation.version:${request.params.policyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createCancellationPolicyVersion(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              cancellationPolicyId: request.params.policyId,
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

  app.post<{ Params: PropertyParams; Body: CancellationAssignmentBody }>(
    `${base}/cancellation-assignments`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append a rate-plan cancellation-policy assignment",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["ratePlanId", "cancellationPolicyId", "effectiveFrom"],
          properties: {
            ratePlanId: { type: "string", format: "uuid" },
            cancellationPolicyId: { type: "string", format: "uuid" },
            effectiveFrom: { type: "string", format: "date" }
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
          scopeKey: `commercial.cancellation.assignment:${request.body.ratePlanId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createCancellationAssignment(
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

  app.put<{ Params: PropertyParams; Body: GuestAgeBody }>(
    `${base}/guest-age-policy`,
    {
      preHandler: authenticate,
      schema: {
        tags: ["Commercial Rules"],
        summary: "Append a property guest-age policy version",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "effectiveFrom",
            "childMaxAge",
            "infantsCountTowardsOccupancy",
            "infantsCountTowardsChildLimit",
            "infantsChargeAsChildren",
            "expectedVersion"
          ],
          properties: {
            effectiveFrom: { type: "string", format: "date" },
            infantMaxAge: {
              anyOf: [{ type: "integer", minimum: 0, maximum: 17 }, { type: "null" }]
            },
            childMaxAge: { type: "integer", minimum: 0, maximum: 17 },
            infantsCountTowardsOccupancy: { type: "boolean" },
            infantsCountTowardsChildLimit: { type: "boolean" },
            infantsChargeAsChildren: { type: "boolean" },
            expectedVersion: { type: "integer", minimum: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      const key = requireIdempotencyKey(request.headers);
      const body = { ...request.body, infantMaxAge: request.body.infantMaxAge ?? null };
      const result = await idempotency.execute(
        {
          scopeKey: `commercial.guest-age:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setGuestAgePolicy(
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
}
