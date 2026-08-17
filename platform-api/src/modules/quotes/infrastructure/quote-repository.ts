import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  QuoteCalculation,
  QuoteCommercialSnapshotView,
  QuotePromotionSnapshotView,
  QuoteView
} from "../domain/quote.js";
import type {
  QuoteCancellationSnapshotsTable,
  QuoteCancellationTierSnapshotsTable,
  QuoteCommercialSettingDaysTable,
  QuoteCommercialSnapshotsTable,
  QuoteFeeLinesTable,
  QuoteGuestAgeSnapshotsTable,
  QuoteTaxLinesTable,
  QuoteUnitAgeBreakdownsTable
} from "./quote-commercial-database-types.js";
import type {
  QuoteEventsTable,
  QuoteNightsTable,
  QuotesTable,
  QuoteUnitsTable
} from "./quote-database-types.js";
import type {
  QuoteFinalFeeLinesTable,
  QuoteFinalTaxLinesTable,
  QuotePromotionLinesTable,
  QuotePromotionSnapshotsTable
} from "./quote-promotion-database-types.js";

export type QuoteRecord = Selectable<QuotesTable>;
export type QuoteUnitRecord = Selectable<QuoteUnitsTable>;
export type QuoteNightRecord = Selectable<QuoteNightsTable>;
export type QuoteEventRecord = Selectable<QuoteEventsTable>;

type CommercialSnapshotRecord = Selectable<QuoteCommercialSnapshotsTable>;
type CommercialSettingDayRecord = Selectable<QuoteCommercialSettingDaysTable>;
type GuestAgeSnapshotRecord = Selectable<QuoteGuestAgeSnapshotsTable>;
type UnitAgeBreakdownRecord = Selectable<QuoteUnitAgeBreakdownsTable>;
type FeeLineRecord = Selectable<QuoteFeeLinesTable>;
type TaxLineRecord = Selectable<QuoteTaxLinesTable>;
type CancellationSnapshotRecord = Selectable<QuoteCancellationSnapshotsTable>;
type CancellationTierSnapshotRecord = Selectable<QuoteCancellationTierSnapshotsTable>;
type PromotionSnapshotRecord = Selectable<QuotePromotionSnapshotsTable>;
type PromotionLineRecord = Selectable<QuotePromotionLinesTable>;
type FinalFeeLineRecord = Selectable<QuoteFinalFeeLinesTable>;
type FinalTaxLineRecord = Selectable<QuoteFinalTaxLinesTable>;

interface PromotionRecords {
  snapshot: PromotionSnapshotRecord;
  lines: PromotionLineRecord[];
  feeLines: FinalFeeLineRecord[];
  taxLines: FinalTaxLineRecord[];
}

interface CommercialRecords {
  snapshot: CommercialSnapshotRecord;
  settingsDays: CommercialSettingDayRecord[];
  guestAge: GuestAgeSnapshotRecord;
  unitAgeBreakdowns: UnitAgeBreakdownRecord[];
  feeLines: FeeLineRecord[];
  taxLines: TaxLineRecord[];
  cancellation: CancellationSnapshotRecord;
  cancellationTiers: CancellationTierSnapshotRecord[];
}

function normalizeDate(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear().toString().padStart(4, "0"),
      (value.getMonth() + 1).toString().padStart(2, "0"),
      value.getDate().toString().padStart(2, "0")
    ].join("-");
  }
  throw new Error("Unexpected database date representation");
}

