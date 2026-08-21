import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { QuoteHoldService } from "../../quotes/application/quote-hold-service.js";
import { stayNightCount } from "../../quotes/application/quote-calculator.js";
import { QuoteService } from "../../quotes/application/quote-service.js";
import type { QuoteView } from "../../quotes/domain/quote.js";
import type { QuoteHoldResult } from "../../quotes/domain/quote-hold.js";
import type {
  PublicQuoteHoldResult,
  PublicQuoteRequest,
  PublicQuoteResult,
  PublicQuoteView
} from "../domain/public-quote.js";
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";

const PUBLIC_QUOTE_TTL_SECONDS = 900;
const MAX_PUBLIC_STAY_NIGHTS = 30;
const MAX_PUBLIC_UNITS = 20;

function exactPublicQuoteView(quote: QuoteView): PublicQuoteView {
  const commercial = quote.commercial;
  const promotion = quote.promotion;

  if (
    quote.commercialStatus !== "COMMERCIAL_RULES_APPLIED" ||
    quote.promotionStatus !== "EVALUATED" ||
    !quote.holdEligible ||
    commercial === null ||
    promotion === null
  ) {
    throw new ConflictError(
      "Exact public pricing is unavailable because commercial configuration is incomplete"
    );
  }

  return {
    id: quote.id,
    quoteReference: quote.quoteReference,
    rateProductId: quote.rateProductId,
    productType: quote.productType,
    productLabel: quote.productLabel,
    roomCategoryId: quote.roomCategoryId,
    ratePlanCode: quote.ratePlanCode,
    ratePlanName: quote.ratePlanName,
    mealPlanCode: quote.mealPlanCode,
    arrivalDate: quote.arrivalDate,
    departureDate: quote.departureDate,
    quantity: quote.quantity,
    currencyCode: quote.currencyCode,
    pricingScope: "FINAL_COMMERCIAL_PRICE",
    exactCommercialPriceIncluded: true,
    accommodationMinor: quote.accommodationMinor,
    extraGuestMinor: quote.extraGuestMinor,
    discountMinor: quote.discountMinor,
    discountedAccommodationMinor: quote.discountedAccommodationMinor,
    discountedExtraGuestMinor: quote.discountedExtraGuestMinor,
    inclusiveFeeMinor: quote.inclusiveFeeMinor,
    exclusiveFeeMinor: quote.exclusiveFeeMinor,
    feeMinor: quote.feeMinor,
    inclusiveTaxMinor: quote.inclusiveTaxMinor,
    exclusiveTaxMinor: quote.exclusiveTaxMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    commercialStatus: "COMMERCIAL_RULES_APPLIED",
    promotionStatus: "EVALUATED",
    holdEligible: true,
    expiresAt: quote.expiresAt,
    createdAt: quote.createdAt,
    guestAgePolicy: {
      infantMaxAge: commercial.guestAgePolicy.infantMaxAge,
      childMaxAge: commercial.guestAgePolicy.childMaxAge,
      infantsCountTowardsOccupancy: commercial.guestAgePolicy.infantsCountTowardsOccupancy,
      infantsCountTowardsChildLimit: commercial.guestAgePolicy.infantsCountTowardsChildLimit,
      infantsChargeAsChildren: commercial.guestAgePolicy.infantsChargeAsChildren
    },
    units: quote.units.map((unit) => ({
      unitIndex: unit.unitIndex,
      adults: unit.adults,
      childAges: [...unit.childAges],
      children: unit.children,
      infants: unit.infants,
      occupancyCount: unit.occupancyCount,
      childLimitCount: unit.childLimitCount,
      chargeableChildren: unit.chargeableChildren,
      extraAdults: unit.extraAdults,
      extraChildren: unit.extraChildren
    })),
    cancellationPolicy: {
      policyCode: commercial.cancellationPolicy.policyCode,
      policyName: commercial.cancellationPolicy.policyName,
      arrivalLocalTime: commercial.cancellationPolicy.arrivalLocalTime,
      currencyCode: commercial.cancellationPolicy.currencyCode,
      policyText: commercial.cancellationPolicy.policyText,
      tiers: commercial.cancellationPolicy.tiers.map((tier) => ({
        triggerType: tier.triggerType,
        minimumMinutesBeforeArrival: tier.minimumMinutesBeforeArrival,
        penaltyType: tier.penaltyType,
        penaltyValue: tier.penaltyValue
      }))
    },
    promotion: {
      promotionMode: promotion.promotionMode,
      requestedPromotionCode: promotion.requestedPromotionCode,
      discountMinor: promotion.discountMinor,
      lines: promotion.lines.map((line) => ({
        campaignCode: line.campaignCode,
        campaignName: line.campaignName,
        promotionKind: line.promotionKind,
        publicCode: line.publicCode,
        discountType: line.discountType,
        discountValue: line.discountValue,
        maximumDiscountMinor: line.maximumDiscountMinor,
        appliesTo: line.appliesTo,
        discountMinor: line.discountMinor
      }))
    }
  };
}

