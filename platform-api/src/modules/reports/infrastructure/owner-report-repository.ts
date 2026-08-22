import { sql, type Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

export interface ConfirmedInventoryDayRecord {
  stay_date: string;
  bucket_type: string;
  confirmed_quantity: number;
}

export class OwnerReportRepository {
  async activePhysicalUnitCapacity(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<number | undefined> {
    const row = await db
      .selectFrom("properties as property")
      .leftJoin("physical_units as unit", (join) =>
        join
          .onRef("unit.organization_id", "=", "property.organization_id")
          .onRef("unit.property_id", "=", "property.id")
          .on("unit.status", "=", "ACTIVE")
      )
      .select(["property.id", sql<number>`count(unit.id)::int`.as("capacity")])
      .where("property.organization_id", "=", organizationId)
      .where("property.id", "=", propertyId)
      .groupBy("property.id")
      .executeTakeFirst();

    return row ? Number(row.capacity) : undefined;
  }

  async countConfirmedReservations(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const row = await db
      .selectFrom("reservations as reservation")
      .innerJoin("inventory_allocations as allocation", (join) =>
        join
          .onRef("allocation.organization_id", "=", "reservation.organization_id")
          .onRef("allocation.property_id", "=", "reservation.property_id")
          .onRef("allocation.hold_id", "=", "reservation.inventory_hold_id")
      )
      .select(sql<number>`count(distinct reservation.id)::int`.as("reservation_count"))
      .where("reservation.organization_id", "=", organizationId)
      .where("reservation.property_id", "=", propertyId)
      .where("reservation.departure_date", ">", startDate)
      .where("reservation.arrival_date", "<", endDate)
      .where("allocation.status", "=", "CONFIRMED")
      .executeTakeFirstOrThrow();

    return Number(row.reservation_count);
  }

  async listConfirmedInventoryByDate(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<ConfirmedInventoryDayRecord[]> {
    return db
      .selectFrom("inventory_daily_buckets")
      .select([
        "stay_date",
        "bucket_type",
        sql<number>`sum(confirmed_quantity)::int`.as("confirmed_quantity")
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .where("confirmed_quantity", ">", 0)
      .groupBy(["stay_date", "bucket_type"])
      .orderBy("stay_date")
      .orderBy("bucket_type")
      .execute();
  }
}