function commercialView(records: CommercialRecords): QuoteCommercialSnapshotView {
  const feeById = new Map(records.feeLines.map((line) => [line.id, line]));

  return {
    promotionStatus: "NOT_EVALUATED",
    inclusiveFeeMinor: records.snapshot.inclusive_fee_minor,
    exclusiveFeeMinor: records.snapshot.exclusive_fee_minor,
    inclusiveTaxMinor: records.snapshot.inclusive_tax_minor,
    exclusiveTaxMinor: records.snapshot.exclusive_tax_minor,
    settingsDays: records.settingsDays
      .sort((a, b) => normalizeDate(a.stay_date).localeCompare(normalizeDate(b.stay_date)))
      .map((day) => ({
        stayDate: normalizeDate(day.stay_date),
        settingsVersionId: day.settings_version_id,
        settingsVersion: day.settings_version_number,
        settingsEffectiveFrom: normalizeDate(day.settings_effective_from),
        taxMode: day.tax_mode as "NO_TAX" | "POLICIES",
        feeMode: day.fee_mode as "NO_FEES" | "POLICIES"
      })),
    guestAgePolicy: {
      versionId: records.guestAge.guest_age_policy_version_id,
      version: records.guestAge.version_number,
      effectiveFrom: normalizeDate(records.guestAge.effective_from),
      infantMaxAge: records.guestAge.infant_max_age,
      childMaxAge: records.guestAge.child_max_age,
      infantsCountTowardsOccupancy: records.guestAge.infants_count_towards_occupancy,
      infantsCountTowardsChildLimit: records.guestAge.infants_count_towards_child_limit,
      infantsChargeAsChildren: records.guestAge.infants_charge_as_children
    },
    unitAgeBreakdowns: records.unitAgeBreakdowns
      .sort((a, b) => a.unit_index - b.unit_index)
      .map((row) => ({
        unitIndex: row.unit_index,
        children: row.children,
        infants: row.infants,
        occupancyCount: row.occupancy_count,
        childLimitCount: row.child_limit_count,
        chargeableChildren: row.chargeable_children,
        extraAdults: row.extra_adults,
        extraChildren: row.extra_children
      })),
    feeLines: records.feeLines
      .sort(
        (a, b) =>
          (a.stay_date ?? "").localeCompare(b.stay_date ?? "") ||
          a.line_key.localeCompare(b.line_key)
      )
      .map((line) => ({
        lineKey: line.line_key,
        feePolicyId: line.fee_policy_id,
        feePolicyVersionId: line.fee_policy_version_id,
        feePolicyCode: line.fee_policy_code,
        feePolicyName: line.fee_policy_name,
        version: line.version_number,
        effectiveFrom: normalizeDate(line.effective_from),
        stayDate: line.stay_date === null ? null : normalizeDate(line.stay_date),
        calculationType: line.calculation_type as "FIXED" | "PERCENTAGE",
        applicationBasis: line.application_basis as
          "PER_STAY" | "PER_NIGHT" | "PER_UNIT_PER_STAY" | "PER_UNIT_PER_NIGHT" | "STAY_CHARGES",
        amountMinorSnapshot: line.amount_minor_snapshot,
        rateBasisPointsSnapshot: line.rate_basis_points_snapshot,
        priceMode: line.price_mode as "EXCLUSIVE" | "INCLUSIVE",
        taxable: line.taxable,
        taxPolicyId: line.tax_policy_id,
        multiplier: line.multiplier,
        feeMinor: line.fee_minor
      })),
    taxLines: records.taxLines
      .sort(
        (a, b) =>
          (a.stay_date ?? "").localeCompare(b.stay_date ?? "") ||
          a.component_code.localeCompare(b.component_code)
      )
      .map((line) => ({
        taxPolicyId: line.tax_policy_id,
        taxPolicyVersionId: line.tax_policy_version_id,
        taxPolicyCode: line.tax_policy_code,
        taxPolicyName: line.tax_policy_name,
        version: line.version_number,
        effectiveFrom: normalizeDate(line.effective_from),
        componentCode: line.component_code,
        componentName: line.component_name,
        rateBasisPoints: line.rate_basis_points,
        priceMode: line.price_mode as "EXCLUSIVE" | "INCLUSIVE",
        chargeType: line.charge_type as "ACCOMMODATION" | "EXTRA_GUEST" | "FEE",
        stayDate: line.stay_date === null ? null : normalizeDate(line.stay_date),
        feeLineKey: line.fee_line_id ? (feeById.get(line.fee_line_id)?.line_key ?? null) : null,
        taxableBasisMinor: line.taxable_basis_minor,
        taxMinor: line.tax_minor
      })),
    cancellationPolicy: {
      policyId: records.cancellation.cancellation_policy_id,
      policyCode: records.cancellation.policy_code,
      policyName: records.cancellation.policy_name,
      versionId: records.cancellation.cancellation_policy_version_id,
      version: records.cancellation.version_number,
      effectiveFrom: normalizeDate(records.cancellation.effective_from),
      arrivalLocalTime: records.cancellation.arrival_local_time,
      currencyCode: records.cancellation.currency_code,
      policyText: records.cancellation.policy_text,
      tiers: records.cancellationTiers
        .sort((a, b) => {
          if (a.trigger_type !== b.trigger_type)
            return a.trigger_type.localeCompare(b.trigger_type);
          return (
            (b.minimum_minutes_before_arrival ?? -1) - (a.minimum_minutes_before_arrival ?? -1)
          );
        })
        .map((tier) => ({
          triggerType: tier.trigger_type as "CANCELLATION" | "NO_SHOW",
          minimumMinutesBeforeArrival: tier.minimum_minutes_before_arrival,
          penaltyType: tier.penalty_type as "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS",
          penaltyValue: tier.penalty_value
        }))
    }
  };
}

