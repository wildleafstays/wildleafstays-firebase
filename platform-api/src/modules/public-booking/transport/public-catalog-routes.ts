import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { PropertyAssetStorage } from "../../../infrastructure/storage/property-asset-storage.js";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError
} from "../../../shared/errors/app-error.js";
import {
  authenticateIfPresent,
  type AuthenticationDependencies
} from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import type { RazorpayOrderGateway } from "../../payments/application/razorpay-order-service.js";
import {
  RazorpayPaymentRecoveryService,
  type RazorpayPaymentRecoveryGateway
} from "../../payments/application/razorpay-payment-recovery-service.js";
import { PublicAvailabilityService } from "../application/public-availability-service.js";
import { PublicCatalogService } from "../application/public-catalog-service.js";
import { PublicCheckoutStatusService } from "../application/public-checkout-status-service.js";
import { PublicCheckoutService } from "../application/public-checkout-service.js";
import { PublicQuoteService } from "../application/public-quote-service.js";
import { PublicRoomRecommendationService } from "../application/public-room-recommendation-service.js";
import { PublicRoomMixService } from "../application/public-room-mix-service.js";
import { PublicCatalogRepository } from "../infrastructure/public-catalog-repository.js";
import type { PublicAvailabilityRequest } from "../domain/public-availability.js";
import type { PublicCheckoutRequest } from "../domain/public-checkout.js";
import type { PublicCheckoutStatusRequest } from "../domain/public-checkout-status.js";
import type { PublicQuoteRequest } from "../domain/public-quote.js";
import type { PublicRoomRecommendationRequest } from "../domain/public-room-recommendation.js";
import type { PublicRoomMixQuoteRequest } from "../domain/public-room-mix.js";
export interface PublicCatalogRouteDependencies {
  db: Kysely<Database>;
  authentication?: AuthenticationDependencies;
  razorpayOrderGateway?: RazorpayOrderGateway | null;
  razorpayPaymentRecoveryGateway?: RazorpayPaymentRecoveryGateway | null;
  propertyAssetStorage?: PropertyAssetStorage;
}

interface PublicPropertiesQuery {
  destination?: string;
  limit?: number;
}

interface PublicPropertyParams {
  publicSlug: string;
}
interface PublicMediaParams extends PublicPropertyParams {
  mediaId: string;
}
interface PublicQuoteParams extends PublicPropertyParams {
  quoteId: string;
}
interface PublicRoomMixParams extends PublicPropertyParams {
  roomMixQuoteId: string;
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
    "coverMediaId",
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
    coverMediaId: nullableUuid,
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
      enum: ["ROOM_CATEGORY", "FULL_PROPERTY", "ROOM_MIX"]
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

const publicRecommendationUnitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["adults", "children"],
  properties: {
    adults: { type: "integer", minimum: 1, maximum: 20 },
    children: { type: "integer", minimum: 0, maximum: 20 }
  }
} as const;

const publicRecommendationItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "roomCategoryId",
    "roomCategoryName",
    "coverMediaId",
    "rateProductId",
    "ratePlanCode",
    "ratePlanName",
    "mealPlanCode",
    "quantity",
    "maxOccupancy",
    "units",
    "estimatedTotalMinor"
  ],
  properties: {
    roomCategoryId: { type: "string", format: "uuid" },
    roomCategoryName: { type: "string" },
    coverMediaId: nullableUuid,
    rateProductId: { type: "string", format: "uuid" },
    ratePlanCode: { type: "string" },
    ratePlanName: { type: "string" },
    mealPlanCode: { type: "string" },
    quantity: { type: "integer", minimum: 1, maximum: 6 },
    maxOccupancy: { type: "integer", minimum: 1 },
    units: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: publicRecommendationUnitSchema
    },
    estimatedTotalMinor: { type: "integer", minimum: 0 }
  }
} as const;

const publicRecommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "recommendationId",
    "rank",
    "reason",
    "roomCount",
    "adults",
    "children",
    "currencyCode",
    "estimatedTotalMinor",
    "occupancySlack",
    "items"
  ],
  properties: {
    recommendationId: { type: "string" },
    rank: { type: "integer", minimum: 1 },
    reason: {
      type: "string",
      enum: ["BEST_VALUE", "FEWER_ROOMS", "MORE_SPACE", "ALTERNATIVE"]
    },
    roomCount: { type: "integer", minimum: 1, maximum: 6 },
    adults: { type: "integer", minimum: 1, maximum: 20 },
    children: { type: "integer", minimum: 0, maximum: 20 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    estimatedTotalMinor: { type: "integer", minimum: 0 },
    occupancySlack: { type: "integer", minimum: 0 },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: publicRecommendationItemSchema
    }
  }
} as const;

const publicRecommendationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "property",
    "search",
    "pricingScope",
    "exactCommercialPriceIncluded",
    "singleCheckoutSupported",
    "recommendations"
  ],
  properties: {
    property: {
      type: "object",
      additionalProperties: false,
      required: ["publicSlug", "name"],
      properties: {
        publicSlug: { type: "string" },
        name: { type: "string" }
      }
    },
    search: {
      type: "object",
      additionalProperties: false,
      required: ["arrivalDate", "departureDate", "adults", "children", "maxRooms"],
      properties: {
        arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        adults: { type: "integer", minimum: 1, maximum: 20 },
        children: { type: "integer", minimum: 0, maximum: 20 },
        maxRooms: { type: "integer", minimum: 1, maximum: 6 }
      }
    },
    pricingScope: { type: "string", const: "BASE_RATE_AND_EXTRA_GUEST_ONLY" },
    exactCommercialPriceIncluded: { type: "boolean", const: false },
    singleCheckoutSupported: { type: "boolean", const: false },
    recommendations: {
      type: "array",
      maxItems: 5,
      items: publicRecommendationSchema
    }
  }
} as const;

const publicIdempotencyHeaders = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 16,
      maxLength: 200,
      pattern: "^[A-Za-z0-9._:-]+$"
    }
  }
} as const;

const publicQuoteUnitSchema = {
  type: "object",
  additionalProperties: false,
  required: ["adults", "childAges"],
  properties: {
    adults: { type: "integer", minimum: 1, maximum: 100 },
    childAges: {
      type: "array",
      maxItems: 100,
      items: { type: "integer", minimum: 0, maximum: 17 }
    }
  }
} as const;

const publicRoomMixQuoteItemSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "itemIndex",
    "quoteId",
    "quoteReference",
    "rateProductId",
    "roomCategoryId",
    "productLabel",
    "ratePlanCode",
    "ratePlanName",
    "mealPlanCode",
    "quantity",
    "accommodationMinor",
    "extraGuestMinor",
    "feeMinor",
    "taxMinor",
    "totalMinor",
    "units"
  ],
  properties: {
    itemIndex: { type: "integer", minimum: 1, maximum: 6 },
    quoteId: { type: "string", format: "uuid" },
    quoteReference: { type: "string" },
    rateProductId: { type: "string", format: "uuid" },
    roomCategoryId: { type: "string", format: "uuid" },
    productLabel: { type: "string" },
    ratePlanCode: { type: "string" },
    ratePlanName: { type: "string" },
    mealPlanCode: { type: "string" },
    quantity: { type: "integer", minimum: 1, maximum: 20 },
    accommodationMinor: { type: "integer", minimum: 0 },
    extraGuestMinor: { type: "integer", minimum: 0 },
    feeMinor: { type: "integer", minimum: 0 },
    taxMinor: { type: "integer", minimum: 0 },
    totalMinor: { type: "integer", minimum: 0 },
    units: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: publicQuoteUnitSchema
    }
  }
} as const;

const publicRoomMixQuoteViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "roomMixReference",
    "arrivalDate",
    "departureDate",
    "quantity",
    "currencyCode",
    "grossAccommodationMinor",
    "grossExtraGuestMinor",
    "discountMinor",
    "feeMinor",
    "taxMinor",
    "totalMinor",
    "expiresAt",
    "holdEligible",
    "checkoutSupported",
    "items"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    roomMixReference: { type: "string" },
    arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    quantity: { type: "integer", minimum: 2, maximum: 20 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    grossAccommodationMinor: { type: "integer", minimum: 0 },
    grossExtraGuestMinor: { type: "integer", minimum: 0 },
    discountMinor: { type: "integer", minimum: 0 },
    feeMinor: { type: "integer", minimum: 0 },
    taxMinor: { type: "integer", minimum: 0 },
    totalMinor: { type: "integer", minimum: 0 },
    expiresAt: { type: "string" },
    holdEligible: { type: "boolean", const: true },
    checkoutSupported: { type: "boolean", const: true },
    items: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: publicRoomMixQuoteItemSchema
    }
  }
} as const;

const publicRoomMixQuoteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["roomMixQuote"],
  properties: {
    roomMixQuote: publicRoomMixQuoteViewSchema
  }
} as const;

const publicRoomMixHoldResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["created", "roomMixQuoteId", "roomMixReference", "hold"],
  properties: {
    created: { type: "boolean" },
    roomMixQuoteId: { type: "string", format: "uuid" },
    roomMixReference: { type: "string" },
    hold: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status", "startDate", "endDate", "expiresAt", "items"],
      properties: {
        id: { type: "string", format: "uuid" },
        status: { type: "string", const: "ACTIVE" },
        startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        expiresAt: { type: "string" },
        items: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["bucketType", "roomCategoryId", "quantity"],
            properties: {
              bucketType: { type: "string", const: "ROOM_CATEGORY" },
              roomCategoryId: { type: "string", format: "uuid" },
              quantity: { type: "integer", minimum: 1, maximum: 20 }
            }
          }
        }
      }
    }
  }
} as const;

const publicQuoteGuestAgePolicySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "infantMaxAge",
    "childMaxAge",
    "infantsCountTowardsOccupancy",
    "infantsCountTowardsChildLimit",
    "infantsChargeAsChildren"
  ],
  properties: {
    infantMaxAge: nullableInteger,
    childMaxAge: { type: "integer", minimum: 0, maximum: 17 },
    infantsCountTowardsOccupancy: { type: "boolean" },
    infantsCountTowardsChildLimit: { type: "boolean" },
    infantsChargeAsChildren: { type: "boolean" }
  }
} as const;

const publicQuoteUnitViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "unitIndex",
    "adults",
    "childAges",
    "children",
    "infants",
    "occupancyCount",
    "childLimitCount",
    "chargeableChildren",
    "extraAdults",
    "extraChildren"
  ],
  properties: {
    unitIndex: { type: "integer", minimum: 1 },
    adults: { type: "integer", minimum: 1 },
    childAges: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 17 }
    },
    children: { type: "integer", minimum: 0 },
    infants: { type: "integer", minimum: 0 },
    occupancyCount: { type: "integer", minimum: 1 },
    childLimitCount: { type: "integer", minimum: 0 },
    chargeableChildren: { type: "integer", minimum: 0 },
    extraAdults: { type: "integer", minimum: 0 },
    extraChildren: { type: "integer", minimum: 0 }
  }
} as const;

const publicCancellationTierSchema = {
  type: "object",
  additionalProperties: false,
  required: ["triggerType", "minimumMinutesBeforeArrival", "penaltyType", "penaltyValue"],
  properties: {
    triggerType: {
      type: "string",
      enum: ["CANCELLATION", "NO_SHOW"]
    },
    minimumMinutesBeforeArrival: nullableInteger,
    penaltyType: {
      type: "string",
      enum: ["PERCENTAGE_OF_STAY", "FIXED_AMOUNT", "NIGHTS"]
    },
    penaltyValue: { type: "integer", minimum: 0 }
  }
} as const;

const publicCancellationPolicySchema = {
  type: "object",
  additionalProperties: false,
  required: ["policyCode", "policyName", "arrivalLocalTime", "currencyCode", "policyText", "tiers"],
  properties: {
    policyCode: { type: "string" },
    policyName: { type: "string" },
    arrivalLocalTime: { type: "string" },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    policyText: nullableString,
    tiers: {
      type: "array",
      items: publicCancellationTierSchema
    }
  }
} as const;

const publicPromotionLineSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "campaignCode",
    "campaignName",
    "promotionKind",
    "publicCode",
    "discountType",
    "discountValue",
    "maximumDiscountMinor",
    "appliesTo",
    "discountMinor"
  ],
  properties: {
    campaignCode: { type: "string" },
    campaignName: { type: "string" },
    promotionKind: {
      type: "string",
      enum: ["AUTOMATIC", "PROMO_CODE"]
    },
    publicCode: nullableString,
    discountType: {
      type: "string",
      enum: ["PERCENTAGE", "FIXED_AMOUNT"]
    },
    discountValue: { type: "integer", minimum: 0 },
    maximumDiscountMinor: nullableInteger,
    appliesTo: {
      type: "string",
      enum: ["ACCOMMODATION", "ACCOMMODATION_AND_EXTRA_GUEST"]
    },
    discountMinor: { type: "integer", minimum: 0 }
  }
} as const;

const publicPromotionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["promotionMode", "requestedPromotionCode", "discountMinor", "lines"],
  properties: {
    promotionMode: {
      type: "string",
      enum: ["NO_PROMOTIONS", "POLICIES"]
    },
    requestedPromotionCode: nullableString,
    discountMinor: { type: "integer", minimum: 0 },
    lines: {
      type: "array",
      items: publicPromotionLineSchema
    }
  }
} as const;

const publicQuoteViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "quoteReference",
    "rateProductId",
    "productType",
    "productLabel",
    "roomCategoryId",
    "ratePlanCode",
    "ratePlanName",
    "mealPlanCode",
    "arrivalDate",
    "departureDate",
    "quantity",
    "currencyCode",
    "pricingScope",
    "exactCommercialPriceIncluded",
    "accommodationMinor",
    "extraGuestMinor",
    "discountMinor",
    "discountedAccommodationMinor",
    "discountedExtraGuestMinor",
    "inclusiveFeeMinor",
    "exclusiveFeeMinor",
    "feeMinor",
    "inclusiveTaxMinor",
    "exclusiveTaxMinor",
    "taxMinor",
    "totalMinor",
    "commercialStatus",
    "promotionStatus",
    "holdEligible",
    "expiresAt",
    "createdAt",
    "guestAgePolicy",
    "units",
    "cancellationPolicy",
    "promotion"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    quoteReference: { type: "string" },
    rateProductId: { type: "string", format: "uuid" },
    productType: {
      type: "string",
      enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
    },
    productLabel: { type: "string" },
    roomCategoryId: nullableUuid,
    ratePlanCode: { type: "string" },
    ratePlanName: { type: "string" },
    mealPlanCode: { type: "string" },
    arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    quantity: { type: "integer", minimum: 1, maximum: 20 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    pricingScope: {
      type: "string",
      const: "FINAL_COMMERCIAL_PRICE"
    },
    exactCommercialPriceIncluded: { type: "boolean", const: true },
    accommodationMinor: { type: "integer", minimum: 0 },
    extraGuestMinor: { type: "integer", minimum: 0 },
    discountMinor: { type: "integer", minimum: 0 },
    discountedAccommodationMinor: { type: "integer", minimum: 0 },
    discountedExtraGuestMinor: { type: "integer", minimum: 0 },
    inclusiveFeeMinor: { type: "integer", minimum: 0 },
    exclusiveFeeMinor: { type: "integer", minimum: 0 },
    feeMinor: { type: "integer", minimum: 0 },
    inclusiveTaxMinor: { type: "integer", minimum: 0 },
    exclusiveTaxMinor: { type: "integer", minimum: 0 },
    taxMinor: { type: "integer", minimum: 0 },
    totalMinor: { type: "integer", minimum: 0 },
    commercialStatus: {
      type: "string",
      const: "COMMERCIAL_RULES_APPLIED"
    },
    promotionStatus: { type: "string", const: "EVALUATED" },
    holdEligible: { type: "boolean", const: true },
    expiresAt: { type: "string" },
    createdAt: { type: "string" },
    guestAgePolicy: publicQuoteGuestAgePolicySchema,
    units: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: publicQuoteUnitViewSchema
    },
    cancellationPolicy: publicCancellationPolicySchema,
    promotion: publicPromotionSchema
  }
} as const;

const publicQuoteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote"],
  properties: {
    quote: publicQuoteViewSchema
  }
} as const;

const publicHoldItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bucketType", "roomCategoryId", "quantity"],
  properties: {
    bucketType: {
      type: "string",
      enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
    },
    roomCategoryId: nullableUuid,
    quantity: { type: "integer", minimum: 1 }
  }
} as const;

const publicHoldViewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "status",
    "startDate",
    "endDate",
    "expiresAt",
    "clientReference",
    "items",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    status: { type: "string", const: "ACTIVE" },
    startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    endDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    expiresAt: { type: "string" },
    clientReference: nullableString,
    items: {
      type: "array",
      minItems: 1,
      items: publicHoldItemSchema
    },
    createdAt: { type: "string" }
  }
} as const;

const publicQuoteHoldResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["created", "quoteId", "quoteReference", "hold"],
  properties: {
    created: { type: "boolean" },
    quoteId: { type: "string", format: "uuid" },
    quoteReference: { type: "string" },
    hold: publicHoldViewSchema
  }
} as const;

const publicLeadGuestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    email: {
      anyOf: [{ type: "string", minLength: 3, maxLength: 320 }, { type: "null" }]
    },
    phone: {
      anyOf: [{ type: "string", minLength: 8, maxLength: 40 }, { type: "null" }]
    }
  }
} as const;

const publicCheckoutRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["leadGuest"],
  properties: {
    leadGuest: publicLeadGuestSchema
  }
} as const;

const publicCheckoutReservationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "reservationReference",
    "quoteId",
    "roomMixQuoteId",
    "status",
    "holdExpiresAt",
    "arrivalDate",
    "departureDate",
    "productType",
    "roomCategoryId",
    "quantity",
    "currencyCode",
    "totalMinor",
    "leadGuest"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    reservationReference: { type: "string" },
    quoteId: nullableUuid,
    roomMixQuoteId: nullableUuid,
    status: { type: "string", const: "PAYMENT_PENDING" },
    holdExpiresAt: { type: "string" },
    arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    productType: {
      type: "string",
      enum: ["ROOM_CATEGORY", "FULL_PROPERTY"]
    },
    roomCategoryId: nullableUuid,
    quantity: { type: "integer", minimum: 1 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    totalMinor: { type: "integer", minimum: 1 },
    leadGuest: {
      type: "object",
      additionalProperties: false,
      required: ["name", "email", "phone"],
      properties: {
        name: { type: "string" },
        email: nullableString,
        phone: nullableString
      }
    }
  }
} as const;

const publicPaymentIntentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "paymentReference",
    "reservationId",
    "status",
    "amountMinor",
    "currencyCode",
    "expiresAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    paymentReference: { type: "string" },
    reservationId: { type: "string", format: "uuid" },
    status: { type: "string", const: "PENDING" },
    amountMinor: { type: "integer", minimum: 1 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    expiresAt: { type: "string" }
  }
} as const;

const publicRazorpayCheckoutSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "keyId",
    "orderId",
    "paymentIntentId",
    "reservationId",
    "amountMinor",
    "currencyCode",
    "receipt",
    "expiresAt"
  ],
  properties: {
    keyId: { type: "string" },
    orderId: { type: "string" },
    paymentIntentId: { type: "string", format: "uuid" },
    reservationId: { type: "string", format: "uuid" },
    amountMinor: { type: "integer", minimum: 1 },
    currencyCode: { type: "string", minLength: 3, maxLength: 3 },
    receipt: { type: "string" },
    expiresAt: { type: "string" }
  }
} as const;

const publicCheckoutResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservation", "paymentIntent", "checkout"],
  properties: {
    reservation: publicCheckoutReservationSchema,
    paymentIntent: publicPaymentIntentSchema,
    checkout: publicRazorpayCheckoutSchema
  }
} as const;

const publicCheckoutStatusRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reservationId", "paymentIntentId"],
  properties: {
    reservationId: { type: "string", format: "uuid" },
    paymentIntentId: { type: "string", format: "uuid" }
  }
} as const;

const publicCheckoutStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "reservation", "paymentIntent"],
  properties: {
    outcome: {
      type: "string",
      enum: ["PAYMENT_PENDING", "CONFIRMED", "PAYMENT_FAILED", "CLOSED", "REQUIRES_ASSISTANCE"]
    },
    reservation: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "reservationReference",
        "status",
        "arrivalDate",
        "departureDate",
        "holdExpiresAt",
        "holdExpired"
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        reservationReference: { type: "string" },
        status: {
          type: "string",
          enum: [
            "HELD",
            "PAYMENT_PENDING",
            "CONFIRMED",
            "CHECKED_IN",
            "CHECKED_OUT",
            "CANCELLED",
            "EXPIRED",
            "NO_SHOW"
          ]
        },
        arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        holdExpiresAt: { type: "string" },
        holdExpired: { type: "boolean" }
      }
    },
    paymentIntent: {
      type: "object",
      additionalProperties: false,
      required: ["id", "status", "expiresAt", "expired"],
      properties: {
        id: { type: "string", format: "uuid" },
        status: {
          type: "string",
          enum: ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]
        },
        expiresAt: { type: "string" },
        expired: { type: "boolean" }
      }
    }
  }
} as const;

