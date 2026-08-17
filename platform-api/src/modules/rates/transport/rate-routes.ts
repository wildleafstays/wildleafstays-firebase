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
import { RateService } from "../application/rate-service.js";
import type { MealPlanCode, RateProductType, SetRateCalendarDayInput } from "../domain/rates.js";

export interface RateRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface ProductParams extends PropertyParams {
  rateProductId: string;
}

interface CreatePlanBody extends JsonObject {
  code: string;
  name: string;
  description?: string | null;
  mealPlanCode: MealPlanCode;
}

interface ConfigureProductBody extends JsonObject {
  ratePlanId: string;
  productType: RateProductType;
  roomCategoryId?: string | null;
  baseRateMinor: number;
  floorRateMinor: number;
  ceilingRateMinor: number;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  expectedVersion?: number | null;
}

interface CalendarQuery {
  startDate: string;
  endDate: string;
}

interface CalendarBody extends JsonObject {
  entries: SetRateCalendarDayInput[];
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

const productParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "rateProductId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    rateProductId: { type: "string", format: "uuid" }
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

const nullableVersion = {
  anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }]
} as const;

export async function registerRateRoutes(
  app: FastifyInstance,
  deps: RateRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new RateService();

  app.post<{ Params: PropertyParams; Body: CreatePlanBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/rates/plans",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Rates"],
        summary: "Create a property rate plan",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", "name", "mealPlanCode"],
          properties: {
            code: { type: "string", minLength: 2, maxLength: 30 },
            name: { type: "string", minLength: 2, maxLength: 120 },
            description: {
              anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }]
            },
            mealPlanCode: {
              type: "string",
              enum: ["EP", "CP", "MAP", "AP", "CUSTOM"]
            }
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
          scopeKey: `rates.plan.create:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.createRatePlan(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              code: request.body.code,
              name: request.body.name,
              description: request.body.description ?? null,
              mealPlanCode: request.body.mealPlanCode
            },
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: PropertyParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/rates/plans",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Rates"],
        summary: "List property rate plans",
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
          service.listRatePlans(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId
          )
        );
    }
  );

  app.put<{ Params: PropertyParams; Body: ConfigureProductBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/rates/products",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Rates"],
        summary: "Create or optimistically update a rate-plan product",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "ratePlanId",
            "productType",
            "baseRateMinor",
            "floorRateMinor",
            "ceilingRateMinor",
            "includedAdults",
            "includedChildren",
            "maxAdults",
            "maxChildren",
            "maxOccupancy",
            "extraAdultMinor",
            "extraChildMinor"
          ],
          properties: {
            ratePlanId: { type: "string", format: "uuid" },
            productType: {
              type: "string",
              enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
            },
            roomCategoryId: {
              anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
            },
            baseRateMinor: { type: "integer", minimum: 0, maximum: 100000000 },
            floorRateMinor: { type: "integer", minimum: 0, maximum: 100000000 },
            ceilingRateMinor: { type: "integer", minimum: 0, maximum: 100000000 },
            includedAdults: { type: "integer", minimum: 1, maximum: 100 },
            includedChildren: { type: "integer", minimum: 0, maximum: 100 },
            maxAdults: { type: "integer", minimum: 1, maximum: 100 },
            maxChildren: { type: "integer", minimum: 0, maximum: 100 },
            maxOccupancy: { type: "integer", minimum: 1, maximum: 100 },
            extraAdultMinor: { type: "integer", minimum: 0, maximum: 100000000 },
            extraChildMinor: { type: "integer", minimum: 0, maximum: 100000000 },
            expectedVersion: nullableVersion
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
          scopeKey: `rates.product.configure:${request.params.propertyId}:${request.body.ratePlanId}:${request.body.productType}:${request.body.roomCategoryId ?? "FULL"}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.configureRateProduct(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              ratePlanId: request.body.ratePlanId,
              productType: request.body.productType,
              roomCategoryId: request.body.roomCategoryId ?? null,
              baseRateMinor: request.body.baseRateMinor,
              floorRateMinor: request.body.floorRateMinor,
              ceilingRateMinor: request.body.ceilingRateMinor,
              includedAdults: request.body.includedAdults,
              includedChildren: request.body.includedChildren,
              maxAdults: request.body.maxAdults,
              maxChildren: request.body.maxChildren,
              maxOccupancy: request.body.maxOccupancy,
              extraAdultMinor: request.body.extraAdultMinor,
              extraChildMinor: request.body.extraChildMinor,
              expectedVersion: request.body.expectedVersion ?? null
            },
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: ProductParams; Querystring: CalendarQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/rates/products/:rateProductId/calendar",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Rates"],
        summary: "Get effective base-plus-override nightly rate calendar",
        security: [{ bearerAuth: [] }],
        params: productParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["startDate", "endDate"],
          properties: {
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" }
          }
        }
      }
    },
    async (request) => {
      const actor = request.actor;
      if (!actor) throw new AuthenticationError();
      return deps.db
        .transaction()
        .execute((trx) =>
          service.getCalendar(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.rateProductId,
            request.query.startDate,
            request.query.endDate
          )
        );
    }
  );

  app.put<{ Params: ProductParams; Body: CalendarBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/rates/products/:rateProductId/calendar",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Rates"],
        summary: "Atomically set dated rates and restrictions",
        security: [{ bearerAuth: [] }],
        params: productParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["entries"],
          properties: {
            entries: {
              type: "array",
              minItems: 1,
              maxItems: 366,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "stayDate",
                  "rateMinor",
                  "minimumStay",
                  "closedToArrival",
                  "closedToDeparture",
                  "stopSell",
                  "source"
                ],
                properties: {
                  stayDate: { type: "string", format: "date" },
                  rateMinor: { type: "integer", minimum: 0, maximum: 100000000 },
                  extraAdultMinor: {
                    anyOf: [{ type: "integer", minimum: 0, maximum: 100000000 }, { type: "null" }]
                  },
                  extraChildMinor: {
                    anyOf: [{ type: "integer", minimum: 0, maximum: 100000000 }, { type: "null" }]
                  },
                  minimumStay: { type: "integer", minimum: 1, maximum: 365 },
                  maximumStay: {
                    anyOf: [{ type: "integer", minimum: 1, maximum: 365 }, { type: "null" }]
                  },
                  closedToArrival: { type: "boolean" },
                  closedToDeparture: { type: "boolean" },
                  stopSell: { type: "boolean" },
                  source: {
                    type: "string",
                    enum: ["MANUAL", "REVENUE", "SYSTEM"]
                  },
                  expectedVersion: nullableVersion
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

      const entries = request.body.entries.map((entry) => ({
        ...entry,
        extraAdultMinor: entry.extraAdultMinor ?? null,
        extraChildMinor: entry.extraChildMinor ?? null,
        maximumStay: entry.maximumStay ?? null,
        expectedVersion: entry.expectedVersion ?? null
      }));

      const result = await idempotency.execute(
        {
          scopeKey: `rates.calendar:${request.params.rateProductId}:user:${actor.userId}`,
          key,
          requestBody: { entries }
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setCalendarDays(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.rateProductId,
            entries,
            requestMetadata(request, "partner-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );
}
