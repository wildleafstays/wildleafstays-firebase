import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { QuoteCalculation, QuoteView } from "../domain/quote.js";
import type {
  QuoteEventsTable,
  QuoteNightsTable,
  QuotesTable,
  QuoteUnitsTable
} from "./quote-database-types.js";

export type QuoteRecord = Selectable<QuotesTable>;
export type QuoteUnitRecord = Selectable<QuoteUnitsTable>;
export type QuoteNightRecord = Selectable<QuoteNightsTable>;
export type QuoteEventRecord = Selectable<QuoteEventsTable>;

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

function view(
  quote: QuoteRecord,
  units: QuoteUnitRecord[],
  nights: QuoteNightRecord[],
  now: Date
): QuoteView {
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
    taxMinor: quote.tax_minor,
    feeMinor: quote.fee_minor,
    totalMinor: quote.total_minor,
    arrivalClosedToArrival: quote.arrival_closed_to_arrival,
    departureClosedToDeparture: quote.departure_closed_to_departure,
    minimumStaySnapshot: quote.minimum_stay_snapshot,
    maximumStaySnapshot: quote.maximum_stay_snapshot,
    commercialStatus: "PRE_TAX_ONLY",
    holdEligible: false,
    expiresAt: quote.expires_at.toISOString(),
    expired: quote.expires_at.getTime() <= now.getTime(),
    createdAt: quote.created_at.toISOString(),
    units: units
      .sort((a, b) => a.unit_index - b.unit_index)
      .map((unit) => ({
        unitIndex: unit.unit_index,
        adults: unit.adults,
        childAges: [...unit.child_ages_json],
        includedAdults: unit.included_adults,
        includedChildren: unit.included_children,
        maxAdults: unit.max_adults,
        maxChildren: unit.max_children,
        maxOccupancy: unit.max_occupancy,
        extraAdults: unit.extra_adults,
        extraChildren: unit.extra_children
      })),
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
      }))
  };
}

export class QuoteRepository {
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
        tax_minor: calculation.taxMinor,
        fee_minor: calculation.feeMinor,
        total_minor: calculation.totalMinor,
        arrival_closed_to_arrival: calculation.arrivalClosedToArrival,
        departure_closed_to_departure: calculation.departureClosedToDeparture,
        minimum_stay_snapshot: calculation.minimumStaySnapshot,
        maximum_stay_snapshot: calculation.maximumStaySnapshot,
        commercial_status: calculation.commercialStatus,
        hold_eligible: calculation.holdEligible,
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

    return view(quote, units, nights, new Date());
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

    const [units, nights] = await Promise.all([
      trx.selectFrom("quote_units").selectAll().where("quote_id", "=", quoteId).execute(),
      trx.selectFrom("quote_nights").selectAll().where("quote_id", "=", quoteId).execute()
    ]);

    return view(quote, units, nights, new Date());
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
