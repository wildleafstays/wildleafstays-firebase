import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface PublicAvailabilityPropertyRecord {
  id: string;
  organization_id: string;
  public_slug: string;
  name: string;
  sale_mode: string | null;
}

export interface PublicAvailabilityCategoryRecord {
  id: string;
  code: string;
  name: string;
  capacity: number;
  base_adults: number | null;
  base_children: number | null;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  default_extra_adult_minor: number | null;
  default_extra_child_minor: number | null;
}

export interface PublicAvailabilityBucketRecord {
  id: string;
  bucket_type: string;
  room_category_id: string | null;
  stay_date: string;
  held_quantity: number;
  confirmed_quantity: number;
  capacity_override: number | null;
  overbooking_limit: number;
  stop_sell: boolean;
}

export interface PublicAvailabilityBlockRecord {
  scope_type: string;
  room_category_id: string | null;
  physical_unit_id: string | null;
  start_date: string;
  end_date: string;
  quantity: number;
}

export interface PublicExpiredHoldQuantityRecord {
  bucket_id: string;
  quantity: number;
}

export interface PublicRateOfferRecord {
  rate_product_id: string;
  product_type: string;
  room_category_id: string | null;
  base_rate_minor: number;
  included_adults: number;
  included_children: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  extra_adult_minor: number;
  extra_child_minor: number;
  rate_plan_code: string;
  rate_plan_name: string;
  meal_plan_code: string;
  currency_code: string;
  room_category_code: string | null;
  room_category_name: string | null;
}

export interface PublicRateCalendarRecord {
  rate_product_id: string;
  stay_date: string;
  rate_minor: number;
  extra_adult_minor: number | null;
  extra_child_minor: number | null;
  minimum_stay: number;
  maximum_stay: number | null;
  closed_to_arrival: boolean;
  closed_to_departure: boolean;
  stop_sell: boolean;
}

export class PublicAvailabilityRepository {
  async findLivePropertyBySlug(
    db: DbExecutor,
    publicSlug: string
  ): Promise<PublicAvailabilityPropertyRecord | undefined> {
    return db
      .selectFrom("properties")
      .select(["id", "organization_id", "public_slug", "name", "sale_mode"])
      .where("status", "=", "LIVE")
      .where("public_slug", "=", publicSlug)
      .executeTakeFirst() as Promise<PublicAvailabilityPropertyRecord | undefined>;
  }

