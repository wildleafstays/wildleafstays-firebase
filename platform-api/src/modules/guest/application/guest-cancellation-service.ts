import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { FinancialLedgerRepository } from "../../finance/infrastructure/financial-ledger-repository.js";
import { PaymentRefundRequestService } from "../../payments/application/payment-refund-request-service.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import { calculateGuestCancellationEconomics } from "./guest-cancellation-economics.js";
import { GuestCancellationInventoryService } from "./guest-cancellation-inventory-service.js";
import { GuestCancellationPaymentProofService } from "./guest-cancellation-payment-proof.js";
import { resolveGuestCancellationArrivalInstant } from "./guest-cancellation-arrival.js";
import { GuestCancellationRepository } from "../infrastructure/guest-cancellation-repository.js";

export interface GuestCancellationResult extends JsonObject {
  reservationId: string;
  status: "CANCELLED";
  cancelledAt: string;
  arrivalAt: string;
  minutesBeforeArrival: number;
  penaltyType: "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS";
  penaltyMinor: number;
  paidMinor: number;
  refundDueMinor: number;
  currencyCode: string;
  refundRequired: boolean;
  refundRequestId: string | null;
}

export interface GuestCancellationServiceDependencies {
  cancellations?: GuestCancellationRepository;
  reservations?: ReservationRepository;
  paymentProof?: GuestCancellationPaymentProofService;
  inventory?: GuestCancellationInventoryService;
  ledger?: FinancialLedgerRepository;
  refundRequests?: PaymentRefundRequestService;
  now?: () => Date;
}

export class GuestCancellationService {
  private readonly cancellations: GuestCancellationRepository;
  private readonly reservations: ReservationRepository;
  private readonly paymentProof: GuestCancellationPaymentProofService;
  private readonly inventory: GuestCancellationInventoryService;
  private readonly ledger: FinancialLedgerRepository;
  private readonly refundRequests: PaymentRefundRequestService;
  private readonly now: () => Date;

  constructor(dependencies: GuestCancellationServiceDependencies = {}) {
    this.cancellations = dependencies.cancellations ?? new GuestCancellationRepository();

    this.reservations = dependencies.reservations ?? new ReservationRepository();

    this.paymentProof = dependencies.paymentProof ?? new GuestCancellationPaymentProofService();

    this.inventory = dependencies.inventory ?? new GuestCancellationInventoryService();

    this.ledger = dependencies.ledger ?? new FinancialLedgerRepository();

    this.refundRequests = dependencies.refundRequests ?? new PaymentRefundRequestService();

    this.now = dependencies.now ?? (() => new Date());
  }

