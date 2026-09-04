import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
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
type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ReservationListCursor {
  createdAt: Date;
  id: string;
}

export interface ReservationListRecord {
  id: string;
  organization_id: string;
  property_id: string;
  reservation_reference: string;
  status: string;
  arrival_date: string;
  departure_date: string;
  product_type: string;
  product_label: string;
  room_category_id: string | null;
  quantity: number;
  currency_code: string;
  total_minor: number;
  guest_name: string;
  email: string | null;
  phone_e164: string | null;
  created_at: Date;
}

export interface PlatformReservationListRecord extends ReservationListRecord {
  organization_name: string;
  property_name: string;
}

export interface ReservationOperationCounts {
  arrivals: number;
  departures: number;
  inHouse: number;
  upcoming: number;
  paymentPending: number;
}

function financialView(row: ReservationFinancialSnapshotRecord): ReservationFinancialSnapshotView {
  return {
    quoteReference: row.quote_reference,
    ratePlanId: row.rate_plan_id,
    ratePlanCode: row.rate_plan_code,
    ratePlanName: row.rate_plan_name,
    mealPlanCode: row.meal_plan_code,
    rateProductId: row.rate_product_id,
    rateProductVersion: row.rate_product_version,
    productType: row.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX",
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
  async listForProperty(
    db: DbExecutor,
    input: {
      organizationId: string;
      propertyId: string;
      status: string | null;
      startDate: string | null;
      endDate: string | null;
      cursor: ReservationListCursor | null;
      limit: number;
    }
  ): Promise<ReservationListRecord[]> {
    let query = db
      .selectFrom("reservations as reservation")
      .innerJoin(
        "reservation_lead_guest_snapshots as guest",
        "guest.reservation_id",
        "reservation.id"
      )
      .innerJoin(
        "reservation_financial_snapshots as financial",
        "financial.reservation_id",
        "reservation.id"
      )
      .select([
        "reservation.id",
        "reservation.organization_id",
        "reservation.property_id",
        "reservation.reservation_reference",
        "reservation.status",
        "reservation.arrival_date",
        "reservation.departure_date",
        "reservation.product_type",
        "financial.product_label",
        "reservation.room_category_id",
        "reservation.quantity",
        "reservation.currency_code",
        "reservation.total_minor",
        "guest.guest_name",
        "guest.email",
        "guest.phone_e164",
        "reservation.created_at"
      ])
      .where("reservation.organization_id", "=", input.organizationId)
      .where("reservation.property_id", "=", input.propertyId);

    if (input.status) {
      query = query.where("reservation.status", "=", input.status);
    }
    if (input.startDate && input.endDate) {
      query = query
        .where("reservation.departure_date", ">", input.startDate)
        .where("reservation.arrival_date", "<", input.endDate);
    }
    if (input.cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("reservation.created_at", "<", input.cursor!.createdAt),
          eb.and([
            eb("reservation.created_at", "=", input.cursor!.createdAt),
            eb("reservation.id", "<", input.cursor!.id)
          ])
        ])
      );
    }

    return query
      .orderBy("reservation.created_at", "desc")
      .orderBy("reservation.id", "desc")
      .limit(input.limit)
      .execute();
  }

  async listForPlatform(
    db: DbExecutor,
    input: {
      status: string | null;
      startDate: string | null;
      endDate: string | null;
      cursor: ReservationListCursor | null;
      limit: number;
    }
  ): Promise<PlatformReservationListRecord[]> {
    let query = db
      .selectFrom("reservations as reservation")
      .innerJoin("properties as property", "property.id", "reservation.property_id")
      .innerJoin("organizations as organization", "organization.id", "reservation.organization_id")
      .innerJoin(
        "reservation_lead_guest_snapshots as guest",
        "guest.reservation_id",
        "reservation.id"
      )
      .innerJoin(
        "reservation_financial_snapshots as financial",
        "financial.reservation_id",
        "reservation.id"
      )
      .select([
        "reservation.id",
        "reservation.organization_id",
        "reservation.property_id",
        "organization.legal_name as organization_name",
        "property.name as property_name",
        "reservation.reservation_reference",
        "reservation.status",
        "reservation.arrival_date",
        "reservation.departure_date",
        "reservation.product_type",
        "financial.product_label",
        "reservation.room_category_id",
        "reservation.quantity",
        "reservation.currency_code",
        "reservation.total_minor",
        "guest.guest_name",
        "guest.email",
        "guest.phone_e164",
        "reservation.created_at"
      ]);

    if (input.status) query = query.where("reservation.status", "=", input.status);
    if (input.startDate && input.endDate) {
      query = query
        .where("reservation.departure_date", ">", input.startDate)
        .where("reservation.arrival_date", "<", input.endDate);
    }
    if (input.cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("reservation.created_at", "<", input.cursor!.createdAt),
          eb.and([
            eb("reservation.created_at", "=", input.cursor!.createdAt),
            eb("reservation.id", "<", input.cursor!.id)
          ])
        ])
      );
    }

    return query
      .orderBy("reservation.created_at", "desc")
      .orderBy("reservation.id", "desc")
      .limit(input.limit)
      .execute();
  }

  async operationCounts(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    businessDate: string
  ): Promise<ReservationOperationCounts> {
    const row = await db
      .selectFrom("reservations")
      .select([
        sql<number>`count(*) filter (where arrival_date = ${businessDate} and status in ('CONFIRMED', 'CHECKED_IN'))`.as(
          "arrivals"
        ),
        sql<number>`count(*) filter (where departure_date = ${businessDate} and status in ('CONFIRMED', 'CHECKED_IN'))`.as(
          "departures"
        ),
        sql<number>`count(*) filter (where arrival_date <= ${businessDate} and departure_date > ${businessDate} and status = 'CHECKED_IN')`.as(
          "in_house"
        ),
        sql<number>`count(*) filter (where arrival_date > ${businessDate} and status = 'CONFIRMED')`.as(
          "upcoming"
        ),
        sql<number>`count(*) filter (where status in ('HELD', 'PAYMENT_PENDING'))`.as(
          "payment_pending"
        )
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow();

    return {
      arrivals: Number(row.arrivals),
      departures: Number(row.departures),
      inHouse: Number(row.in_house),
      upcoming: Number(row.upcoming),
      paymentPending: Number(row.payment_pending)
    };
  }

  async platformOperationCounts(
    db: DbExecutor,
    businessDate: string
  ): Promise<ReservationOperationCounts> {
    const row = await db
      .selectFrom("reservations")
      .select([
        sql<number>`count(*) filter (where arrival_date = ${businessDate} and status in ('CONFIRMED', 'CHECKED_IN'))`.as(
          "arrivals"
        ),
        sql<number>`count(*) filter (where departure_date = ${businessDate} and status in ('CONFIRMED', 'CHECKED_IN'))`.as(
          "departures"
        ),
        sql<number>`count(*) filter (where arrival_date <= ${businessDate} and departure_date > ${businessDate} and status = 'CHECKED_IN')`.as(
          "in_house"
        ),
        sql<number>`count(*) filter (where arrival_date > ${businessDate} and status = 'CONFIRMED')`.as(
          "upcoming"
        ),
        sql<number>`count(*) filter (where status in ('HELD', 'PAYMENT_PENDING'))`.as(
          "payment_pending"
        )
      ])
      .executeTakeFirstOrThrow();

    return {
      arrivals: Number(row.arrivals),
      departures: Number(row.departures),
      inHouse: Number(row.in_house),
      upcoming: Number(row.upcoming),
      paymentPending: Number(row.payment_pending)
    };
  }

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

  async findByRoomMixQuote(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    roomMixQuoteId: string
  ): Promise<ReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("room_mix_quote_id", "=", roomMixQuoteId)
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
      quoteId: string | null;
      quoteInventoryHoldId: string | null;
      roomMixQuoteId?: string | null;
      roomMixInventoryHoldId?: string | null;
      inventoryHoldId: string;
      holdExpiresAt: Date;
      arrivalDate: string;
      departureDate: string;
      productType: "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX";
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
        room_mix_quote_id: input.roomMixQuoteId ?? null,
        room_mix_inventory_hold_id: input.roomMixInventoryHoldId ?? null,
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
      roomMixQuoteId: reservation.room_mix_quote_id,
      roomMixInventoryHoldId: reservation.room_mix_inventory_hold_id,
      inventoryHoldId: reservation.inventory_hold_id,
      status: reservation.status as ReservationStatus,
      holdExpiresAt: reservation.hold_expires_at.toISOString(),
      holdExpired: reservation.hold_expires_at <= now,
      arrivalDate: reservation.arrival_date,
      departureDate: reservation.departure_date,
      productType: reservation.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX",
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
