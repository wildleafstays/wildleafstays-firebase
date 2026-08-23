import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  QuoteCancellationSnapshotsTable,
  QuoteCancellationTierSnapshotsTable
} from "../../quotes/infrastructure/quote-commercial-database-types.js";
import type { QuoteNightsTable } from "../../quotes/infrastructure/quote-database-types.js";
import type { GuestCancellationPenaltyType } from "../domain/guest-cancellation.js";
import type { ReservationCancellationDecisionsTable } from "./guest-cancellation-database-types.js";

export type GuestCancellationDecisionRecord = Selectable<ReservationCancellationDecisionsTable>;

export type GuestCancellationSnapshotRecord = Selectable<QuoteCancellationSnapshotsTable>;

export type GuestCancellationTierRecord = Selectable<QuoteCancellationTierSnapshotsTable>;

export type GuestCancellationQuoteNightRecord = Selectable<QuoteNightsTable>;

export interface GuestCancellationBookedEconomics {
  snapshot: GuestCancellationSnapshotRecord;
  tiers: GuestCancellationTierRecord[];
  nights: GuestCancellationQuoteNightRecord[];
}

export interface GuestCancellationReservationScope {
  organizationId: string;
  propertyId: string;
  propertyTimezone: string;
}

export interface InsertGuestCancellationDecisionInput {
  reservationId: string;
  organizationId: string;
  propertyId: string;
  guestUserId: string;
  quoteId: string;
  quoteCancellationSnapshotId: string;
  quoteCancellationTierSnapshotId: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  cancelledAt: Date;
  arrivalAt: Date;
  minutesBeforeArrival: number;
  tierMinimumMinutesBeforeArrival: number;
  penaltyType: GuestCancellationPenaltyType;
  penaltyValue: number;
  acceptedTotalMinor: number;
  paidMinor: number;
  penaltyMinor: number;
  refundDueMinor: number;
  currencyCode: string;
  provider: string;
  providerPaymentId: string;
  request: RequestMetadata;
}

export class GuestCancellationRepository {
  async findOwnedReservationScope(
    trx: Transaction<Database>,
    userId: string,
    reservationId: string
  ): Promise<GuestCancellationReservationScope | undefined> {
    const row = await trx
      .selectFrom("guest_reservation_links as link")
      .innerJoin("reservations as reservation", "reservation.id", "link.reservation_id")
      .innerJoin("properties as property", "property.id", "reservation.property_id")
      .select([
        "reservation.organization_id as organization_id",
        "reservation.property_id as property_id",
        "property.timezone as property_timezone"
      ])
      .where("link.user_id", "=", userId)
      .where("link.reservation_id", "=", reservationId)
      .executeTakeFirst();

    if (!row) {
      return undefined;
    }

    return {
      organizationId: row.organization_id,
      propertyId: row.property_id,
      propertyTimezone: row.property_timezone
    };
  }

  async findExistingDecision(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<GuestCancellationDecisionRecord | undefined> {
    return trx
      .selectFrom("reservation_cancellation_decisions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .executeTakeFirst();
  }

  async loadBookedEconomics(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
    }
  ): Promise<GuestCancellationBookedEconomics | undefined> {
    const snapshot = await trx
      .selectFrom("quote_cancellation_snapshots")
      .selectAll()
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("quote_id", "=", input.quoteId)
      .executeTakeFirst();

    if (!snapshot) {
      return undefined;
    }

    const [tiers, nights] = await Promise.all([
      trx
        .selectFrom("quote_cancellation_tier_snapshots")
        .selectAll()
        .where("organization_id", "=", input.organizationId)
        .where("property_id", "=", input.propertyId)
        .where("quote_id", "=", input.quoteId)
        .where("quote_cancellation_snapshot_id", "=", snapshot.id)
        .orderBy("minimum_minutes_before_arrival", "desc")
        .orderBy("id", "asc")
        .execute(),

      trx
        .selectFrom("quote_nights")
        .selectAll()
        .where("organization_id", "=", input.organizationId)
        .where("property_id", "=", input.propertyId)
        .where("quote_id", "=", input.quoteId)
        .orderBy("stay_date", "asc")
        .orderBy("id", "asc")
        .execute()
    ]);

    return {
      snapshot,
      tiers,
      nights
    };
  }

  async insertDecision(
    trx: Transaction<Database>,
    input: InsertGuestCancellationDecisionInput
  ): Promise<GuestCancellationDecisionRecord | undefined> {
    return trx
      .insertInto("reservation_cancellation_decisions")
      .values({
        reservation_id: input.reservationId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        guest_user_id: input.guestUserId,
        quote_id: input.quoteId,
        quote_cancellation_snapshot_id: input.quoteCancellationSnapshotId,
        quote_cancellation_tier_snapshot_id: input.quoteCancellationTierSnapshotId,
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        cancelled_at: input.cancelledAt,
        arrival_at: input.arrivalAt,
        minutes_before_arrival: input.minutesBeforeArrival,
        tier_minimum_minutes_before_arrival: input.tierMinimumMinutesBeforeArrival,
        penalty_type: input.penaltyType,
        penalty_value: input.penaltyValue,
        accepted_total_minor: input.acceptedTotalMinor,
        paid_minor: input.paidMinor,
        penalty_minor: input.penaltyMinor,
        refund_due_minor: input.refundDueMinor,
        currency_code: input.currencyCode,
        provider: input.provider,
        provider_payment_id: input.providerPaymentId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.column("reservation_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }
}