function promotionView(records: PromotionRecords): QuotePromotionSnapshotView {
  const feeById = new Map(records.feeLines.map((line) => [line.id, line]));

  return {
    promotionStatus: "EVALUATED",
    holdEligible: true,
    bookingDate: normalizeDate(records.snapshot.booking_date),
    requestedPromotionCode: records.snapshot.requested_promotion_code,
    settingsVersionId: records.snapshot.promotion_settings_version_id,
    settingsVersion: records.snapshot.settings_version_number,
    settingsEffectiveFrom: normalizeDate(records.snapshot.settings_effective_from),
    promotionMode: records.snapshot.promotion_mode as "NO_PROMOTIONS" | "POLICIES",
    currencyCode: records.snapshot.currency_code,
    grossAccommodationMinor: records.snapshot.gross_accommodation_minor,
    grossExtraGuestMinor: records.snapshot.gross_extra_guest_minor,
    accommodationDiscountMinor: records.snapshot.accommodation_discount_minor,
    extraGuestDiscountMinor: records.snapshot.extra_guest_discount_minor,
    discountMinor: records.snapshot.discount_minor,
    discountedAccommodationMinor: records.snapshot.discounted_accommodation_minor,
    discountedExtraGuestMinor: records.snapshot.discounted_extra_guest_minor,
    inclusiveFeeMinor: records.snapshot.inclusive_fee_minor,
    exclusiveFeeMinor: records.snapshot.exclusive_fee_minor,
    feeMinor: records.snapshot.fee_minor,
    inclusiveTaxMinor: records.snapshot.inclusive_tax_minor,
    exclusiveTaxMinor: records.snapshot.exclusive_tax_minor,
    taxMinor: records.snapshot.tax_minor,
    totalMinor: records.snapshot.total_minor,
    lines: records.lines
      .sort((a, b) => b.priority - a.priority || a.campaign_code.localeCompare(b.campaign_code))
      .map((line) => ({
        campaignId: line.promotion_campaign_id,
        campaignCode: line.campaign_code,
        campaignName: line.campaign_name,
        promotionKind: line.promotion_kind as "AUTOMATIC" | "PROMO_CODE",
        publicCode: line.public_code,
        campaignVersionId: line.promotion_campaign_version_id,
        version: line.version_number,
        effectiveFrom: normalizeDate(line.effective_from),
        currencyCode: line.currency_code,
        bookingWindowStart:
          line.booking_window_start === null ? null : normalizeDate(line.booking_window_start),
        bookingWindowEnd:
          line.booking_window_end === null ? null : normalizeDate(line.booking_window_end),
        arrivalWindowStart:
          line.arrival_window_start === null ? null : normalizeDate(line.arrival_window_start),
        arrivalWindowEnd:
          line.arrival_window_end === null ? null : normalizeDate(line.arrival_window_end),
        minimumStayNights: line.minimum_stay_nights,
        minimumSpendMinor: line.minimum_spend_minor,
        discountType: line.discount_type as "PERCENTAGE" | "FIXED_AMOUNT",
        discountValue: line.discount_value,
        maximumDiscountMinor: line.maximum_discount_minor,
        appliesTo: line.applies_to as "ACCOMMODATION" | "ACCOMMODATION_AND_EXTRA_GUEST",
        priority: line.priority,
        stackingMode: line.stacking_mode as "EXCLUSIVE" | "STACKABLE",
        stackGroup: line.stack_group,
        assignmentId: line.promotion_assignment_id,
        assignmentScopeType: line.assignment_scope_type as
          "PROPERTY" | "RATE_PLAN" | "RATE_PRODUCT",
        assignmentRatePlanId: line.assignment_rate_plan_id,
        assignmentRateProductId: line.assignment_rate_product_id,
        assignmentEffectiveFrom: normalizeDate(line.assignment_effective_from),
        discountBasisMinor: line.discount_basis_minor,
        accommodationDiscountMinor: line.accommodation_discount_minor,
        extraGuestDiscountMinor: line.extra_guest_discount_minor,
        discountMinor: line.discount_minor
      })),
    finalFeeLines: records.feeLines
      .sort(
        (a, b) =>
          (a.stay_date ?? "").localeCompare(b.stay_date ?? "") ||
          a.line_key.localeCompare(b.line_key)
      )
      .map((line) => ({
        lineKey: line.line_key,
        feePolicyId: line.fee_policy_id,
        feePolicyVersionId: line.fee_policy_version_id,
        feePolicyCode: line.fee_policy_code,
        feePolicyName: line.fee_policy_name,
        version: line.version_number,
        effectiveFrom: normalizeDate(line.effective_from),
        stayDate: line.stay_date === null ? null : normalizeDate(line.stay_date),
        calculationType: line.calculation_type as "FIXED" | "PERCENTAGE",
        applicationBasis: line.application_basis as
          "PER_STAY" | "PER_NIGHT" | "PER_UNIT_PER_STAY" | "PER_UNIT_PER_NIGHT" | "STAY_CHARGES",
        amountMinorSnapshot: line.amount_minor_snapshot,
        rateBasisPointsSnapshot: line.rate_basis_points_snapshot,
        priceMode: line.price_mode as "EXCLUSIVE" | "INCLUSIVE",
        taxable: line.taxable,
        taxPolicyId: line.tax_policy_id,
        multiplier: line.multiplier,
        feeMinor: line.fee_minor
      })),
    finalTaxLines: records.taxLines
      .sort(
        (a, b) =>
          (a.stay_date ?? "").localeCompare(b.stay_date ?? "") ||
          a.component_code.localeCompare(b.component_code)
      )
      .map((line) => ({
        taxPolicyId: line.tax_policy_id,
        taxPolicyVersionId: line.tax_policy_version_id,
        taxPolicyCode: line.tax_policy_code,
        taxPolicyName: line.tax_policy_name,
        version: line.version_number,
        effectiveFrom: normalizeDate(line.effective_from),
        componentCode: line.component_code,
        componentName: line.component_name,
        rateBasisPoints: line.rate_basis_points,
        priceMode: line.price_mode as "EXCLUSIVE" | "INCLUSIVE",
        chargeType: line.charge_type as "ACCOMMODATION" | "EXTRA_GUEST" | "FEE",
        stayDate: line.stay_date === null ? null : normalizeDate(line.stay_date),
        feeLineKey: line.final_fee_line_id
          ? (feeById.get(line.final_fee_line_id)?.line_key ?? null)
          : null,
        taxableBasisMinor: line.taxable_basis_minor,
        taxMinor: line.tax_minor
      }))
  };
}

