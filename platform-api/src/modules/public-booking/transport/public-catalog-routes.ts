import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { PublicCatalogService } from "../application/public-catalog-service.js";

export interface PublicCatalogRouteDependencies {
  db: Kysely<Database>;
}

interface PublicPropertiesQuery {
  destination?: string;
  limit?: number;
}

interface PublicPropertyParams {
  publicSlug: string;
}

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const nullableNumber = {
  anyOf: [{ type: "number" }, { type: "null" }]
} as const;

const nullableInteger = {
  anyOf: [{ type: "integer" }, { type: "null" }]
} as const;

const nullableUuid = {
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
} as const;

const destinationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["city", "stateRegion", "countryCode", "propertyCount"],
  properties: {
    city: { type: "string" },
    stateRegion: nullableString,
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    propertyCount: { type: "integer", minimum: 1 }
  }
} as const;

const propertySummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "publicSlug",
    "name",
    "propertyType",
    "saleMode",
    "shortDescription",
    "locality",
    "city",
    "stateRegion",
    "countryCode",
    "coverMediaId"
  ],
  properties: {
    publicSlug: { type: "string" },
    name: { type: "string" },
    propertyType: nullableString,
    saleMode: nullableString,
    shortDescription: nullableString,
    locality: nullableString,
    city: nullableString,
    stateRegion: nullableString,
    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
    coverMediaId: nullableUuid
  }
} as const;

const roomCategorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "roomCategoryId",
    "code",
    "name",
    "accommodationType",
    "description",
    "baseOccupancy",
    "maxAdults",
    "maxChildren",
    "maxOccupancy",
    "sizeSqm",
    "bedConfiguration",
    "extraBedAllowed",
    "defaultViewLabel"
  ],
  properties: {
    roomCategoryId: { type: "string", format: "uuid" },
    code: { type: "string" },
    name: { type: "string" },
    accommodationType: { type: "string" },
    description: nullableString,
    baseOccupancy: { type: "integer", minimum: 1 },
    maxAdults: { type: "integer", minimum: 1 },
    maxChildren: { type: "integer", minimum: 0 },
    maxOccupancy: { type: "integer", minimum: 1 },
    sizeSqm: nullableNumber,
    bedConfiguration: nullableString,
    extraBedAllowed: { type: "boolean" },
    defaultViewLabel: nullableString
  }
} as const;

const amenitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "name", "category", "details"],
  properties: {
    code: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    details: nullableString
  }
} as const;

const policiesSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "childrenPolicy",
    "petsPolicy",
    "smokingPolicy",
    "partiesEventsPolicy",
    "minimumCheckinAge",
    "quietHoursStart",
    "quietHoursEnd",
    "houseRules"
  ],
  properties: {
    childrenPolicy: { type: "string" },
    petsPolicy: { type: "string" },
    smokingPolicy: { type: "string" },
    partiesEventsPolicy: { type: "string" },
    minimumCheckinAge: nullableInteger,
    quietHoursStart: nullableString,
    quietHoursEnd: nullableString,
    houseRules: nullableString
  }
} as const;

const mediaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "mediaType", "mimeType", "altText", "caption", "isCover", "sortOrder"],
  properties: {
    id: { type: "string", format: "uuid" },
    mediaType: { type: "string", const: "IMAGE" },
    mimeType: nullableString,
    altText: nullableString,
    caption: nullableString,
    isCover: { type: "boolean" },
    sortOrder: { type: "integer" }
  }
} as const;

const propertyDetailSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...propertySummarySchema.required,
    "description",
    "checkInTime",
    "checkOutTime",
    "roomCategories",
    "amenities",
    "policies",
    "media"
  ],
  properties: {
    ...propertySummarySchema.properties,
    description: nullableString,
    checkInTime: nullableString,
    checkOutTime: nullableString,
    roomCategories: { type: "array", items: roomCategorySchema },
    amenities: { type: "array", items: amenitySchema },
    policies: {
      anyOf: [policiesSchema, { type: "null" }]
    },
    media: { type: "array", items: mediaSchema }
  }
} as const;

function setPublicCache(reply: { header(name: string, value: string): unknown }): void {
  void reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
}

export async function registerPublicCatalogRoutes(
  app: FastifyInstance,
  deps: PublicCatalogRouteDependencies
): Promise<void> {
  const service = new PublicCatalogService();

  app.get(
    "/v1/public/destinations",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "List destinations containing live Wildleaf properties",
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["destinations"],
            properties: {
              destinations: { type: "array", items: destinationSchema }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      setPublicCache(reply);
      return service.listDestinations(deps.db);
    }
  );

  app.get<{ Querystring: PublicPropertiesQuery }>(
    "/v1/public/properties",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "List live Wildleaf properties for public discovery",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            destination: {
              type: "string",
              minLength: 1,
              maxLength: 150,
              pattern: ".*\\S.*"
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          }
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["properties"],
            properties: {
              properties: { type: "array", items: propertySummarySchema }
            }
          }
        }
      }
    },
    async (request, reply) => {
      setPublicCache(reply);
      return service.listProperties(deps.db, {
        ...(request.query.destination === undefined
          ? {}
          : { destination: request.query.destination }),
        limit: request.query.limit ?? 50
      });
    }
  );

  app.get<{ Params: PublicPropertyParams }>(
    "/v1/public/properties/:publicSlug",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Get a live property public catalog view",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            }
          }
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["property"],
            properties: {
              property: propertyDetailSchema
            }
          }
        }
      }
    },
    async (request, reply) => {
      setPublicCache(reply);
      return service.getProperty(deps.db, request.params.publicSlug);
    }
  );
}