function publicHoldView(result: QuoteHoldResult): PublicQuoteHoldResult {
  const hold = result.quoteHold.hold;
  if (hold.status !== "ACTIVE") {
    throw new ConflictError("Public quote is not linked to an active inventory hold");
  }

  return {
    created: result.created,
    quoteId: result.quoteHold.quoteId,
    quoteReference: result.quoteHold.quoteReference,
    hold: {
      id: hold.id,
      status: "ACTIVE",
      startDate: hold.startDate,
      endDate: hold.endDate,
      expiresAt: hold.expiresAt,
      clientReference: hold.clientReference,
      items: hold.items.map((item) => ({
        bucketType: item.bucketType,
        roomCategoryId: item.roomCategoryId,
        quantity: item.quantity
      })),
      createdAt: hold.createdAt
    }
  };
}

export class PublicQuoteService {
  constructor(
    private readonly properties = new PublicAvailabilityRepository(),
    private readonly quotes = new QuoteService(),
    private readonly holds = new QuoteHoldService()
  ) {}

  private async liveProperty(trx: Transaction<Database>, publicSlug: string) {
    const property = await this.properties.findLivePropertyBySlug(trx, publicSlug.toLowerCase());
    if (!property) {
      throw new NotFoundError("Public property not found");
    }
    return property;
  }

  async createQuote(
    trx: Transaction<Database>,
    publicSlug: string,
    input: PublicQuoteRequest,
    request: RequestMetadata
  ): Promise<PublicQuoteResult> {
    const nights = stayNightCount(input.arrivalDate, input.departureDate);
    if (nights > MAX_PUBLIC_STAY_NIGHTS) {
      throw new ValidationError(`Public quotes cannot exceed ${MAX_PUBLIC_STAY_NIGHTS} nights`);
    }
    if (input.units.length < 1 || input.units.length > MAX_PUBLIC_UNITS) {
      throw new ValidationError(`Public quotes require between 1 and ${MAX_PUBLIC_UNITS} units`);
    }

    const property = await this.liveProperty(trx, publicSlug);
    const created = await this.quotes.createSystemQuote(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        rateProductId: input.rateProductId,
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        ttlSeconds: PUBLIC_QUOTE_TTL_SECONDS,
        promotionCode: input.promotionCode ?? null,
        units: input.units.map((unit) => ({
          adults: unit.adults,
          childAges: [...unit.childAges]
        }))
      },
      request
    );

    return { quote: exactPublicQuoteView(created.quote) };
  }

  async createHold(
    trx: Transaction<Database>,
    publicSlug: string,
    quoteId: string,
    request: RequestMetadata
  ): Promise<PublicQuoteHoldResult> {
    const property = await this.liveProperty(trx, publicSlug);
    const result = await this.holds.createFromQuoteSystem(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        quoteId
      },
      request
    );

    return publicHoldView(result);
  }
}
