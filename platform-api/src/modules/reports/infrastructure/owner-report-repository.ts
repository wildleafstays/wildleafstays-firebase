import { sql, type Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

export interface ConfirmedInventoryDayRecord {
  stay_date: string;
  bucket_type: string;
  confirmed_quantity: number;
}

export interface PropertyFinancialContextRecord {
  timezone: string;
  currency_code: string;
}

export interface RecognizedRevenueDayRecord {
  date: string;
  currency_code: string;
  amount_minor: string;
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

  async propertyFinancialContext(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyFinancialContextRecord | undefined> {
    return db
      .selectFrom("properties as property")
      .innerJoin("organizations as organization", "organization.id", "property.organization_id")
      .select(["property.timezone", "organization.currency_code"])
      .where("property.organization_id", "=", organizationId)
      .where("property.id", "=", propertyId)
      .executeTakeFirst();
  }

  async listRecognizedRevenueByDate(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<RecognizedRevenueDayRecord[]> {
    return db
      .selectFrom("financial_ledger_journals as journal")
      .select([
        sql<string>`journal.recognition_date::text`.as("date"),
        "journal.currency_code",
        sql<string>`sum(journal.amount_minor)::text`.as("amount_minor")
      ])
      .where("journal.organization_id", "=", organizationId)
      .where("journal.property_id", "=", propertyId)
      .where("journal.journal_type", "=", "REVENUE_RECOGNIZED")
      .where("journal.recognition_date", ">=", startDate)
      .where("journal.recognition_date", "<", endDate)
      .groupBy(["journal.recognition_date", "journal.currency_code"])
      .execute();
  }

  async listRevenueReversalsByLocalDate(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string,
    timezone: string,
    startDate: string,
    endDate: string
  ): Promise<RecognizedRevenueDayRecord[]> {
    const localDate = sql<string>`(journal.occurred_at at time zone ${timezone})::date`;

    return db
      .selectFrom("financial_ledger_journals as journal")
      .select([
        sql<string>`${localDate}::text`.as("date"),
        "journal.currency_code",
        sql<string>`sum(journal.amount_minor)::text`.as("amount_minor")
      ])
      .where("journal.organization_id", "=", organizationId)
      .where("journal.property_id", "=", propertyId)
      .where("journal.journal_type", "=", "REVENUE_REVERSED")
      .where(sql<boolean>`${localDate} >= ${startDate}::date`)
      .where(sql<boolean>`${localDate} < ${endDate}::date`)
      .groupBy([sql.ref("date"), "journal.currency_code"])
      .execute();
  }
}