function requirePublicIdempotencyKey(headers: Record<string, unknown>): string {
  const key = headers["idempotency-key"];
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{16,200}$/.test(key)) {
    throw new ValidationError("A valid public idempotency key is required");
  }
  return key;
}

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
  const catalogRepository = new PublicCatalogRepository();
  const availabilityService = new PublicAvailabilityService();
  const publicQuoteService = new PublicQuoteService();
  const roomRecommendationService = new PublicRoomRecommendationService();
  const roomMixService = new PublicRoomMixService();
  const publicCheckoutStatusService = new PublicCheckoutStatusService(
    deps.razorpayPaymentRecoveryGateway
      ? new RazorpayPaymentRecoveryService(deps.db, deps.razorpayPaymentRecoveryGateway)
      : null
  );
  const publicCheckoutService = new PublicCheckoutService(
    deps.db,
    deps.razorpayOrderGateway ?? null
  );
  const idempotency = new IdempotencyService(deps.db);
  const optionalAuthentication = deps.authentication
    ? authenticateIfPresent(deps.authentication)
    : async function rejectUnconfiguredAuthentication(request: FastifyRequest): Promise<void> {
        if (request.headers.authorization !== undefined) {
          throw new AuthenticationError(
            "Authentication is not configured for this public route registrar"
          );
        }
      };

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

  app.get<{ Params: PublicMediaParams }>(
    "/v1/public/properties/:publicSlug/media/:mediaId",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Open a published property or room-category image",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug", "mediaId"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            },
            mediaId: { type: "string", format: "uuid" }
          }
        }
      }
    },
    async (request, reply) => {
      if (!deps.propertyAssetStorage) throw new NotFoundError("Published image not found");
      const media = await catalogRepository.findPublicMediaStorage(
        deps.db,
        request.params.publicSlug.toLowerCase(),
        request.params.mediaId
      );
      if (!media) throw new NotFoundError("Published image not found");
      const url = await deps.propertyAssetStorage.createReadUrl(
        media.storage_key,
        new Date(Date.now() + 10 * 60 * 1000)
      );
      void reply.header("cache-control", "public, max-age=300");
      return reply.redirect(url);
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

  app.post<{ Params: PublicPropertyParams; Body: PublicRoomRecommendationRequest }>(
    "/v1/public/properties/:publicSlug/room-recommendations",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Recommend mixed room-category combinations for a guest party",
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
          required: ["arrivalDate", "departureDate", "adults", "children"],
          properties: {
            arrivalDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            departureDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            adults: { type: "integer", minimum: 1, maximum: 20 },
            children: { type: "integer", minimum: 0, maximum: 20 },
            maxRooms: { type: "integer", minimum: 1, maximum: 6 }
          }
        },
        response: {
          200: publicRecommendationResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      return roomRecommendationService.recommend(deps.db, request.params.publicSlug, request.body);
    }
  );

  app.post<{ Params: PublicPropertyParams; Body: PublicRoomMixQuoteRequest }>(
    "/v1/public/properties/:publicSlug/room-mixes/quotes",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Create an exact mixed-room quote using canonical room pricing",
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
        headers: publicIdempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["arrivalDate", "departureDate", "items"],
          properties: {
            arrivalDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            departureDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            items: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["rateProductId", "units"],
                properties: {
                  rateProductId: { type: "string", format: "uuid" },
                  units: {
                    type: "array",
                    minItems: 1,
                    maxItems: 20,
                    items: publicQuoteUnitSchema
                  }
                }
              }
            }
          }
        },
        response: {
          201: publicRoomMixQuoteResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      const key = requirePublicIdempotencyKey(request.headers);
      const body: PublicRoomMixQuoteRequest = {
        arrivalDate: request.body.arrivalDate,
        departureDate: request.body.departureDate,
        items: request.body.items.map((item) => ({
          rateProductId: item.rateProductId,
          units: item.units.map((unit) => ({
            adults: unit.adults,
            childAges: [...unit.childAges]
          }))
        }))
      };

      const result = await idempotency.execute(
        {
          scopeKey: `public.room-mix.quote.create:${request.params.publicSlug.toLowerCase()}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await roomMixService.createQuote(
            trx,
            request.params.publicSlug,
            body,
            requestMetadata(request, "public-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PublicRoomMixParams }>(
    "/v1/public/properties/:publicSlug/room-mixes/:roomMixQuoteId/hold",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Atomically hold every room category in a mixed-room quote",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug", "roomMixQuoteId"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            },
            roomMixQuoteId: { type: "string", format: "uuid" }
          }
        },
        headers: publicIdempotencyHeaders,
        response: {
          200: publicRoomMixHoldResponseSchema,
          201: publicRoomMixHoldResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      const key = requirePublicIdempotencyKey(request.headers);
      const requestBody = {
        publicSlug: request.params.publicSlug.toLowerCase(),
        roomMixQuoteId: request.params.roomMixQuoteId
      };

      const result = await idempotency.execute(
        {
          scopeKey:
            `public.room-mix.hold:${request.params.publicSlug.toLowerCase()}:` +
            request.params.roomMixQuoteId,
          key,
          requestBody
        },
        async (trx) => {
          const body = await roomMixService.createHold(
            trx,
            request.params.publicSlug,
            request.params.roomMixQuoteId,
            requestMetadata(request, "public-api")
          );
          return {
            statusCode: body.created ? 201 : 200,
            body
          };
        }
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PublicRoomMixParams; Body: PublicCheckoutRequest }>(
    "/v1/public/properties/:publicSlug/room-mixes/:roomMixQuoteId/checkout",
    {
      preHandler: optionalAuthentication,
      schema: {
        tags: ["Public Booking"],
        security: [{}, { bearerAuth: [] }],
        summary: "Create one reservation and Razorpay checkout for a mixed-room hold",
        description:
          "Creates one canonical ROOM_MIX reservation and one payment intent from the active multi-category inventory hold. The existing payment confirmation path later confirms the entire hold atomically.",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug", "roomMixQuoteId"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            },
            roomMixQuoteId: { type: "string", format: "uuid" }
          }
        },
        headers: publicIdempotencyHeaders,
        body: publicCheckoutRequestSchema,
        response: {
          201: publicCheckoutResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      publicCheckoutService.assertProviderAvailable();

      const key = requirePublicIdempotencyKey(request.headers);
      const metadata = requestMetadata(request, "public-api");
      const body: PublicCheckoutRequest = {
        leadGuest: {
          name: request.body.leadGuest.name,
          email: request.body.leadGuest.email ?? null,
          phone: request.body.leadGuest.phone ?? null
        }
      };
      const idempotencyRequestBody = {
        ...body,
        guestAccountUserId: request.actor?.userId ?? null
      };

      const result = await idempotency.execute(
        {
          scopeKey:
            `public.room-mix.checkout:${request.params.publicSlug.toLowerCase()}:` +
            request.params.roomMixQuoteId,
          key,
          requestBody: idempotencyRequestBody
        },
        async (trx) => ({
          statusCode: 201,
          body: await publicCheckoutService.createRoomMixReservationPayment(
            trx,
            request.params.publicSlug,
            request.params.roomMixQuoteId,
            body,
            metadata,
            request.actor
          )
        })
      );

      const checkout = await publicCheckoutService.prepareCheckout(
        request.params.publicSlug,
        result.body.reservation.id,
        result.body.paymentIntent.id,
        metadata
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");

      return reply.status(result.statusCode).send({
        ...result.body,
        checkout
      });
    }
  );

  app.post<{ Params: PublicPropertyParams; Body: PublicQuoteRequest }>(
    "/v1/public/properties/:publicSlug/quotes",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Create an exact immutable public quote",
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
        headers: publicIdempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["rateProductId", "arrivalDate", "departureDate", "units"],
          properties: {
            rateProductId: { type: "string", format: "uuid" },
            arrivalDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            departureDate: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$"
            },
            promotionCode: {
              anyOf: [
                {
                  type: "string",
                  minLength: 3,
                  maxLength: 40,
                  pattern: "^[A-Za-z0-9_-]+$"
                },
                { type: "null" }
              ]
            },
            units: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: publicQuoteUnitSchema
            }
          }
        },
        response: {
          201: publicQuoteResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      const key = requirePublicIdempotencyKey(request.headers);
      const body: PublicQuoteRequest = {
        rateProductId: request.body.rateProductId,
        arrivalDate: request.body.arrivalDate,
        departureDate: request.body.departureDate,
        promotionCode: request.body.promotionCode ?? null,
        units: request.body.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges]
        }))
      };

      const result = await idempotency.execute(
        {
          scopeKey: `public.quote.create:${request.params.publicSlug.toLowerCase()}`,
          key,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await publicQuoteService.createQuote(
            trx,
            request.params.publicSlug,
            body,
            requestMetadata(request, "public-api")
          )
        })
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PublicQuoteParams }>(
    "/v1/public/properties/:publicSlug/quotes/:quoteId/hold",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Atomically convert a public quote into an inventory hold",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug", "quoteId"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            },
            quoteId: { type: "string", format: "uuid" }
          }
        },
        headers: publicIdempotencyHeaders,
        response: {
          200: publicQuoteHoldResponseSchema,
          201: publicQuoteHoldResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      const key = requirePublicIdempotencyKey(request.headers);
      const requestBody = {
        publicSlug: request.params.publicSlug.toLowerCase(),
        quoteId: request.params.quoteId
      };

      const result = await idempotency.execute(
        {
          scopeKey: `public.quote.hold:${request.params.publicSlug.toLowerCase()}:${request.params.quoteId}`,
          key,
          requestBody
        },
        async (trx) => {
          const body = await publicQuoteService.createHold(
            trx,
            request.params.publicSlug,
            request.params.quoteId,
            requestMetadata(request, "public-api")
          );
          return {
            statusCode: body.created ? 201 : 200,
            body
          };
        }
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PublicQuoteParams; Body: PublicCheckoutRequest }>(
    "/v1/public/properties/:publicSlug/quotes/:quoteId/checkout",
    {
      preHandler: optionalAuthentication,
      schema: {
        tags: ["Public Booking"],
        security: [{}, { bearerAuth: [] }],
        summary: "Create a public reservation and prepare Razorpay checkout",
        description:
          "Creates the canonical HELD reservation and provider-neutral payment intent atomically from the active public quote hold, then prepares the Razorpay order only after that database transaction commits. Browser callbacks never confirm the reservation.",
        params: {
          type: "object",
          additionalProperties: false,
          required: ["publicSlug", "quoteId"],
          properties: {
            publicSlug: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$"
            },
            quoteId: { type: "string", format: "uuid" }
          }
        },
        headers: publicIdempotencyHeaders,
        body: publicCheckoutRequestSchema,
        response: {
          201: publicCheckoutResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      publicCheckoutService.assertProviderAvailable();

      const key = requirePublicIdempotencyKey(request.headers);
      const metadata = requestMetadata(request, "public-api");
      const body: PublicCheckoutRequest = {
        leadGuest: {
          name: request.body.leadGuest.name,
          email: request.body.leadGuest.email ?? null,
          phone: request.body.leadGuest.phone ?? null
        }
      };
      const idempotencyRequestBody = {
        ...body,
        guestAccountUserId: request.actor?.userId ?? null
      };

      const result = await idempotency.execute(
        {
          scopeKey:
            `public.checkout:${request.params.publicSlug.toLowerCase()}:` + request.params.quoteId,
          key,
          requestBody: idempotencyRequestBody
        },
        async (trx) => ({
          statusCode: 201,
          body: await publicCheckoutService.createReservationPayment(
            trx,
            request.params.publicSlug,
            request.params.quoteId,
            body,
            metadata,
            request.actor
          )
        })
      );

      const checkout = await publicCheckoutService.prepareCheckout(
        request.params.publicSlug,
        result.body.reservation.id,
        result.body.paymentIntent.id,
        metadata
      );

      if (result.replayed) void reply.header("idempotency-replayed", "true");

      return reply.status(result.statusCode).send({
        ...result.body,
        checkout
      });
    }
  );

  app.post<{ Params: PublicPropertyParams; Body: PublicCheckoutStatusRequest }>(
    "/v1/public/properties/:publicSlug/checkout-status",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Read canonical public checkout status",
        description:
          "Returns a minimal non-PII status view and securely reconciles a pending Razorpay payment when provider confirmation is available.",
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
        body: publicCheckoutStatusRequestSchema,
        response: {
          200: publicCheckoutStatusResponseSchema
        }
      }
    },
    async (request, reply) => {
      setPublicNoStore(reply);
      return publicCheckoutStatusService.getStatus(
        deps.db,
        request.params.publicSlug,
        request.body,
        requestMetadata(request, "public-api")
      );
    }
  );
}
