import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";
import type { CommercialScopeType } from "../domain/commercial-rules.js";
import type {
  ResolvedPromotionCampaign,
  ResolvedPromotionQuoteContext
} from "../domain/promotion-quote-resolution.js";
import type {
  PromotionAppliesTo,
  PromotionDiscountType,
  PromotionKind,
  PromotionMode,
  PromotionStackingMode
} from "../domain/promotion-rules.js";
import {
  PromotionQuoteRepository,
  type PromotionQuoteAssignmentRecord,
  type PromotionQuoteResolutionData
} from "../infrastructure/promotion-quote-repository.js";

interface ResolveInput {
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  rateProductId: string;
  arrivalDate: string;
  requestedPromotionCode: string | null;
  currencyCode: string;
  quoteCreatedAt: Date;
  stayNights: number;
  accommodationMinor: number;
  extraGuestMinor: number;
}

function latestEffective<T extends { effective_from: string }>(
  rows: T[],
  targetDate: string
): T | undefined {
  let latest: T | undefined;
  for (const row of rows) {
    if (
      row.effective_from <= targetDate &&
      (!latest || row.effective_from > latest.effective_from)
    ) {
      latest = row;
    }
  }
  return latest;
}

function applicableAssignment(
  rows: PromotionQuoteAssignmentRecord[],
  campaignId: string,
  targetDate: string,
  ratePlanId: string,
  rateProductId: string
): PromotionQuoteAssignmentRecord | undefined {
  const candidates = rows.filter(
    (row) => row.promotion_campaign_id === campaignId && row.effective_from <= targetDate
  );

  const latestFor = (scope: CommercialScopeType): PromotionQuoteAssignmentRecord | undefined => {
    const scoped = candidates.filter((row) => {
      if (row.scope_type !== scope) return false;
      if (scope === "RATE_PRODUCT") return row.rate_product_id === rateProductId;
      if (scope === "RATE_PLAN") return row.rate_plan_id === ratePlanId;
      return row.rate_plan_id === null && row.rate_product_id === null;
    });
    return latestEffective(scoped, targetDate);
  };

  return latestFor("RATE_PRODUCT") ?? latestFor("RATE_PLAN") ?? latestFor("PROPERTY");
}

function dateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new ConflictError("Unable to resolve the property's local booking date");
  }
  return `${year}-${month}-${day}`;
}

function normalizePromotionCode(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) {
    throw new ValidationError("promotionCode must use 3-40 letters, numbers, _ or -");
  }
  return normalized;
}

function withinWindow(target: string, start: string | null, end: string | null): boolean {
  if (start !== null && target < start) return false;
  if (end !== null && target > end) return false;
  return true;
}

function eligibleSpend(
  appliesTo: PromotionAppliesTo,
  accommodationMinor: number,
  extraGuestMinor: number
): number {
  return appliesTo === "ACCOMMODATION" ? accommodationMinor : accommodationMinor + extraGuestMinor;
}

function resolveCampaign(
  data: PromotionQuoteResolutionData,
  campaignId: string,
  assignment: PromotionQuoteAssignmentRecord,
  bookingDate: string,
  input: ResolveInput
): ResolvedPromotionCampaign {
  const campaign = data.campaigns.find((row) => row.id === campaignId);
  if (!campaign) {
    throw new ConflictError("Promotion assignment references a missing campaign", {
      promotionCampaignId: campaignId
    });
  }

  const version = latestEffective(
    data.campaignVersions.filter((row) => row.promotion_campaign_id === campaignId),
    bookingDate
  );
  if (!version) {
    throw new ConflictError("Enabled promotion campaign has no version effective on booking date", {
      promotionCampaignId: campaignId,
      bookingDate
    });
  }

  if (version.currency_code !== input.currencyCode) {
    throw new ConflictError("Promotion campaign currency does not match quote currency", {
      promotionCampaignId: campaignId,
      promotionCurrency: version.currency_code,
      quoteCurrency: input.currencyCode
    });
  }

  return {
    campaignId: campaign.id,
    campaignCode: campaign.code,
    campaignName: campaign.name,
    promotionKind: campaign.promotion_kind as PromotionKind,
    publicCode: campaign.public_code,
    versionId: version.id,
    version: version.version_number,
    effectiveFrom: version.effective_from,
    currencyCode: version.currency_code,
    bookingWindowStart: version.booking_window_start,
    bookingWindowEnd: version.booking_window_end,
    arrivalWindowStart: version.arrival_window_start,
    arrivalWindowEnd: version.arrival_window_end,
    minimumStayNights: version.minimum_stay_nights,
    minimumSpendMinor: version.minimum_spend_minor,
    discountType: version.discount_type as PromotionDiscountType,
    discountValue: version.discount_value,
    maximumDiscountMinor: version.maximum_discount_minor,
    appliesTo: version.applies_to as PromotionAppliesTo,
    priority: version.priority,
    stackingMode: version.stacking_mode as PromotionStackingMode,
    stackGroup: version.stack_group,
    assignmentId: assignment.id,
    assignmentScopeType: assignment.scope_type as CommercialScopeType,
    assignmentRatePlanId: assignment.rate_plan_id,
    assignmentRateProductId: assignment.rate_product_id,
    assignmentEffectiveFrom: assignment.effective_from
  };
}