function view(
  quote: QuoteRecord,
  units: QuoteUnitRecord[],
  nights: QuoteNightRecord[],
  commercial: CommercialRecords | null,
  promotion: PromotionRecords | null,
  now: Date
): QuoteView {
  const ageByUnit = new Map(
    (commercial?.unitAgeBreakdowns ?? []).map((item) => [item.unit_index, item])
  );
  const commercialSnapshot = commercial?.snapshot ?? null;
  const commercialDetails = commercial ? commercialView(commercial) : null;
  const promotionSnapshot = promotion?.snapshot ?? null;
  const promotionDetails = promotion ? promotionView(promotion) : null;

  return {
    id: quote.id,
    quoteReference: quote.quote_reference,
    organizationId: quote.organization_id,
    propertyId: quote.property_id,
    ratePlanId: quote.rate_plan_id,
    ratePlanCode: quote.rate_plan_code,
    ratePlanName: quote.rate_plan_name,
    mealPlanCode: quote.meal_plan_code,
    rateProductId: quote.rate_product_id,
    rateProductVersion: quote.rate_product_version,
    productType: quote.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
    productLabel: quote.product_label,
    roomCategoryId: quote.room_category_id,
    arrivalDate: normalizeDate(quote.arrival_date),
    departureDate: normalizeDate(quote.departure_date),
    quantity: quote.quantity,
    currencyCode: quote.currency_code,
    accommodationMinor: quote.accommodation_minor,
    extraGuestMinor: quote.extra_guest_minor,
    taxMinor: promotionSnapshot?.tax_minor ?? commercialSnapshot?.tax_minor ?? quote.tax_minor,
    feeMinor: promotionSnapshot?.fee_minor ?? commercialSnapshot?.fee_minor ?? quote.fee_minor,
    totalMinor:
      promotionSnapshot?.total_minor ?? commercialSnapshot?.total_minor ?? quote.total_minor,
    discountMinor: promotionSnapshot?.discount_minor ?? 0,
    discountedAccommodationMinor:
      promotionSnapshot?.discounted_accommodation_minor ?? quote.accommodation_minor,
    discountedExtraGuestMinor:
      promotionSnapshot?.discounted_extra_guest_minor ?? quote.extra_guest_minor,
    inclusiveTaxMinor:
      promotionSnapshot?.inclusive_tax_minor ?? commercialSnapshot?.inclusive_tax_minor ?? 0,
    exclusiveTaxMinor:
      promotionSnapshot?.exclusive_tax_minor ?? commercialSnapshot?.exclusive_tax_minor ?? 0,
    inclusiveFeeMinor:
      promotionSnapshot?.inclusive_fee_minor ?? commercialSnapshot?.inclusive_fee_minor ?? 0,
    exclusiveFeeMinor:
      promotionSnapshot?.exclusive_fee_minor ?? commercialSnapshot?.exclusive_fee_minor ?? 0,
    arrivalClosedToArrival: quote.arrival_closed_to_arrival,
    departureClosedToDeparture: quote.departure_closed_to_departure,
    minimumStaySnapshot: quote.minimum_stay_snapshot,
    maximumStaySnapshot: quote.maximum_stay_snapshot,
    commercialStatus: commercialSnapshot ? "COMMERCIAL_RULES_APPLIED" : "PRE_TAX_ONLY",
    promotionStatus: promotionSnapshot ? "EVALUATED" : commercialSnapshot ? "NOT_EVALUATED" : null,
    holdEligible: promotionSnapshot?.hold_eligible ?? false,
    expiresAt: quote.expires_at.toISOString(),
    expired: quote.expires_at.getTime() <= now.getTime(),
    createdAt: quote.created_at.toISOString(),
    units: units
      .sort((a, b) => a.unit_index - b.unit_index)
      .map((unit) => {
        const childAges = [...unit.child_ages_json];
        const age = ageByUnit.get(unit.unit_index);
        return {
          unitIndex: unit.unit_index,
          adults: unit.adults,
          childAges,
          children: age?.children ?? childAges.length,
          infants: age?.infants ?? 0,
          occupancyCount: age?.occupancy_count ?? unit.adults + childAges.length,
          childLimitCount: age?.child_limit_count ?? childAges.length,
          chargeableChildren: age?.chargeable_children ?? childAges.length,
          includedAdults: unit.included_adults,
          includedChildren: unit.included_children,
          maxAdults: unit.max_adults,
          maxChildren: unit.max_children,
          maxOccupancy: unit.max_occupancy,
          extraAdults: age?.extra_adults ?? unit.extra_adults,
          extraChildren: age?.extra_children ?? unit.extra_children
        };
      }),
    nights: nights
      .sort((a, b) => normalizeDate(a.stay_date).localeCompare(normalizeDate(b.stay_date)))
      .map((night) => ({
        stayDate: normalizeDate(night.stay_date),
        nightlyUnitRateMinor: night.nightly_unit_rate_minor,
        accommodationMinor: night.accommodation_minor,
        extraAdultMinor: night.extra_adult_minor,
        extraChildMinor: night.extra_child_minor,
        extraGuestMinor: night.extra_guest_minor,
        nightTotalMinor: night.night_total_minor,
        sellableQuantitySnapshot: night.sellable_quantity_snapshot,
        rateSource: night.rate_source,
        rateOverrideVersion: night.rate_override_version,
        minimumStay: night.minimum_stay,
        maximumStay: night.maximum_stay,
        closedToArrival: night.closed_to_arrival,
        closedToDeparture: night.closed_to_departure,
        stopSell: night.stop_sell
      })),
    commercial: commercialDetails,
    promotion: promotionDetails
  };
}

