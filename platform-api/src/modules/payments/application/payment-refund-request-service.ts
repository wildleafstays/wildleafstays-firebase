import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { GuestCancellationDecisionRecord } from "../../guest/infrastructure/guest-cancellation-repository.js";
import {
  PaymentRefundSources,
  type EnsurePaymentRefundRequestResult
} from "../domain/payment-refund.js";
import type { PaymentProviderEvidenceRecord } from "../infrastructure/payment-evidence-repository.js";
import type { PaymentReconciliationRecord } from "../infrastructure/payment-processing-repository.js";
import {
  PaymentRefundRequestRepository,
  type PaymentRefundRequestRecord
} from "../infrastructure/payment-refund-repository.js";
import { PaymentRepository } from "../infrastructure/payment-repository.js";

function assertSameReconciliation(
  existing: PaymentRefundRequestRecord,
  reconciliation: PaymentReconciliationRecord,
  evidence: PaymentProviderEvidenceRecord
): void {
  if (
    existing.refund_source !== PaymentRefundSources.RECONCILIATION ||
    existing.reconciliation_case_id !== reconciliation.id ||
    existing.cancellation_decision_id !== null ||
    existing.payment_intent_id !== reconciliation.payment_intent_id ||
    existing.payment_evidence_id !== evidence.id ||
    existing.organization_id !== reconciliation.organization_id ||
    existing.property_id !== reconciliation.property_id ||
    existing.reservation_id !== reconciliation.reservation_id ||
    existing.provider !== evidence.provider ||
    existing.provider_payment_id !== evidence.provider_payment_id ||
    existing.amount_minor !== evidence.amount_minor ||
    existing.currency_code !== evidence.currency_code ||
    existing.reason_code !== reconciliation.reason_code
  ) {
    throw new ConflictError(
      "Existing refund request does not match immutable reconciliation and payment evidence",
      {
        reconciliationCaseId: reconciliation.id,
        paymentEvidenceId: evidence.id,
        refundRequestId: existing.id
      }
    );
  }
}

function assertSameCancellation(
  existing: PaymentRefundRequestRecord,
  decision: GuestCancellationDecisionRecord
): void {
  if (
    existing.refund_source !== PaymentRefundSources.RESERVATION_CANCELLATION ||
    existing.reconciliation_case_id !== null ||
    existing.cancellation_decision_id !== decision.id ||
    existing.payment_intent_id !== decision.payment_intent_id ||
    existing.payment_evidence_id !== decision.payment_evidence_id ||
    existing.organization_id !== decision.organization_id ||
    existing.property_id !== decision.property_id ||
    existing.reservation_id !== decision.reservation_id ||
    existing.provider !== decision.provider ||
    existing.provider_payment_id !== decision.provider_payment_id ||
    existing.amount_minor !== decision.refund_due_minor ||
    existing.currency_code !== decision.currency_code ||
    existing.reason_code !== "RESERVATION_CANCELLATION"
  ) {
    throw new ConflictError(
      "Existing cancellation refund request does not match immutable cancellation decision",
      {
        cancellationDecisionId: decision.id,
        refundRequestId: existing.id
      }
    );
  }
}

export class PaymentRefundRequestService {
  constructor(
    private readonly refunds = new PaymentRefundRequestRepository(),
    private readonly payments = new PaymentRepository()
  ) {}

