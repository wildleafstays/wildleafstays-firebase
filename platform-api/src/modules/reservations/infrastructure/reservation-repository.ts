import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  ReservationFinancialSnapshotView,
  ReservationStatus,
  ReservationView
} from "../domain/reservation.js";
import type {
  ReservationFinancialSnapshotsTable,
  ReservationLeadGuestSnapshotsTable,
  ReservationsTable
} from "./reservation-database-types.js";

export type ReservationRecord = Selectable<ReservationsTable>;
export type ReservationFinancialSnapshotRecord = Selectable<ReservationFinancialSnapshotsTable>;
export type ReservationLeadGuestSnapshotRecord = Selectable<ReservationLeadGuestSnapshotsTable>;

function financialView(row: ReservationFinancialSnapshotRecord): ReservationFinancialSnapshotView {
  return {
    quoteReference: row.quote_reference,
    ratePlanId: row.rate_plan_id,
    ratePlanCode: row.rate_plan_code,
    ratePlanName: row.rate_plan_name,
    mealPlanCode: row.meal_plan_code,
    rateProductId: row.rate_product_id,
    rateProductVersion: row.rate_product_version,
    productType: row.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
    productLabel: row.product_label,
    roomCategoryId: row.room_category_id,
    arrivalDate: row.arrival_date,
    departureDate: row.departure_date,
    quantity: row.quantity,
    commercialStatus: row.commercial_status as "COMMERCIAL_RULES_APPLIED",
    promotionStatus: row.promotion_status as "EVALUATED",
    currencyCode: row.currency_code,
    grossAccommodationMinor: row.gross_accommodation_minor,
    grossExtraGuestMinor: row.gross_extra_guest_minor,
    accommodationDiscountMinor: row.accommodation_discount_minor,
    extraGuestDiscountMinor: row.extra_guest_discount_minor,
    discountMinor: row.discount_minor,
    discountedAccommodationMinor: row.discounted_accommodation_minor,
    discountedExtraGuestMinor: row.discounted_extra_guest_minor,
    inclusiveFeeMinor: row.inclusive_fee_minor,
    exclusiveFeeMinor: row.exclusive_fee_minor,
    feeMinor: row.fee_minor,
    inclusiveTaxMinor: row.inclusive_tax_minor,
    exclusiveTaxMinor: row.exclusive_tax_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor
  };
}