  async cancel(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<GuestCancellationResult> {
    const scope = await this.cancellations.findOwnedReservationScope(
      trx,
      actor.userId,
      input.reservationId
    );

    if (!scope) {
      throw new NotFoundError("Reservation not found");
    }

    const reservation = await this.reservations.findByIdForUpdate(
      trx,
      scope.organizationId,
      scope.propertyId,
      input.reservationId
    );

    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    if (reservation.product_type === "ROOM_MIX") {
      throw new ConflictError(
        "Mixed-room self-service cancellation is not available yet; please contact Wildleaf support",
        {
          reservationId: reservation.id,
          manualReviewRequired: true
        }
      );
    }

    const quoteId = reservation.quote_id;
    if (quoteId === null) {
      throw new ConflictError("Standard cancellation is missing its canonical quote identity", {
        reservationId: reservation.id,
        manualReviewRequired: true
      });
    }

    if (reservation.status !== "CONFIRMED") {
      throw new ConflictError("Guest cancellation is available only for a confirmed reservation", {
        reservationId: reservation.id,
        currentStatus: reservation.status,
        requiredStatus: "CONFIRMED"
      });
    }

    const existingDecision = await this.cancellations.findExistingDecision(
      trx,
      scope.organizationId,
      scope.propertyId,
      reservation.id
    );

    if (existingDecision) {
      throw new ConflictError("Reservation already has a canonical cancellation decision", {
        reservationId: reservation.id,
        cancellationDecisionId: existingDecision.id,
        manualReviewRequired: true
      });
    }

    const booked = await this.cancellations.loadBookedEconomics(trx, {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      quoteId
    });

    if (!booked) {
      throw new ConflictError("Reservation is missing immutable cancellation economics", {
        reservationId: reservation.id,
        manualReviewRequired: true
      });
    }

    const arrivalAt = resolveGuestCancellationArrivalInstant({
      arrivalDate: reservation.arrival_date,
      arrivalLocalTime: booked.snapshot.arrival_local_time,
      timeZone: scope.propertyTimezone
    });

    const cancelledAt = this.now();

    if (Number.isNaN(cancelledAt.getTime()) || cancelledAt >= arrivalAt) {
      throw new ConflictError(
        "Guest cancellation must occur strictly before the canonical arrival instant",
        {
          reservationId: reservation.id,
          arrivalAt: arrivalAt.toISOString()
        }
      );
    }

    const minutesBeforeArrival = Math.floor((arrivalAt.getTime() - cancelledAt.getTime()) / 60_000);

    if (!Number.isSafeInteger(minutesBeforeArrival) || minutesBeforeArrival < 0) {
      throw new ConflictError("Canonical cancellation timing could not be calculated", {
        reservationId: reservation.id,
        manualReviewRequired: true
      });
    }

    const recognizedRevenue = await this.ledger.findRecognizedRevenueForReservationForUpdate(
      trx,
      scope.organizationId,
      scope.propertyId,
      reservation.id
    );

    if (recognizedRevenue.length !== 0) {
      throw new ConflictError(
        "Confirmed reservation has contradictory recognized revenue and requires manual review",
        {
          reservationId: reservation.id,
          recognizedRevenueJournalCount: recognizedRevenue.length,
          manualReviewRequired: true
        }
      );
    }

    const proof = await this.paymentProof.loadCanonical(trx, {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      reservationId: reservation.id,
      acceptedTotalMinor: reservation.total_minor,
      currencyCode: reservation.currency_code
    });

    const economics = calculateGuestCancellationEconomics({
      acceptedTotalMinor: reservation.total_minor,
      minutesBeforeArrival,
      tiers: booked.tiers.map((tier) => ({
        id: tier.id,
        triggerType: tier.trigger_type,
        minimumMinutesBeforeArrival: tier.minimum_minutes_before_arrival,
        penaltyType: tier.penalty_type,
        penaltyValue: tier.penalty_value
      })),
      nights: booked.nights.map((night) => ({
        stayDate: night.stay_date,
        nightTotalMinor: night.night_total_minor
      }))
    });

    const refundDueMinor = proof.paidMinor - economics.penaltyMinor;

    if (!Number.isSafeInteger(refundDueMinor) || refundDueMinor < 0) {
      throw new ConflictError("Canonical cancellation refund economics are inconsistent", {
        reservationId: reservation.id,
        paidMinor: proof.paidMinor,
        penaltyMinor: economics.penaltyMinor,
        manualReviewRequired: true
      });
    }

    const decision = await this.cancellations.insertDecision(trx, {
      reservationId: reservation.id,
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      guestUserId: actor.userId,
      quoteId,
      quoteCancellationSnapshotId: booked.snapshot.id,
      quoteCancellationTierSnapshotId: economics.tierSnapshotId,
      paymentIntentId: proof.paymentIntentId,
      paymentEvidenceId: proof.paymentEvidenceId,
      cancelledAt,
      arrivalAt,
      minutesBeforeArrival,
      tierMinimumMinutesBeforeArrival: economics.tierMinimumMinutesBeforeArrival,
      penaltyType: economics.penaltyType,
      penaltyValue: economics.penaltyValue,
      acceptedTotalMinor: reservation.total_minor,
      paidMinor: proof.paidMinor,
      penaltyMinor: economics.penaltyMinor,
      refundDueMinor,
      currencyCode: proof.currencyCode,
      provider: proof.provider,
      providerPaymentId: proof.providerPaymentId,
      request
    });

    if (!decision) {
      throw new ConflictError("Canonical cancellation decision could not be persisted", {
        reservationId: reservation.id,
        manualReviewRequired: true
      });
    }

    await this.inventory.releaseConfirmedAllocation(trx, {
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      reservationId: reservation.id,
      reservationInventoryHoldId: reservation.inventory_hold_id,
      inventoryAllocationId: proof.inventoryAllocationId,
      actorUserId: actor.userId,
      request
    });

    const transitioned = await this.reservations.transitionStatus(
      trx,
      scope.organizationId,
      scope.propertyId,
      reservation.id,
      "CONFIRMED",
      "CANCELLED"
    );

    if (!transitioned) {
      throw new ConflictError("Reservation state changed while applying guest cancellation", {
        reservationId: reservation.id,
        expectedStatus: "CONFIRMED",
        requestedStatus: "CANCELLED"
      });
    }

    await this.reservations.appendStatusHistory(trx, {
      reservationId: reservation.id,
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      fromStatus: "CONFIRMED",
      toStatus: "CANCELLED",
      reason: "GUEST_CANCELLATION",
      actorUserId: actor.userId,
      request
    });

    let refundRequestId: string | null = null;

    if (refundDueMinor > 0) {
      const refund = await this.refundRequests.ensureForCancellationDecision(
        trx,
        decision,
        request
      );

      refundRequestId = refund.refundRequest.id;
    }

    const result: GuestCancellationResult = {
      reservationId: reservation.id,
      status: "CANCELLED",
      cancelledAt: cancelledAt.toISOString(),
      arrivalAt: arrivalAt.toISOString(),
      minutesBeforeArrival,
      penaltyType: economics.penaltyType,
      penaltyMinor: economics.penaltyMinor,
      paidMinor: proof.paidMinor,
      refundDueMinor,
      currencyCode: proof.currencyCode,
      refundRequired: refundDueMinor > 0,
      refundRequestId
    };

    await new AuditService(trx).record({
      actor,
      organizationId: scope.organizationId,
      propertyId: scope.propertyId,
      action: "guest.reservation.cancelled",
      entityType: "reservation",
      entityId: reservation.id,
      before: {
        status: "CONFIRMED"
      },
      after: result,
      reason: "GUEST_CANCELLATION",
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "reservation",
      aggregateId: reservation.id,
      eventType: "reservation.cancelled.v1",
      payload: {
        ...result,
        reservationReference: reservation.reservation_reference,
        actorUserId: actor.userId
      }
    });

    return result;
  }
}