  async ensureForReconciliation(
    trx: Transaction<Database>,
    input: {
      reconciliation: PaymentReconciliationRecord;
      evidence: PaymentProviderEvidenceRecord;
    },
    request: RequestMetadata
  ): Promise<EnsurePaymentRefundRequestResult> {
    const { reconciliation, evidence } = input;

    if (reconciliation.required_action !== "REFUND_REQUIRED") {
      throw new ConflictError("Reconciliation does not require a refund", {
        reconciliationCaseId: reconciliation.id,
        requiredAction: reconciliation.required_action
      });
    }

    if (reconciliation.status !== "OPEN") {
      throw new ConflictError("Resolved reconciliation cannot create a refund request", {
        reconciliationCaseId: reconciliation.id,
        reconciliationStatus: reconciliation.status
      });
    }

    if (
      reconciliation.payment_evidence_id !== evidence.id ||
      reconciliation.payment_intent_id !== evidence.payment_intent_id ||
      reconciliation.organization_id !== evidence.organization_id ||
      reconciliation.property_id !== evidence.property_id ||
      reconciliation.reservation_id !== evidence.reservation_id
    ) {
      throw new ConflictError("Reconciliation and verified payment evidence do not match", {
        reconciliationCaseId: reconciliation.id,
        paymentEvidenceId: evidence.id
      });
    }

    if (!Number.isSafeInteger(evidence.amount_minor) || evidence.amount_minor <= 0) {
      throw new ConflictError("Refund request requires a positive verified payment amount", {
        reconciliationCaseId: reconciliation.id,
        paymentEvidenceId: evidence.id,
        amountMinor: evidence.amount_minor
      });
    }

    const existing = await this.refunds.findByReconciliationCase(
      trx,
      reconciliation.organization_id,
      reconciliation.property_id,
      reconciliation.reservation_id,
      reconciliation.id
    );

    if (existing) {
      assertSameReconciliation(existing, reconciliation, evidence);

      return {
        created: false,
        refundRequest: this.refunds.view(existing)
      };
    }

    const created = await this.refunds.create(trx, {
      paymentIntentId: reconciliation.payment_intent_id,
      paymentEvidenceId: evidence.id,
      reconciliationCaseId: reconciliation.id,
      organizationId: reconciliation.organization_id,
      propertyId: reconciliation.property_id,
      reservationId: reconciliation.reservation_id,
      provider: evidence.provider,
      providerPaymentId: evidence.provider_payment_id,
      amountMinor: evidence.amount_minor,
      currencyCode: evidence.currency_code,
      reasonCode: reconciliation.reason_code,
      request
    });

    if (!created) {
      const raced = await this.refunds.findByReconciliationCase(
        trx,
        reconciliation.organization_id,
        reconciliation.property_id,
        reconciliation.reservation_id,
        reconciliation.id
      );

      if (!raced) {
        throw new ConflictError("Canonical refund request could not be persisted", {
          reconciliationCaseId: reconciliation.id
        });
      }

      assertSameReconciliation(raced, reconciliation, evidence);

      return {
        created: false,
        refundRequest: this.refunds.view(raced)
      };
    }

    await this.payments.recordEvent(trx, {
      paymentIntentId: reconciliation.payment_intent_id,
      organizationId: reconciliation.organization_id,
      propertyId: reconciliation.property_id,
      reservationId: reconciliation.reservation_id,
      eventType: "REFUND_REQUESTED",
      details: {
        refundRequestId: created.id,
        refundSource: PaymentRefundSources.RECONCILIATION,
        paymentEvidenceId: evidence.id,
        reconciliationCaseId: reconciliation.id,
        provider: evidence.provider,
        providerPaymentId: evidence.provider_payment_id,
        amountMinor: evidence.amount_minor,
        currencyCode: evidence.currency_code,
        reasonCode: reconciliation.reason_code
      },
      actorUserId: null,
      request
    });

    const refundView = this.refunds.view(created);

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      organizationId: reconciliation.organization_id,
      propertyId: reconciliation.property_id,
      action: "payment.refund.requested",
      entityType: "payment_refund_request",
      entityId: created.id,
      after: refundView,
      reason: reconciliation.reason_code,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: reconciliation.payment_intent_id,
      eventType: "payment.refund.requested.v1",
      payload: refundView
    });

    return {
      created: true,
      refundRequest: refundView
    };
  }

  async ensureForCancellationDecision(
    trx: Transaction<Database>,
    decision: GuestCancellationDecisionRecord,
    request: RequestMetadata
  ): Promise<EnsurePaymentRefundRequestResult> {
    if (!Number.isSafeInteger(decision.refund_due_minor) || decision.refund_due_minor <= 0) {
      throw new ConflictError("Cancellation refund obligation requires a positive refund due", {
        cancellationDecisionId: decision.id,
        refundDueMinor: decision.refund_due_minor
      });
    }

    const existing = await this.refunds.findByCancellationDecision(
      trx,
      decision.organization_id,
      decision.property_id,
      decision.reservation_id,
      decision.id
    );

    if (existing) {
      assertSameCancellation(existing, decision);

      return {
        created: false,
        refundRequest: this.refunds.view(existing)
      };
    }

    const created = await this.refunds.createForCancellation(trx, {
      cancellationDecisionId: decision.id,
      paymentIntentId: decision.payment_intent_id,
      paymentEvidenceId: decision.payment_evidence_id,
      organizationId: decision.organization_id,
      propertyId: decision.property_id,
      reservationId: decision.reservation_id,
      provider: decision.provider,
      providerPaymentId: decision.provider_payment_id,
      amountMinor: decision.refund_due_minor,
      currencyCode: decision.currency_code,
      request
    });

    if (!created) {
      const raced = await this.refunds.findByCancellationDecision(
        trx,
        decision.organization_id,
        decision.property_id,
        decision.reservation_id,
        decision.id
      );

      if (!raced) {
        throw new ConflictError("Canonical cancellation refund request could not be persisted", {
          cancellationDecisionId: decision.id
        });
      }

      assertSameCancellation(raced, decision);

      return {
        created: false,
        refundRequest: this.refunds.view(raced)
      };
    }

    await this.payments.recordEvent(trx, {
      paymentIntentId: decision.payment_intent_id,
      organizationId: decision.organization_id,
      propertyId: decision.property_id,
      reservationId: decision.reservation_id,
      eventType: "REFUND_REQUESTED",
      details: {
        refundRequestId: created.id,
        refundSource: PaymentRefundSources.RESERVATION_CANCELLATION,
        cancellationDecisionId: decision.id,
        paymentEvidenceId: decision.payment_evidence_id,
        provider: decision.provider,
        providerPaymentId: decision.provider_payment_id,
        amountMinor: decision.refund_due_minor,
        currencyCode: decision.currency_code,
        reasonCode: "RESERVATION_CANCELLATION"
      },
      actorUserId: null,
      request
    });

    const refundView = this.refunds.view(created);

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      organizationId: decision.organization_id,
      propertyId: decision.property_id,
      action: "payment.refund.requested",
      entityType: "payment_refund_request",
      entityId: created.id,
      after: refundView,
      reason: "RESERVATION_CANCELLATION",
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: decision.payment_intent_id,
      eventType: "payment.refund.requested.v1",
      payload: refundView
    });

    return {
      created: true,
      refundRequest: refundView
    };
  }
}