export class QuoteRepository {
  private async loadCommercial(
    trx: Transaction<Database>,
    quoteId: string
  ): Promise<CommercialRecords | null> {
    const snapshot = await trx
      .selectFrom("quote_commercial_snapshots")
      .selectAll()
      .where("quote_id", "=", quoteId)
      .executeTakeFirst();
    if (!snapshot) return null;

    const [settingsDays, guestAge, unitAgeBreakdowns, feeLines, taxLines, cancellation] =
      await Promise.all([
        trx
          .selectFrom("quote_commercial_setting_days")
          .selectAll()
          .where("quote_id", "=", quoteId)
          .execute(),
        trx
          .selectFrom("quote_guest_age_snapshots")
          .selectAll()
          .where("quote_id", "=", quoteId)
          .executeTakeFirstOrThrow(),
        trx
          .selectFrom("quote_unit_age_breakdowns")
          .selectAll()
          .where("quote_id", "=", quoteId)
          .execute(),
        trx.selectFrom("quote_fee_lines").selectAll().where("quote_id", "=", quoteId).execute(),
        trx.selectFrom("quote_tax_lines").selectAll().where("quote_id", "=", quoteId).execute(),
        trx
          .selectFrom("quote_cancellation_snapshots")
          .selectAll()
          .where("quote_id", "=", quoteId)
          .executeTakeFirstOrThrow()
      ]);

    const cancellationTiers = await trx
      .selectFrom("quote_cancellation_tier_snapshots")
      .selectAll()
      .where("quote_cancellation_snapshot_id", "=", cancellation.id)
      .execute();

    return {
      snapshot,
      settingsDays,
      guestAge,
      unitAgeBreakdowns,
      feeLines,
      taxLines,
      cancellation,
      cancellationTiers
    };
  }

  private async loadPromotion(
    trx: Transaction<Database>,
    quoteId: string
  ): Promise<PromotionRecords | null> {
    const snapshot = await trx
      .selectFrom("quote_promotion_snapshots")
      .selectAll()
      .where("quote_id", "=", quoteId)
      .executeTakeFirst();
    if (!snapshot) return null;

    const [lines, feeLines, taxLines] = await Promise.all([
      trx.selectFrom("quote_promotion_lines").selectAll().where("quote_id", "=", quoteId).execute(),
      trx.selectFrom("quote_final_fee_lines").selectAll().where("quote_id", "=", quoteId).execute(),
      trx.selectFrom("quote_final_tax_lines").selectAll().where("quote_id", "=", quoteId).execute()
    ]);

    return { snapshot, lines, feeLines, taxLines };
  }

