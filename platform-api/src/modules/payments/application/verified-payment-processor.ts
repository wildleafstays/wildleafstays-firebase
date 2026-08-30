import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import { InventoryAllocationService } from "../../inventory/application/inventory-allocation-service.js";
import { InventoryAllocationRepository } from "../../inventory/infrastructure/inventory-allocation-repository.js";
import { InventoryHoldRepository } from "../../inventory/infrastructure/inventory-hold-repository.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import {
  PaymentProcessingOutcomes,
  PaymentReconciliationActions,
  PaymentReconciliationReasons,
  type PaymentReconciliationAction,
  type PaymentReconciliationReason,
  type ProcessVerifiedPaymentResult
} from "../domain/payment-processing.js";
import type { PaymentIntentStatus } from "../domain/payment.js";
import {
  PaymentEvidenceRepository,
  type PaymentProviderEvidenceRecord
} from "../infrastructure/payment-evidence-repository.js";
import {
  PaymentProcessingRepository,
  type PaymentReconciliationRecord,
  type PaymentSuccessRecord
} from "../infrastructure/payment-processing-repository.js";
import { PaymentRefundRequestService } from "./payment-refund-request-service.js";
import {
  PaymentRepository,
  type PaymentIntentRecord
} from "../infrastructure/payment-repository.js";

interface ProcessInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  providerCapturedAt?: Date;
}