export class ReservationRepository {
  async findByQuote(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    quoteId: string
  ): Promise<ReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("quote_id", "=", quoteId)
      .executeTakeFirst();
  }

  async findById(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<ReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .executeTakeFirst();
  }

  async findByIdForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<ReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .forUpdate()
      .executeTakeFirst();
  }

  async transitionStatus(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    fromStatus: ReservationStatus,
    toStatus: ReservationStatus
  ): Promise<ReservationRecord | undefined> {
    return trx
      .updateTable("reservations")
      .set({
        status: toStatus,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .where("status", "=", fromStatus)
      .returningAll()
      .executeTakeFirst();
  }

  async appendStatusHistory(
    trx: Transaction<Database>,
    input: {
      reservationId: string;
      organizationId: string;
      propertyId: string;
      fromStatus: ReservationStatus;
      toStatus: ReservationStatus;
      reason: string;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    const latest = await trx
      .selectFrom("reservation_status_history")
      .select((eb) => eb.fn.max<number>("sequence_number").as("max_sequence"))
      .where("reservation_id", "=", input.reservationId)
      .executeTakeFirst();

    const sequenceNumber = Number(latest?.max_sequence ?? 0) + 1;
    await trx
      .insertInto("reservation_status_history")
      .values({
        id: randomUUID(),
        reservation_id: input.reservationId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        sequence_number: sequenceNumber,
        from_status: input.fromStatus,
        to_status: input.toStatus,
        reason: input.reason,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }

  async createReservation(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      reservationReference: string;
      quoteId: string;
      quoteInventoryHoldId: string;
      inventoryHoldId: string;
      holdExpiresAt: Date;
      arrivalDate: string;
      departureDate: string;
      productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
      roomCategoryId: string | null;
      quantity: number;
      currencyCode: string;
      totalMinor: number;
      createdByUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<ReservationRecord | undefined> {
    return trx
      .insertInto("reservations")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_reference: input.reservationReference,
        quote_id: input.quoteId,
        quote_inventory_hold_id: input.quoteInventoryHoldId,
        inventory_hold_id: input.inventoryHoldId,
        status: "HELD",
        hold_expires_at: input.holdExpiresAt,
        arrival_date: input.arrivalDate,
        departure_date: input.departureDate,
        product_type: input.productType,
        room_category_id: input.roomCategoryId,
        quantity: input.quantity,
        currency_code: input.currencyCode,
        total_minor: input.totalMinor,
        created_by_user_id: input.createdByUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createFinancialSnapshot(
    trx: Transaction<Database>,
    input: Omit<ReservationFinancialSnapshotRecord, "id" | "created_at">
  ): Promise<void> {
    await trx
      .insertInto("reservation_financial_snapshots")
      .values({
        id: randomUUID(),
        ...input
      })
      .execute();
  }

  async createLeadGuestSnapshot(
    trx: Transaction<Database>,
    input: {
      reservationId: string;
      organizationId: string;
      propertyId: string;
      guestName: string;
      email: string | null;
      phone: string | null;
    }
  ): Promise<void> {
    await trx
      .insertInto("reservation_lead_guest_snapshots")
      .values({
        id: randomUUID(),
        reservation_id: input.reservationId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        guest_name: input.guestName,
        email: input.email,
        phone_e164: input.phone
      })
      .execute();
  }

  async createInitialStatusHistory(
    trx: Transaction<Database>,
    input: {
      reservationId: string;
      organizationId: string;
      propertyId: string;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("reservation_status_history")
      .values({
        id: randomUUID(),
        reservation_id: input.reservationId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        sequence_number: 1,
        from_status: null,
        to_status: "HELD",
        reason: "QUOTE_HOLD_ACCEPTED",
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }

  async financial(
    trx: Transaction<Database>,
    reservationId: string
  ): Promise<ReservationFinancialSnapshotRecord> {
    return trx
      .selectFrom("reservation_financial_snapshots")
      .selectAll()
      .where("reservation_id", "=", reservationId)
      .executeTakeFirstOrThrow();
  }

  async leadGuest(
    trx: Transaction<Database>,
    reservationId: string
  ): Promise<ReservationLeadGuestSnapshotRecord> {
    return trx
      .selectFrom("reservation_lead_guest_snapshots")
      .selectAll()
      .where("reservation_id", "=", reservationId)
      .executeTakeFirstOrThrow();
  }

  async view(
    trx: Transaction<Database>,
    reservation: ReservationRecord,
    now: Date
  ): Promise<ReservationView> {
    const [financial, leadGuest] = await Promise.all([
      this.financial(trx, reservation.id),
      this.leadGuest(trx, reservation.id)
    ]);

    return {
      id: reservation.id,
      reservationReference: reservation.reservation_reference,
      organizationId: reservation.organization_id,
      propertyId: reservation.property_id,
      quoteId: reservation.quote_id,
      quoteInventoryHoldId: reservation.quote_inventory_hold_id,
      inventoryHoldId: reservation.inventory_hold_id,
      status: reservation.status as ReservationStatus,
      holdExpiresAt: reservation.hold_expires_at.toISOString(),
      holdExpired: reservation.hold_expires_at <= now,
      arrivalDate: reservation.arrival_date,
      departureDate: reservation.departure_date,
      productType: reservation.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
      roomCategoryId: reservation.room_category_id,
      quantity: reservation.quantity,
      currencyCode: reservation.currency_code,
      totalMinor: reservation.total_minor,
      leadGuest: {
        name: leadGuest.guest_name,
        email: leadGuest.email,
        phone: leadGuest.phone_e164
      },
      financial: financialView(financial),
      createdAt: reservation.created_at.toISOString()
    };
  }
}