  async create(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      quoteReference: string;
      arrivalDate: string;
      departureDate: string;
      expiresAt: Date;
      createdByUserId: string | null;
      request: RequestMetadata;
      calculation: QuoteCalculation;
    }
  ): Promise<QuoteView> {
    const id = randomUUID();
    const calculation = input.calculation;

    const quote = await trx
      .insertInto("quotes")
      .values({
        id,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        quote_reference: input.quoteReference,
        rate_plan_id: calculation.ratePlanId,
        rate_plan_code: calculation.ratePlanCode,
        rate_plan_name: calculation.ratePlanName,
        meal_plan_code: calculation.mealPlanCode,
        rate_product_id: calculation.rateProductId,
        rate_product_version: calculation.rateProductVersion,
        product_type: calculation.productType,
        product_label: calculation.productLabel,
        room_category_id: calculation.roomCategoryId,
        arrival_date: input.arrivalDate,
        departure_date: input.departureDate,
        quantity: calculation.quantity,
        currency_code: calculation.currencyCode,
        accommodation_minor: calculation.accommodationMinor,
        extra_guest_minor: calculation.extraGuestMinor,
        tax_minor: 0,
        fee_minor: 0,
        total_minor: calculation.accommodationMinor + calculation.extraGuestMinor,
        arrival_closed_to_arrival: calculation.arrivalClosedToArrival,
        departure_closed_to_departure: calculation.departureClosedToDeparture,
        minimum_stay_snapshot: calculation.minimumStaySnapshot,
        maximum_stay_snapshot: calculation.maximumStaySnapshot,
        commercial_status: "PRE_TAX_ONLY",
        hold_eligible: false,
        expires_at: input.expiresAt,
        created_by_user_id: input.createdByUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const units: QuoteUnitRecord[] = [];
    for (const unit of calculation.units) {
      const row = await trx
        .insertInto("quote_units")
        .values({
          id: randomUUID(),
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          unit_index: unit.unitIndex,
          adults: unit.adults,
          child_ages_json: JSON.stringify(unit.childAges),
          included_adults: unit.includedAdults,
          included_children: unit.includedChildren,
          max_adults: unit.maxAdults,
          max_children: unit.maxChildren,
          max_occupancy: unit.maxOccupancy,
          extra_adults: unit.extraAdults,
          extra_children: unit.extraChildren
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      units.push(row);
    }

    const nights: QuoteNightRecord[] = [];
    for (const night of calculation.nights) {
      const row = await trx
        .insertInto("quote_nights")
        .values({
          id: randomUUID(),
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          stay_date: night.stayDate,
          nightly_unit_rate_minor: night.nightlyUnitRateMinor,
          accommodation_minor: night.accommodationMinor,
          extra_adult_minor: night.extraAdultMinor,
          extra_child_minor: night.extraChildMinor,
          extra_guest_minor: night.extraGuestMinor,
          night_total_minor: night.nightTotalMinor,
          sellable_quantity_snapshot: night.sellableQuantitySnapshot,
          rate_source: night.rateSource,
          rate_override_version: night.rateOverrideVersion,
          minimum_stay: night.minimumStay,
          maximum_stay: night.maximumStay,
          closed_to_arrival: night.closedToArrival,
          closed_to_departure: night.closedToDeparture,
          stop_sell: night.stopSell
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      nights.push(row);
    }

    if (calculation.commercial) {
      const commercial = calculation.commercial;

      await trx
        .insertInto("quote_commercial_snapshots")
        .values({
          id: randomUUID(),
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          commercial_status: commercial.commercialStatus,
          promotion_status: commercial.promotionStatus,
          currency_code: commercial.currencyCode,
          accommodation_minor: commercial.accommodationMinor,
          extra_guest_minor: commercial.extraGuestMinor,
          inclusive_fee_minor: commercial.inclusiveFeeMinor,
          exclusive_fee_minor: commercial.exclusiveFeeMinor,
          fee_minor: commercial.feeMinor,
          inclusive_tax_minor: commercial.inclusiveTaxMinor,
          exclusive_tax_minor: commercial.exclusiveTaxMinor,
          tax_minor: commercial.taxMinor,
          total_minor: commercial.totalMinor,
          hold_eligible: false
        })
        .execute();

      for (const day of commercial.settingsDays) {
        await trx
          .insertInto("quote_commercial_setting_days")
          .values({
            id: randomUUID(),
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            stay_date: day.stayDate,
            settings_version_id: day.settingsVersionId,
            settings_version_number: day.settingsVersion,
            settings_effective_from: day.settingsEffectiveFrom,
            tax_mode: day.taxMode,
            fee_mode: day.feeMode
          })
          .execute();
      }

      await trx
        .insertInto("quote_guest_age_snapshots")
        .values({
          id: randomUUID(),
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          guest_age_policy_version_id: commercial.guestAgePolicy.versionId,
          version_number: commercial.guestAgePolicy.version,
          effective_from: commercial.guestAgePolicy.effectiveFrom,
          infant_max_age: commercial.guestAgePolicy.infantMaxAge,
          child_max_age: commercial.guestAgePolicy.childMaxAge,
          infants_count_towards_occupancy: commercial.guestAgePolicy.infantsCountTowardsOccupancy,
          infants_count_towards_child_limit:
            commercial.guestAgePolicy.infantsCountTowardsChildLimit,
          infants_charge_as_children: commercial.guestAgePolicy.infantsChargeAsChildren
        })
        .execute();

      for (const breakdown of commercial.unitAgeBreakdowns) {
        await trx
          .insertInto("quote_unit_age_breakdowns")
          .values({
            id: randomUUID(),
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            unit_index: breakdown.unitIndex,
            children: breakdown.children,
            infants: breakdown.infants,
            occupancy_count: breakdown.occupancyCount,
            child_limit_count: breakdown.childLimitCount,
            chargeable_children: breakdown.chargeableChildren,
            extra_adults: breakdown.extraAdults,
            extra_children: breakdown.extraChildren
          })
          .execute();
      }

      const feeIds = new Map<string, string>();
      for (const fee of commercial.feeLines) {
        const feeId = randomUUID();
        feeIds.set(fee.lineKey, feeId);
        await trx
          .insertInto("quote_fee_lines")
          .values({
            id: feeId,
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            line_key: fee.lineKey,
            fee_policy_id: fee.feePolicyId,
            fee_policy_version_id: fee.feePolicyVersionId,
            fee_policy_code: fee.feePolicyCode,
            fee_policy_name: fee.feePolicyName,
            version_number: fee.version,
            effective_from: fee.effectiveFrom,
            stay_date: fee.stayDate,
            calculation_type: fee.calculationType,
            application_basis: fee.applicationBasis,
            amount_minor_snapshot: fee.amountMinorSnapshot,
            rate_basis_points_snapshot: fee.rateBasisPointsSnapshot,
            price_mode: fee.priceMode,
            taxable: fee.taxable,
            tax_policy_id: fee.taxPolicyId,
            multiplier: fee.multiplier,
            fee_minor: fee.feeMinor
          })
          .execute();
      }

      for (const tax of commercial.taxLines) {
        await trx
          .insertInto("quote_tax_lines")
          .values({
            id: randomUUID(),
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            tax_policy_id: tax.taxPolicyId,
            tax_policy_version_id: tax.taxPolicyVersionId,
            tax_policy_code: tax.taxPolicyCode,
            tax_policy_name: tax.taxPolicyName,
            version_number: tax.version,
            effective_from: tax.effectiveFrom,
            component_code: tax.componentCode,
            component_name: tax.componentName,
            rate_basis_points: tax.rateBasisPoints,
            price_mode: tax.priceMode,
            charge_type: tax.chargeType,
            stay_date: tax.stayDate,
            fee_line_id: tax.feeLineKey ? (feeIds.get(tax.feeLineKey) ?? null) : null,
            taxable_basis_minor: tax.taxableBasisMinor,
            tax_minor: tax.taxMinor
          })
          .execute();
      }

      const cancellationSnapshotId = randomUUID();
      await trx
        .insertInto("quote_cancellation_snapshots")
        .values({
          id: cancellationSnapshotId,
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          cancellation_policy_id: commercial.cancellationPolicy.policyId,
          cancellation_policy_version_id: commercial.cancellationPolicy.versionId,
          policy_code: commercial.cancellationPolicy.policyCode,
          policy_name: commercial.cancellationPolicy.policyName,
          version_number: commercial.cancellationPolicy.version,
          effective_from: commercial.cancellationPolicy.effectiveFrom,
          arrival_local_time: commercial.cancellationPolicy.arrivalLocalTime,
          currency_code: commercial.cancellationPolicy.currencyCode,
          policy_text: commercial.cancellationPolicy.policyText
        })
        .execute();

      for (const tier of commercial.cancellationPolicy.tiers) {
        await trx
          .insertInto("quote_cancellation_tier_snapshots")
          .values({
            id: randomUUID(),
            quote_cancellation_snapshot_id: cancellationSnapshotId,
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            trigger_type: tier.triggerType,
            minimum_minutes_before_arrival: tier.minimumMinutesBeforeArrival,
            penalty_type: tier.penaltyType,
            penalty_value: tier.penaltyValue
          })
          .execute();
      }
    }

    if (calculation.promotion) {
      const promotion = calculation.promotion;
      const promotionSnapshotId = randomUUID();
      await trx
        .insertInto("quote_promotion_snapshots")
        .values({
          id: promotionSnapshotId,
          quote_id: id,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          promotion_settings_version_id: promotion.settingsVersionId,
          settings_version_number: promotion.settingsVersion,
          settings_effective_from: promotion.settingsEffectiveFrom,
          promotion_mode: promotion.promotionMode,
          booking_date: promotion.bookingDate,
          requested_promotion_code: promotion.requestedPromotionCode,
          promotion_status: promotion.promotionStatus,
          currency_code: promotion.currencyCode,
          gross_accommodation_minor: promotion.grossAccommodationMinor,
          gross_extra_guest_minor: promotion.grossExtraGuestMinor,
          accommodation_discount_minor: promotion.accommodationDiscountMinor,
          extra_guest_discount_minor: promotion.extraGuestDiscountMinor,
          discount_minor: promotion.discountMinor,
          discounted_accommodation_minor: promotion.discountedAccommodationMinor,
          discounted_extra_guest_minor: promotion.discountedExtraGuestMinor,
          inclusive_fee_minor: promotion.inclusiveFeeMinor,
          exclusive_fee_minor: promotion.exclusiveFeeMinor,
          fee_minor: promotion.feeMinor,
          inclusive_tax_minor: promotion.inclusiveTaxMinor,
          exclusive_tax_minor: promotion.exclusiveTaxMinor,
          tax_minor: promotion.taxMinor,
          total_minor: promotion.totalMinor,
          hold_eligible: true
        })
        .execute();

      for (const line of promotion.lines) {
        await trx
          .insertInto("quote_promotion_lines")
          .values({
            id: randomUUID(),
            quote_promotion_snapshot_id: promotionSnapshotId,
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            promotion_campaign_id: line.campaignId,
            promotion_campaign_version_id: line.campaignVersionId,
            promotion_assignment_id: line.assignmentId,
            campaign_code: line.campaignCode,
            campaign_name: line.campaignName,
            promotion_kind: line.promotionKind,
            public_code: line.publicCode,
            version_number: line.version,
            effective_from: line.effectiveFrom,
            currency_code: line.currencyCode,
            booking_window_start: line.bookingWindowStart,
            booking_window_end: line.bookingWindowEnd,
            arrival_window_start: line.arrivalWindowStart,
            arrival_window_end: line.arrivalWindowEnd,
            minimum_stay_nights: line.minimumStayNights,
            minimum_spend_minor: line.minimumSpendMinor,
            discount_type: line.discountType,
            discount_value: line.discountValue,
            maximum_discount_minor: line.maximumDiscountMinor,
            applies_to: line.appliesTo,
            priority: line.priority,
            stacking_mode: line.stackingMode,
            stack_group: line.stackGroup,
            assignment_scope_type: line.assignmentScopeType,
            assignment_rate_plan_id: line.assignmentRatePlanId,
            assignment_rate_product_id: line.assignmentRateProductId,
            assignment_effective_from: line.assignmentEffectiveFrom,
            discount_basis_minor: line.discountBasisMinor,
            accommodation_discount_minor: line.accommodationDiscountMinor,
            extra_guest_discount_minor: line.extraGuestDiscountMinor,
            discount_minor: line.discountMinor
          })
          .execute();
      }

      const finalFeeIds = new Map<string, string>();
      for (const fee of promotion.finalFeeLines) {
        const feeId = randomUUID();
        finalFeeIds.set(fee.lineKey, feeId);
        await trx
          .insertInto("quote_final_fee_lines")
          .values({
            id: feeId,
            quote_promotion_snapshot_id: promotionSnapshotId,
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            line_key: fee.lineKey,
            fee_policy_id: fee.feePolicyId,
            fee_policy_version_id: fee.feePolicyVersionId,
            fee_policy_code: fee.feePolicyCode,
            fee_policy_name: fee.feePolicyName,
            version_number: fee.version,
            effective_from: fee.effectiveFrom,
            stay_date: fee.stayDate,
            calculation_type: fee.calculationType,
            application_basis: fee.applicationBasis,
            amount_minor_snapshot: fee.amountMinorSnapshot,
            rate_basis_points_snapshot: fee.rateBasisPointsSnapshot,
            price_mode: fee.priceMode,
            taxable: fee.taxable,
            tax_policy_id: fee.taxPolicyId,
            multiplier: fee.multiplier,
            fee_minor: fee.feeMinor
          })
          .execute();
      }

      for (const tax of promotion.finalTaxLines) {
        await trx
          .insertInto("quote_final_tax_lines")
          .values({
            id: randomUUID(),
            quote_promotion_snapshot_id: promotionSnapshotId,
            quote_id: id,
            organization_id: input.organizationId,
            property_id: input.propertyId,
            tax_policy_id: tax.taxPolicyId,
            tax_policy_version_id: tax.taxPolicyVersionId,
            tax_policy_code: tax.taxPolicyCode,
            tax_policy_name: tax.taxPolicyName,
            version_number: tax.version,
            effective_from: tax.effectiveFrom,
            component_code: tax.componentCode,
            component_name: tax.componentName,
            rate_basis_points: tax.rateBasisPoints,
            price_mode: tax.priceMode,
            charge_type: tax.chargeType,
            stay_date: tax.stayDate,
            final_fee_line_id: tax.feeLineKey ? (finalFeeIds.get(tax.feeLineKey) ?? null) : null,
            taxable_basis_minor: tax.taxableBasisMinor,
            tax_minor: tax.taxMinor
          })
          .execute();
      }
    }

    return view(
      quote,
      units,
      nights,
      await this.loadCommercial(trx, id),
      await this.loadPromotion(trx, id),
      new Date()
    );
  }

  async find(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    quoteId: string
  ): Promise<QuoteView | undefined> {
    const quote = await trx
      .selectFrom("quotes")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", quoteId)
      .executeTakeFirst();

    if (!quote) return undefined;

    const [units, nights, commercial, promotion] = await Promise.all([
      trx.selectFrom("quote_units").selectAll().where("quote_id", "=", quoteId).execute(),
      trx.selectFrom("quote_nights").selectAll().where("quote_id", "=", quoteId).execute(),
      this.loadCommercial(trx, quoteId),
      this.loadPromotion(trx, quoteId)
    ]);

    return view(quote, units, nights, commercial, promotion, new Date());
  }

  async recordEvent(
    trx: Transaction<Database>,
    input: {
      quoteId: string;
      organizationId: string;
      propertyId: string;
      eventType: "QUOTE_CREATED";
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("quote_events")
      .values({
        id: randomUUID(),
        quote_id: input.quoteId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        event_type: input.eventType,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }
}
