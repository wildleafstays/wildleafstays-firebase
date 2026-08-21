import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { PublicAvailabilityService } from "../application/public-availability-service.js";
import { PublicCatalogService } from "../application/public-catalog-service.js";
import type { PublicAvailabilityRequest } from "../domain/public-availability.js";

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

const availabilityUnitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["adults", "children"],
  properties: {
    adults: { type: "integer", minimum: 1, maximum: 100 },
    children: { type: "integer", minimum: 0, maximum: 100 }
  }
} as const;

const publicAvailabilityOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "rateProductId",
    "productType",
    "roomCategoryId",
    "roomCategoryCode",
    "roomCategoryName",
    "ratePlanCode",
    "ratePlanName",
    "mealPlanCode",
    "currencyCode",
    "requestedUnits",
    "available",
    "unavailableReasons",
    "nightlyFromMinor",
    "accommodationMinor",
    "extraGuestMinor",
    "estimatedTotalMinor",
    "minimumStay",
    "maximumStay"
  ],
  properties: {
    rateProductId: { type: "string", format: "uuid" },
    productType: {
      type: "string",
      enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
    },
    roomCategoryId: nullableUuid,
    roomCategoryCode: nullableString,
    roomCategoryName: nullableString,
    ratePlanCode: { type: "string" },
    ratePlanName: { type: "string" },
    mealPlanCode: { type: "string" },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    requestedUnits: { type: "integer", minimum: 1, maximum: 20 },
    available: { type: "boolean" },
    unavailableReasons: {
      type: "array",
      uniqueItems: true,
      items: {
        type: "string",
        enum: [
          "FULL_PROPERTY_SINGLE_UNIT_ONLY",
          "OCCUPANCY_EXCEEDED",
          "ARRIVAL_CLOSED",
          "DEPARTURE_CLOSED",
          "MINIMUM_STAY",
          "MAXIMUM_STAY",
          "RATE_STOP_SELL",
          "INVENTORY_UNAVAILABLE"
        ]
      }
    },
    nightlyFromMinor: { type: "integer", minimum: 0 },
    accommodationMinor: { type: "integer", minimum: 0 },
    extraGuestMinor: { type: "integer", minimum: 0 },
    estimatedTotalMinor: { type: "integer", minimum: 0 },
    minimumStay: { type: "integer", minimum: 1 },
    maximumStay: nullableInteger
  }
} as const;

const publicAvailabilityResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["property", "search", "pricingScope", "exactCommercialPriceIncluded", "options"],
  properties: {
    property: {
      type: "object",
      additionalProperties: false,
      required: ["publicSlug", "name", "saleMode"],
      properties: {
        publicSlug: { type: "string" },
        name: { type: "string" },
        saleMode: {
          type: "string",
          enum: ["ROOMS_ONLY", "FULL_PROPERTY_ONLY", "BOTH"]
        }
      }
    },
    search: {
      type: "object",
      additionalProperties: false,
      required: ["arrivalDate", "departureDate", "nights", "units"],
      properties: {
        arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        nights: { type: "integer", minimum: 1, maximum: 30 },
        units: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: availabilityUnitSchema
        }
      }
    },
    pricingScope: {
      type: "string",
      const: "BASE_RATE_AND_EXTRA_GUEST_ONLY"
    },
    exactCommercialPriceIncluded: { type: "boolean", const: false },
    options: {
      type: "array",
      items: publicAvailabilityOptionSchema
    }
  }
} as const;

function setPublicCache(reply: { header(name: string, value: string): unknown }): void {
  void reply.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
}

function setPublicNoStore(reply: { header(name: string, value: string): unknown }): void {
  void reply.header("cache-control", "no-store");
}

export async function registerPublicCatalogRoutes(
  app: FastifyInstance,
  deps: PublicCatalogRouteDependencies
): Promise<void> {
  const service = new PublicCatalogService();
  const availabilityService = new PublicAvailabilityService();

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

  app.post<{ Params: PublicPropertyParams; Body: PublicAvailabilityRequest }>(
    "/v1/public/properties/:publicSlug/availability",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Preview public availability and base rates for a live property",
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
        body: {
          type: "object",
          additionalProperties: false,
          required: ["arrivalDate", "departureDate", "units"],
          properties: {
            arrivalDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            departureDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            units: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: availabilityUnitSchema
            }
          }
        },
        response: {
          200: publicAvailabilityResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      return availabilityService.search(deps.db, request.params.publicSlug, request.body);
    }
  );
}