function isEligible(
  campaign: ResolvedPromotionCampaign,
  bookingDate: string,
  input: ResolveInput
): boolean {
  if (
    !withinWindow(bookingDate, campaign.bookingWindowStart, campaign.bookingWindowEnd) ||
    !withinWindow(input.arrivalDate, campaign.arrivalWindowStart, campaign.arrivalWindowEnd) ||
    input.stayNights < campaign.minimumStayNights
  ) {
    return false;
  }

  const spend = eligibleSpend(campaign.appliesTo, input.accommodationMinor, input.extraGuestMinor);
  return campaign.minimumSpendMinor === null || spend >= campaign.minimumSpendMinor;
}

export class PromotionQuoteResolver {
  constructor(private readonly repository = new PromotionQuoteRepository()) {}

  async resolve(
    trx: Transaction<Database>,
    input: ResolveInput
  ): Promise<ResolvedPromotionQuoteContext | null> {
    const data = await this.repository.loadResolutionData(
      trx,
      input.organizationId,
      input.propertyId
    );
    const bookingDate = dateInTimeZone(input.quoteCreatedAt, data.propertyTimezone);
    const requestedPromotionCode = normalizePromotionCode(input.requestedPromotionCode);
    const settings = latestEffective(data.settingsVersions, bookingDate);

    if (!settings) {
      if (requestedPromotionCode) {
        throw new ConflictError(
          "Promotion settings are not configured for the property's local booking date",
          { bookingDate }
        );
      }
      return null;
    }

    const promotionMode = settings.promotion_mode as PromotionMode;
    if (promotionMode === "NO_PROMOTIONS") {
      if (requestedPromotionCode) {
        throw new ConflictError("Promotion codes are disabled for this property");
      }
      return {
        bookingDate,
        requestedPromotionCode: null,
        settings: {
          versionId: settings.id,
          version: settings.version_number,
          effectiveFrom: settings.effective_from,
          promotionMode
        },
        campaigns: []
      };
    }

    const campaigns: ResolvedPromotionCampaign[] = [];
    let hasAssignmentState = false;
    let requestedCodeMatched = false;

    for (const campaign of data.campaigns) {
      if (campaign.status !== "ACTIVE") continue;
      const assignment = applicableAssignment(
        data.assignments,
        campaign.id,
        bookingDate,
        input.ratePlanId,
        input.rateProductId
      );
      if (!assignment) continue;

      hasAssignmentState = true;
      if (!assignment.enabled) continue;

      const resolved = resolveCampaign(data, campaign.id, assignment, bookingDate, input);
      const staticEligible = isEligible(resolved, bookingDate, input);

      if (resolved.promotionKind === "AUTOMATIC") {
        if (staticEligible) campaigns.push(resolved);
        continue;
      }

      if (
        requestedPromotionCode !== null &&
        resolved.publicCode === requestedPromotionCode &&
        staticEligible
      ) {
        requestedCodeMatched = true;
        campaigns.push(resolved);
      }
    }

    if (!hasAssignmentState) {
      throw new ConflictError(
        "Promotion mode POLICIES requires an explicit effective promotion assignment state",
        { bookingDate }
      );
    }

    if (requestedPromotionCode !== null && !requestedCodeMatched) {
      throw new ConflictError("Promotion code is invalid or not eligible for this quote", {
        promotionCode: requestedPromotionCode
      });
    }

    return {
      bookingDate,
      requestedPromotionCode,
      settings: {
        versionId: settings.id,
        version: settings.version_number,
        effectiveFrom: settings.effective_from,
        promotionMode
      },
      campaigns
    };
  }
}