export class VerifiedPaymentProcessor {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly reservations = new ReservationRepository(),
    private readonly payments = new PaymentRepository(),
    private readonly evidence = new PaymentEvidenceRepository(),
    private readonly processing = new PaymentProcessingRepository(),
    private readonly holds = new InventoryHoldRepository(),
    private readonly allocations = new InventoryAllocationRepository(),
    private readonly inventoryAllocations = new InventoryAllocationService(),
    private readonly refundRequests = new PaymentRefundRequestService()
  ) {}

  private result(
    processed: boolean,
    input: ProcessInput,
    success: PaymentSuccessRecord | null,
    reconciliation: PaymentReconciliationRecord | null
  ): ProcessVerifiedPaymentResult {
    return {
      processed,
      outcome:
        reconciliation !== null
          ? PaymentProcessingOutcomes.RECONCILIATION_REQUIRED
          : PaymentProcessingOutcomes.RESERVATION_CONFIRMED,
      paymentIntentId: input.paymentIntentId,
      reservationId: input.reservationId,
      paymentEvidenceId: input.paymentEvidenceId,
      paymentSuccessId: success?.id ?? null,
      inventoryAllocationId: success?.inventory_allocation_id ?? null,
      reconciliationCaseId: reconciliation?.id ?? null
    };
  }

  private async transitionPaymentToSucceeded(
    trx: Transaction<Database>,
    intent: PaymentIntentRecord
  ): Promise<PaymentIntentRecord> {
    if (intent.status === "SUCCEEDED") {
      return intent;
    }

    const transitioned = await this.payments.transitionStatus(
      trx,
      intent.organization_id,
      intent.property_id,
      intent.reservation_id,
      intent.id,
      intent.status as PaymentIntentStatus,
      "SUCCEEDED"
    );
    if (!transitioned) {
      throw new ConflictError("Payment intent state changed while processing verified payment", {
        paymentIntentId: intent.id,
        paymentIntentStatus: intent.status
      });
    }
    return transitioned;
  }

  private async recordPaymentSucceededBoundary(
    trx: Transaction<Database>,
    intentBefore: PaymentIntentRecord,
    intentAfter: PaymentIntentRecord,
    evidence: {
      id: string;
      provider: string;
      provider_payment_id: string;
    },
    success: PaymentSuccessRecord,
    reconciliationRequired: boolean,
    request: RequestMetadata
  ): Promise<void> {
    await new AuditService(trx).record({
      actor: null,
      actorType: "PROVIDER",
      organizationId: intentAfter.organization_id,
      propertyId: intentAfter.property_id,
      action: "payment.succeeded",
      entityType: "payment_intent",
      entityId: intentAfter.id,
      before: { status: intentBefore.status },
      after: {
        status: "SUCCEEDED",
        paymentEvidenceId: evidence.id,
        paymentSuccessId: success.id,
        providerPaymentId: evidence.provider_payment_id,
        reconciliationRequired
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: intentAfter.id,
      eventType: "payment.succeeded.v1",
      payload: {
        paymentIntentId: intentAfter.id,
        reservationId: intentAfter.reservation_id,
        propertyId: intentAfter.property_id,
        paymentEvidenceId: evidence.id,
        paymentSuccessId: success.id,
        providerPaymentId: evidence.provider_payment_id,
        status: "SUCCEEDED",
        reconciliationRequired
      }
    });
  }

  private async createReconciliation(
    trx: Transaction<Database>,
    input: ProcessInput,
    intent: PaymentIntentRecord,
    evidence: PaymentProviderEvidenceRecord,

    reasonCode: PaymentReconciliationReason,
    requiredAction: PaymentReconciliationAction,
    details: JsonObject,
    request: RequestMetadata,
    canonicalSuccess: PaymentSuccessRecord | null
  ): Promise<ProcessVerifiedPaymentResult> {
    const existingCase = await this.processing.findReconciliationByEvidence(trx, evidence.id);
    if (existingCase) {
      if (existingCase.required_action === "REFUND_REQUIRED" && existingCase.status === "OPEN") {
        await this.refundRequests.ensureForReconciliation(
          trx,
          { reconciliation: existingCase, evidence },
          request
        );
      }
      return this.result(false, input, canonicalSuccess, existingCase);
    }

    const created = await this.processing.createReconciliation(trx, {
      paymentIntentId: input.paymentIntentId,
      paymentEvidenceId: evidence.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      reasonCode,
      requiredAction,
      details,
      request
    });

    if (!created) {
      const raced = await this.processing.findReconciliationByEvidence(trx, evidence.id);
      if (!raced) {
        throw new ConflictError("Payment reconciliation case could not be persisted", {
          paymentEvidenceId: evidence.id
        });
      }
      if (raced.required_action === "REFUND_REQUIRED" && raced.status === "OPEN") {
        await this.refundRequests.ensureForReconciliation(
          trx,
          { reconciliation: raced, evidence },
          request
        );
      }
      return this.result(false, input, canonicalSuccess, raced);
    }

    await this.payments.recordEvent(trx, {
      paymentIntentId: intent.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      eventType: "PAYMENT_RECONCILIATION_REQUIRED",
      details: {
        paymentEvidenceId: evidence.id,
        provider: evidence.provider,
        providerEventId: evidence.provider_event_id,
        providerPaymentId: evidence.provider_payment_id,
        providerOrderId: evidence.provider_order_id,
        reasonCode,
        requiredAction,
        reconciliationCaseId: created.id
      },
      actorUserId: null,
      request
    });

    const reconciliationView = this.processing.reconciliationView(created);
    await new AuditService(trx).record({
      actor: null,
      actorType: "PROVIDER",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "payment.reconciliation.required",
      entityType: "payment_reconciliation_case",
      entityId: created.id,
      after: reconciliationView,
      reason: reasonCode,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: intent.id,
      eventType: "payment.reconciliation.required.v1",
      payload: {
        paymentIntentId: intent.id,
        reservationId: input.reservationId,
        paymentEvidenceId: evidence.id,
        reconciliationCaseId: created.id,
        reasonCode,
        requiredAction
      }
    });

    if (created.required_action === "REFUND_REQUIRED") {
      await this.refundRequests.ensureForReconciliation(
        trx,
        { reconciliation: created, evidence },
        request
      );
    }

    return this.result(true, input, canonicalSuccess, created);
  }

  async process(
    trx: Transaction<Database>,
    input: ProcessInput,
    request: RequestMetadata
  ): Promise<ProcessVerifiedPaymentResult> {
    const reservation = await this.reservations.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );
    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    const intent = await this.payments.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.paymentIntentId
    );
    if (!intent) {
      throw new NotFoundError("Payment intent not found");
    }

    const verifiedEvidence = await this.evidence.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.paymentIntentId,
      input.paymentEvidenceId
    );
    if (!verifiedEvidence) {
      throw new NotFoundError("Verified payment evidence not found");
    }

    if (
      verifiedEvidence.amount_minor !== intent.amount_minor ||
      verifiedEvidence.currency_code !== intent.currency_code
    ) {
      throw new ConflictError(
        "Verified payment evidence no longer matches the immutable payment intent economics",
        {
          paymentIntentId: intent.id,
          paymentEvidenceId: verifiedEvidence.id
        }
      );
    }

    const existingSuccess = await this.processing.findSuccessByIntentForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.paymentIntentId
    );

    if (existingSuccess) {
      if (existingSuccess.payment_evidence_id === verifiedEvidence.id) {
        const existingCase = await this.processing.findReconciliationByEvidence(
          trx,
          verifiedEvidence.id
        );
        if (
          existingSuccess.outcome === PaymentProcessingOutcomes.RESERVATION_CONFIRMED &&
          existingCase
        ) {
          throw new ConflictError(
            "Confirmed payment success unexpectedly has a reconciliation case",
            { paymentSuccessId: existingSuccess.id }
          );
        }
        if (
          existingSuccess.outcome === PaymentProcessingOutcomes.RECONCILIATION_REQUIRED &&
          !existingCase
        ) {
          throw new ConflictError(
            "Reconciliation-required payment success has no reconciliation case",
            { paymentSuccessId: existingSuccess.id }
          );
        }
        return this.result(false, input, existingSuccess, existingCase ?? null);
      }

      return this.createReconciliation(
        trx,
        input,
        intent,
        verifiedEvidence,
        PaymentReconciliationReasons.DUPLICATE_VERIFIED_PAYMENT,
        PaymentReconciliationActions.REFUND_REQUIRED,
        {
          canonicalPaymentSuccessId: existingSuccess.id,
          canonicalPaymentEvidenceId: existingSuccess.payment_evidence_id,
          duplicatePaymentEvidenceId: verifiedEvidence.id,
          providerPaymentId: verifiedEvidence.provider_payment_id
        },
        request,
        existingSuccess
      );
    }

    if (intent.status === "SUCCEEDED") {
      throw new ConflictError("Succeeded payment intent has no canonical payment success record", {
        paymentIntentId: intent.id
      });
    }

    if (reservation.status !== "PAYMENT_PENDING") {
      const succeededIntent = await this.transitionPaymentToSucceeded(trx, intent);
      const success = await this.processing.createSuccess(trx, {
        paymentIntentId: input.paymentIntentId,
        paymentEvidenceId: verifiedEvidence.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        outcome: PaymentProcessingOutcomes.RECONCILIATION_REQUIRED,
        inventoryAllocationId: null,
        request
      });
      if (!success) {
        throw new ConflictError("Canonical payment success could not be persisted", {
          paymentIntentId: intent.id
        });
      }

      await this.payments.recordEvent(trx, {
        paymentIntentId: intent.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        eventType: "PAYMENT_SUCCEEDED",
        details: {
          paymentEvidenceId: verifiedEvidence.id,
          provider: verifiedEvidence.provider,
          providerPaymentId: verifiedEvidence.provider_payment_id,
          outcome: PaymentProcessingOutcomes.RECONCILIATION_REQUIRED
        },
        actorUserId: null,
        request
      });

      await this.recordPaymentSucceededBoundary(
        trx,
        intent,
        succeededIntent,
        verifiedEvidence,
        success,
        true,
        request
      );

      return this.createReconciliation(
        trx,
        input,
        succeededIntent,
        verifiedEvidence,
        PaymentReconciliationReasons.RESERVATION_STATE_MISMATCH,
        PaymentReconciliationActions.MANUAL_REVIEW,
        {
          reservationStatus: reservation.status,
          paymentIntentPreviousStatus: intent.status
        },
        request,
        success
      );
    }

    const hold = await this.holds.findHoldForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.inventory_hold_id
    );

    let reconciliationReason: PaymentReconciliationReason | null = null;
    let reconciliationDetails: JsonObject = {};

    if (!hold) {
      reconciliationReason = PaymentReconciliationReasons.INVENTORY_HOLD_UNAVAILABLE;
      reconciliationDetails = {
        inventoryHoldId: reservation.inventory_hold_id,
        reservationStatus: reservation.status
      };
    } else if (hold.status !== "ACTIVE") {
      reconciliationReason = PaymentReconciliationReasons.INVENTORY_HOLD_NOT_ACTIVE;
      reconciliationDetails = {
        inventoryHoldId: hold.id,
        holdStatus: hold.status,
        holdExpiresAt: hold.expires_at.toISOString()
      };
    } else if (
      hold.expires_at <= this.now() &&
      (!input.providerCapturedAt || input.providerCapturedAt > hold.expires_at)
    ) {
      reconciliationReason = PaymentReconciliationReasons.INVENTORY_HOLD_EXPIRED;
      reconciliationDetails = {
        inventoryHoldId: hold.id,
        holdStatus: hold.status,
        holdExpiresAt: hold.expires_at.toISOString()
      };
    }

    if (reconciliationReason) {
      const succeededIntent = await this.transitionPaymentToSucceeded(trx, intent);
      const success = await this.processing.createSuccess(trx, {
        paymentIntentId: input.paymentIntentId,
        paymentEvidenceId: verifiedEvidence.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        outcome: PaymentProcessingOutcomes.RECONCILIATION_REQUIRED,
        inventoryAllocationId: null,
        request
      });
      if (!success) {
        throw new ConflictError("Canonical payment success could not be persisted", {
          paymentIntentId: intent.id
        });
      }

      await this.payments.recordEvent(trx, {
        paymentIntentId: intent.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        eventType: "PAYMENT_SUCCEEDED",
        details: {
          paymentEvidenceId: verifiedEvidence.id,
          provider: verifiedEvidence.provider,
          providerPaymentId: verifiedEvidence.provider_payment_id,
          outcome: PaymentProcessingOutcomes.RECONCILIATION_REQUIRED
        },
        actorUserId: null,
        request
      });

      await this.recordPaymentSucceededBoundary(
        trx,
        intent,
        succeededIntent,
        verifiedEvidence,
        success,
        true,
        request
      );

      return this.createReconciliation(
        trx,
        input,
        succeededIntent,
        verifiedEvidence,
        reconciliationReason,
        PaymentReconciliationActions.REFUND_REQUIRED,
        reconciliationDetails,
        request,
        success
      );
    }

    const existingAllocation = await this.allocations.findByHold(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.inventory_hold_id
    );
    if (existingAllocation) {
      throw new ConflictError(
        "PAYMENT_PENDING reservation unexpectedly already owns a confirmed allocation",
        {
          reservationId: reservation.id,
          inventoryAllocationId: existingAllocation.id
        }
      );
    }

    const allocationResult = await this.inventoryAllocations.confirmReservationHold(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.id,
      reservation.inventory_hold_id,
      reservation.reservation_reference,
      request,
      input.providerCapturedAt
    );

    const succeededIntent = await this.transitionPaymentToSucceeded(trx, intent);
    const confirmedReservation = await this.reservations.transitionStatus(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.id,
      "PAYMENT_PENDING",
      "CONFIRMED"
    );
    if (!confirmedReservation) {
      throw new ConflictError("Reservation state changed while confirming verified payment", {
        reservationId: reservation.id
      });
    }

    const success = await this.processing.createSuccess(trx, {
      paymentIntentId: input.paymentIntentId,
      paymentEvidenceId: verifiedEvidence.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      outcome: PaymentProcessingOutcomes.RESERVATION_CONFIRMED,
      inventoryAllocationId: allocationResult.allocation.id,
      request
    });
    if (!success) {
      throw new ConflictError("Canonical payment success could not be persisted", {
        paymentIntentId: intent.id
      });
    }

    await this.reservations.appendStatusHistory(trx, {
      reservationId: reservation.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      fromStatus: "PAYMENT_PENDING",
      toStatus: "CONFIRMED",
      reason: "VERIFIED_PAYMENT_SUCCEEDED",
      actorUserId: null,
      request
    });

    await this.payments.recordEvent(trx, {
      paymentIntentId: intent.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      eventType: "PAYMENT_SUCCEEDED",
      details: {
        paymentEvidenceId: verifiedEvidence.id,
        provider: verifiedEvidence.provider,
        providerEventId: verifiedEvidence.provider_event_id,
        providerPaymentId: verifiedEvidence.provider_payment_id,
        providerOrderId: verifiedEvidence.provider_order_id,
        inventoryAllocationId: allocationResult.allocation.id,
        outcome: PaymentProcessingOutcomes.RESERVATION_CONFIRMED
      },
      actorUserId: null,
      request
    });

    const audit = new AuditService(trx);
    await audit.record({
      actor: null,
      actorType: "PROVIDER",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "payment.succeeded",
      entityType: "payment_intent",
      entityId: succeededIntent.id,
      before: { status: intent.status },
      after: {
        status: "SUCCEEDED",
        paymentEvidenceId: verifiedEvidence.id,
        paymentSuccessId: success.id,
        providerPaymentId: verifiedEvidence.provider_payment_id
      },
      request
    });

    await audit.record({
      actor: null,
      actorType: "PROVIDER",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "reservation.confirmed",
      entityType: "reservation",
      entityId: reservation.id,
      before: { status: "PAYMENT_PENDING" },
      after: {
        status: "CONFIRMED",
        paymentIntentId: intent.id,
        paymentEvidenceId: verifiedEvidence.id,
        inventoryAllocationId: allocationResult.allocation.id
      },
      reason: "VERIFIED_PAYMENT_SUCCEEDED",
      request
    });

    const outbox = new OutboxService(trx);
    await outbox.enqueue({
      aggregateType: "payment_intent",
      aggregateId: intent.id,
      eventType: "payment.succeeded.v1",
      payload: {
        paymentIntentId: intent.id,
        reservationId: reservation.id,
        propertyId: input.propertyId,
        paymentEvidenceId: verifiedEvidence.id,
        paymentSuccessId: success.id,
        providerPaymentId: verifiedEvidence.provider_payment_id,
        status: "SUCCEEDED"
      }
    });
    await outbox.enqueue({
      aggregateType: "reservation",
      aggregateId: reservation.id,
      eventType: "reservation.confirmed.v1",
      payload: {
        reservationId: reservation.id,
        reservationReference: reservation.reservation_reference,
        propertyId: input.propertyId,
        paymentIntentId: intent.id,
        paymentEvidenceId: verifiedEvidence.id,
        inventoryAllocationId: allocationResult.allocation.id,
        status: "CONFIRMED"
      }
    });

    return this.result(true, input, success, null);
  }
}