  async listRoomCategoryCapacities(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicAvailabilityCategoryRecord[]> {
    return db
      .selectFrom("room_categories as rc")
      .leftJoin("physical_units as pu", (join) =>
        join
          .onRef("pu.room_category_id", "=", "rc.id")
          .onRef("pu.property_id", "=", "rc.property_id")
          .onRef("pu.organization_id", "=", "rc.organization_id")
          .on("pu.status", "=", "ACTIVE")
      )
      .select([
        "rc.id as id",
        "rc.code as code",
        "rc.name as name",
        "rc.base_adults as base_adults",
        "rc.base_children as base_children",
        "rc.max_adults as max_adults",
        "rc.max_children as max_children",
        "rc.max_occupancy as max_occupancy",
        "rc.default_extra_adult_minor as default_extra_adult_minor",
        "rc.default_extra_child_minor as default_extra_child_minor",
        sql<number>`count(pu.id)::int`.as("capacity")
      ])
      .where("rc.organization_id", "=", organizationId)
      .where("rc.property_id", "=", propertyId)
      .where("rc.status", "=", "ACTIVE")
      .groupBy([
        "rc.id",
        "rc.code",
        "rc.name",
        "rc.base_adults",
        "rc.base_children",
        "rc.max_adults",
        "rc.max_children",
        "rc.max_occupancy",
        "rc.default_extra_adult_minor",
        "rc.default_extra_child_minor"
      ])
      .orderBy("rc.sort_order")
      .orderBy("rc.name")
      .execute();
  }

  async listBuckets(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<PublicAvailabilityBucketRecord[]> {
    return db
      .selectFrom("inventory_daily_buckets")
      .select([
        "id",
        "bucket_type",
        "room_category_id",
        "stay_date",
        "held_quantity",
        "confirmed_quantity",
        "capacity_override",
        "overbooking_limit",
        "stop_sell"
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("stay_date")
      .orderBy("bucket_type")
      .execute() as Promise<PublicAvailabilityBucketRecord[]>;
  }

  async listBlocks(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<PublicAvailabilityBlockRecord[]> {
    return db
      .selectFrom("inventory_blocks")
      .select([
        "scope_type",
        "room_category_id",
        "physical_unit_id",
        "start_date",
        "end_date",
        "quantity"
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .where("start_date", "<", endDate)
      .where("end_date", ">", startDate)
      .orderBy("start_date")
      .execute() as Promise<PublicAvailabilityBlockRecord[]>;
  }

  async listExpiredHoldQuantities(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    now: Date
  ): Promise<PublicExpiredHoldQuantityRecord[]> {
    return db
      .selectFrom("inventory_hold_nights as ihn")
      .innerJoin("inventory_holds as ih", "ih.id", "ihn.hold_id")
      .select([
        "ihn.bucket_id as bucket_id",
        sql<number>`coalesce(sum(ihn.quantity), 0)::int`.as("quantity")
      ])
      .where("ih.organization_id", "=", organizationId)
      .where("ih.property_id", "=", propertyId)
      .where("ih.status", "=", "ACTIVE")
      .where("ih.expires_at", "<=", now)
      .where("ihn.stay_date", ">=", startDate)
      .where("ihn.stay_date", "<", endDate)
      .groupBy("ihn.bucket_id")
      .execute();
  }

  async listActiveRateOffers(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicRateOfferRecord[]> {
    return db
      .selectFrom("rate_plan_products as product")
      .innerJoin("rate_plans as plan", (join) =>
        join
          .onRef("plan.id", "=", "product.rate_plan_id")
          .onRef("plan.organization_id", "=", "product.organization_id")
          .onRef("plan.property_id", "=", "product.property_id")
      )
      .leftJoin("room_categories as category", (join) =>
        join
          .onRef("category.id", "=", "product.room_category_id")
          .onRef("category.organization_id", "=", "product.organization_id")
          .onRef("category.property_id", "=", "product.property_id")
      )
      .select([
        "product.id as rate_product_id",
        "product.product_type as product_type",
        "product.room_category_id as room_category_id",
        "product.base_rate_minor as base_rate_minor",
        sql<number>`coalesce(category.base_adults, product.included_adults)`.as("included_adults"),
        sql<number>`coalesce(category.base_children, product.included_children)`.as(
          "included_children"
        ),
        sql<number>`coalesce(category.max_adults, product.max_adults)`.as("max_adults"),
        sql<number>`coalesce(category.max_children, product.max_children)`.as("max_children"),
        sql<number>`coalesce(category.max_occupancy, product.max_occupancy)`.as("max_occupancy"),
        sql<number>`coalesce(category.default_extra_adult_minor, product.extra_adult_minor)`.as(
          "extra_adult_minor"
        ),
        sql<number>`coalesce(category.default_extra_child_minor, product.extra_child_minor)`.as(
          "extra_child_minor"
        ),
        "plan.code as rate_plan_code",
        "plan.name as rate_plan_name",
        "plan.meal_plan_code as meal_plan_code",
        "plan.currency_code as currency_code",
        "category.code as room_category_code",
        "category.name as room_category_name"
      ])
      .where("product.organization_id", "=", organizationId)
      .where("product.property_id", "=", propertyId)
      .where("product.status", "=", "ACTIVE")
      .where("plan.status", "=", "ACTIVE")
      .where((eb) =>
        eb.or([
          eb("product.product_type", "=", "FULL_PROPERTY"),
          eb("category.status", "=", "ACTIVE")
        ])
      )
      .orderBy("plan.code")
      .orderBy("product.product_type")
      .orderBy("category.name")
      .execute() as Promise<PublicRateOfferRecord[]>;
  }

  async listCalendarDays(
    db: DbExecutor,
    rateProductIds: string[],
    startDate: string,
    endDate: string
  ): Promise<PublicRateCalendarRecord[]> {
    if (rateProductIds.length === 0) {
      return [];
    }

    return db
      .selectFrom("rate_calendar_days")
      .select([
        "rate_product_id",
        "stay_date",
        "rate_minor",
        "extra_adult_minor",
        "extra_child_minor",
        "minimum_stay",
        "maximum_stay",
        "closed_to_arrival",
        "closed_to_departure",
        "stop_sell"
      ])
      .where("rate_product_id", "in", rateProductIds)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("rate_product_id")
      .orderBy("stay_date")
      .execute() as Promise<PublicRateCalendarRecord[]>;
  }
}
