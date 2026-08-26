import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  RateCalendarDaysTable,
  RateEventsTable,
  RatePlanProductsTable,
  RatePlansTable
} from "./rate-database-types.js";

export type RatePlanRecord = Selectable<RatePlansTable>;
export type RateProductRecord = Selectable<RatePlanProductsTable>;
export type RateCalendarDayRecord = Selectable<RateCalendarDaysTable>;
export type RateEventRecord = Selectable<RateEventsTable>;

export class RateRepository {
  async lockOwnerRateSetup(trx: Transaction<Database>, propertyId: string): Promise<void> {
    await sql`
      select pg_advisory_xact_lock(
        hashtext(${`owner-rate:${propertyId}`})::bigint
      )
    `.execute(trx);
  }

  async findPropertyContext(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ) {
    return trx
      .selectFrom("properties as p")
      .innerJoin("organizations as o", "o.id", "p.organization_id")
      .select([
        "p.id as property_id",
        "p.organization_id",
        "p.status",
        "p.sale_mode",
        "o.currency_code"
      ])
      .where("p.id", "=", propertyId)
      .where("p.organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  async findRoomCategory(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string
  ) {
    return trx
      .selectFrom("room_categories")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", roomCategoryId)
      .executeTakeFirst();
  }

  async createPlan(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      code: string;
      name: string;
      description: string | null;
      mealPlanCode: string;
      currencyCode: string;
      createdByUserId: string | null;
    }
  ): Promise<RatePlanRecord> {
    return trx
      .insertInto("rate_plans")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        description: input.description,
        meal_plan_code: input.mealPlanCode,
        currency_code: input.currencyCode,
        created_by_user_id: input.createdByUserId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listPlans(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<RatePlanRecord[]> {
    return trx
      .selectFrom("rate_plans")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .orderBy("code")
      .execute();
  }

  async findPlan(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    ratePlanId: string
  ): Promise<RatePlanRecord | undefined> {
    return trx
      .selectFrom("rate_plans")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", ratePlanId)
      .executeTakeFirst();
  }

  async findProductByKeyForUpdate(
    trx: Transaction<Database>,
    ratePlanId: string,
    productType: string,
    roomCategoryId: string | null
  ): Promise<RateProductRecord | undefined> {
    let query = trx
      .selectFrom("rate_plan_products")
      .selectAll()
      .where("rate_plan_id", "=", ratePlanId)
      .where("product_type", "=", productType);

    query =
      roomCategoryId === null
        ? query.where("room_category_id", "is", null)
        : query.where("room_category_id", "=", roomCategoryId);

    return query.forUpdate().executeTakeFirst();
  }

  async findProduct(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    rateProductId: string
  ): Promise<RateProductRecord | undefined> {
    return trx
      .selectFrom("rate_plan_products")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", rateProductId)
      .executeTakeFirst();
  }

  async listProducts(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<RateProductRecord[]> {
    return trx
      .selectFrom("rate_plan_products")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .orderBy("rate_plan_id")
      .orderBy("product_type")
      .orderBy("room_category_id")
      .execute();
  }

  async createProduct(
    trx: Transaction<Database>,
    input: Omit<RateProductRecord, "id" | "status" | "version" | "created_at" | "updated_at">
  ): Promise<RateProductRecord> {
    return trx
      .insertInto("rate_plan_products")
      .values({
        id: randomUUID(),
        ...input
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateProduct(
    trx: Transaction<Database>,
    id: string,
    expectedVersion: number,
    input: {
      baseRateMinor: number;
      floorRateMinor: number | null;
      ceilingRateMinor: number | null;
      includedAdults: number;
      includedChildren: number;
      maxAdults: number;
      maxChildren: number;
      maxOccupancy: number;
      extraAdultMinor: number;
      extraChildMinor: number;
      updatedByUserId: string | null;
    }
  ): Promise<RateProductRecord | undefined> {
    return trx
      .updateTable("rate_plan_products")
      .set({
        base_rate_minor: input.baseRateMinor,
        floor_rate_minor: input.floorRateMinor,
        ceiling_rate_minor: input.ceilingRateMinor,
        included_adults: input.includedAdults,
        included_children: input.includedChildren,
        max_adults: input.maxAdults,
        max_children: input.maxChildren,
        max_occupancy: input.maxOccupancy,
        extra_adult_minor: input.extraAdultMinor,
        extra_child_minor: input.extraChildMinor,
        updated_by_user_id: input.updatedByUserId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", id)
      .where("version", "=", expectedVersion)
      .returningAll()
      .executeTakeFirst();
  }

  async listActiveRoomCategoryPricingSources(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ) {
    return trx
      .selectFrom("room_categories as rc")
      .select([
        "rc.id as room_category_id",
        "rc.base_adults as base_adults",
        "rc.base_children as base_children",
        "rc.max_adults as max_adults",
        "rc.max_children as max_children",
        "rc.max_occupancy as max_occupancy",
        "rc.default_extra_adult_minor as default_extra_adult_minor",
        "rc.default_extra_child_minor as default_extra_child_minor",
        sql<number>`(
          select count(*)::int
          from physical_units as pu
          where pu.organization_id = rc.organization_id
            and pu.property_id = rc.property_id
            and pu.room_category_id = rc.id
            and pu.status = 'ACTIVE'
        )`.as("physical_capacity")
      ])
      .where("rc.organization_id", "=", organizationId)
      .where("rc.property_id", "=", propertyId)
      .where("rc.status", "=", "ACTIVE")
      .orderBy("rc.sort_order")
      .orderBy("rc.name")
      .execute();
  }

  async findCalendarDayForUpdate(
    trx: Transaction<Database>,
    rateProductId: string,
    stayDate: string
  ): Promise<RateCalendarDayRecord | undefined> {
    return trx
      .selectFrom("rate_calendar_days")
      .selectAll()
      .where("rate_product_id", "=", rateProductId)
      .where("stay_date", "=", stayDate)
      .forUpdate()
      .executeTakeFirst();
  }

  async createCalendarDay(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      rateProductId: string;
      stayDate: string;
      rateMinor: number;
      extraAdultMinor: number | null;
      extraChildMinor: number | null;
      minimumStay: number;
      maximumStay: number | null;
      closedToArrival: boolean;
      closedToDeparture: boolean;
      stopSell: boolean;
      source: string;
      updatedByUserId: string | null;
    }
  ): Promise<RateCalendarDayRecord> {
    return trx
      .insertInto("rate_calendar_days")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        rate_product_id: input.rateProductId,
        stay_date: input.stayDate,
        rate_minor: input.rateMinor,
        extra_adult_minor: input.extraAdultMinor,
        extra_child_minor: input.extraChildMinor,
        minimum_stay: input.minimumStay,
        maximum_stay: input.maximumStay,
        closed_to_arrival: input.closedToArrival,
        closed_to_departure: input.closedToDeparture,
        stop_sell: input.stopSell,
        source: input.source,
        updated_by_user_id: input.updatedByUserId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateCalendarDay(
    trx: Transaction<Database>,
    id: string,
    expectedVersion: number,
    input: {
      rateMinor: number;
      extraAdultMinor: number | null;
      extraChildMinor: number | null;
      minimumStay: number;
      maximumStay: number | null;
      closedToArrival: boolean;
      closedToDeparture: boolean;
      stopSell: boolean;
      source: string;
      updatedByUserId: string | null;
    }
  ): Promise<RateCalendarDayRecord | undefined> {
    return trx
      .updateTable("rate_calendar_days")
      .set({
        rate_minor: input.rateMinor,
        extra_adult_minor: input.extraAdultMinor,
        extra_child_minor: input.extraChildMinor,
        minimum_stay: input.minimumStay,
        maximum_stay: input.maximumStay,
        closed_to_arrival: input.closedToArrival,
        closed_to_departure: input.closedToDeparture,
        stop_sell: input.stopSell,
        source: input.source,
        updated_by_user_id: input.updatedByUserId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", id)
      .where("version", "=", expectedVersion)
      .returningAll()
      .executeTakeFirst();
  }

  async listCalendarDays(
    trx: Transaction<Database>,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarDayRecord[]> {
    return trx
      .selectFrom("rate_calendar_days")
      .selectAll()
      .where("rate_product_id", "=", rateProductId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("stay_date")
      .execute();
  }

  async recordEvent(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      ratePlanId: string | null;
      rateProductId: string | null;
      stayDate: string | null;
      eventType:
        | "RATE_PLAN_CREATED"
        | "RATE_PRODUCT_CREATED"
        | "RATE_PRODUCT_UPDATED"
        | "RATE_CALENDAR_DAY_CREATED"
        | "RATE_CALENDAR_DAY_UPDATED";
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("rate_events")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        rate_plan_id: input.ratePlanId,
        rate_product_id: input.rateProductId,
        stay_date: input.stayDate,
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
