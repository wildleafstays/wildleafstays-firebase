import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { AppError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type {
  PaymentRefundProviderStatus,
  SubmitRazorpayRefundResult
} from "../domain/payment-refund.js";
import type {
  RazorpayCreateRefundInput,
  RazorpayRefund
} from "../infrastructure/razorpay-provider.js";
import { RazorpayProviderError } from "../infrastructure/razorpay-provider.js";
import {
  PaymentProcessingRepository,
  type PaymentReconciliationRecord
} from "../infrastructure/payment-processing-repository.js";
import { PaymentRefundLifecycleRepository } from "../infrastructure/payment-refund-lifecycle-repository.js";
import {
  PaymentRefundRequestRepository,
  type PaymentRefundRequestRecord
} from "../infrastructure/payment-refund-repository.js";
import {
  PaymentRefundSubmissionRepository,
  type PaymentRefundSubmissionRecord
} from "../infrastructure/payment-refund-submission-repository.js";
import { PaymentRepository } from "../infrastructure/payment-repository.js";

export interface RazorpayRefundGateway {
  createRefund(input: RazorpayCreateRefundInput): Promise<RazorpayRefund>;
}

interface SubmitInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  refundRequestId: string;
}

export function razorpayRefundIdempotencyKey(
  refundRequestId: string,
  attemptSequence: number
): string {
  const compact = refundRequestId.replaceAll("-", "");
  const key = `wl_refund_${compact}_${attemptSequence}`;
  if (!/^wl_refund_[A-Fa-f0-9]{32}_[1-9][0-9]*$/.test(key) || key.length > 200) {
    throw new ConflictError("Refund request cannot be represented as a Razorpay idempotency key", {
      refundRequestId,
      attemptSequence
    });
  }
  return key;
}

function providerStatus(status: RazorpayRefund["status"]): PaymentRefundProviderStatus {
  switch (status) {
    case "pending":
      return "PENDING";
    case "processed":
      return "PROCESSED";
    case "failed":
      return "FAILED";
  }
}

export class RazorpayRefundSubmissionService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly provider: RazorpayRefundGateway,
    private readonly refunds = new PaymentRefundRequestRepository(),
    private readonly submissions = new PaymentRefundSubmissionRepository(),
    private readonly processing = new PaymentProcessingRepository(),
    private readonly lifecycle = new PaymentRefundLifecycleRepository(),
    private readonly payments = new PaymentRepository()
  ) {}

  private assertRequest(refund: PaymentRefundRequestRecord): void {
    if (refund.provider !== "RAZORPAY") {
      throw new ConflictError("Refund request is not assigned to Razorpay", {
        refundRequestId: refund.id,
        provider: refund.provider
      });
    }
    if (!Number.isSafeInteger(refund.amount_minor) || refund.amount_minor <= 0) {
      throw new ConflictError("Refund request amount is not valid for provider submission", {
        refundRequestId: refund.id,
        amountMinor: refund.amount_minor
      });
    }
    if (!/^[A-Z]{3}$/.test(refund.currency_code)) {
      throw new ConflictError("Refund request currency is not valid for provider submission", {
        refundRequestId: refund.id,
        currencyCode: refund.currency_code
      });
    }
    if (
      refund.provider_payment_id.trim().length < 1 ||
      refund.provider_payment_id.trim().length > 200
    ) {
      throw new ConflictError("Refund request provider payment id is invalid", {
        refundRequestId: refund.id
      });
    }
  }

  private assertOpenReconciliation(
    reconciliation: PaymentReconciliationRecord | undefined,
    refund: PaymentRefundRequestRecord
  ): void {
    if (
      !reconciliation ||
      reconciliation.id !== refund.reconciliation_case_id ||
      reconciliation.payment_intent_id !== refund.payment_intent_id ||
      reconciliation.payment_evidence_id !== refund.payment_evidence_id ||
      reconciliation.organization_id !== refund.organization_id ||
      reconciliation.property_id !== refund.property_id ||
      reconciliation.reservation_id !== refund.reservation_id ||
      reconciliation.required_action !== "REFUND_REQUIRED" ||
      reconciliation.status !== "OPEN"
    ) {
      throw new ConflictError("Refund request is not backed by an open refund reconciliation", {
        refundRequestId: refund.id,
        reconciliationCaseId: refund.reconciliation_case_id,
        reconciliationStatus: reconciliation?.status ?? null,
        requiredAction: reconciliation?.required_action ?? null
      });
    }
  }

  private assertStoredSubmission(
    row: PaymentRefundSubmissionRecord,
    refund: PaymentRefundRequestRecord,
    attemptSequence: number,
    idempotencyKey: string
  ): void {
    if (
      row.refund_request_id !== refund.id ||
      row.attempt_sequence !== attemptSequence ||
      row.payment_intent_id !== refund.payment_intent_id ||
      row.payment_evidence_id !== refund.payment_evidence_id ||
      row.reconciliation_case_id !== refund.reconciliation_case_id ||
      row.organization_id !== refund.organization_id ||
      row.property_id !== refund.property_id ||
      row.reservation_id !== refund.reservation_id ||
      row.provider !== refund.provider ||
      row.provider_payment_id !== refund.provider_payment_id ||
      row.amount_minor !== refund.amount_minor ||
      row.currency_code !== refund.currency_code ||
      row.idempotency_key !== idempotencyKey
    ) {
      throw new ConflictError(
        "Stored refund submission does not match the immutable refund request",
        {
          refundRequestId: refund.id,
          refundSubmissionId: row.id
        }
      );
    }
  }

  private assertProviderRefund(
    providerRefund: RazorpayRefund,
    refund: PaymentRefundRequestRecord
  ): void {
    if (
      providerRefund.paymentId !== refund.provider_payment_id ||
      providerRefund.amount !== refund.amount_minor ||
      (providerRefund.currency.length > 0 && providerRefund.currency !== refund.currency_code)
    ) {
      throw new ConflictError("Razorpay refund does not match the immutable refund request", {
        refundRequestId: refund.id,
        providerRefundId: providerRefund.id,
        expectedProviderPaymentId: refund.provider_payment_id,
        providerPaymentId: providerRefund.paymentId,
        expectedAmountMinor: refund.amount_minor,
        providerAmountMinor: providerRefund.amount,
        expectedCurrencyCode: refund.currency_code,
        providerCurrencyCode: providerRefund.currency
      });
    }
  }

  private providerCreatedAt(providerRefund: RazorpayRefund): Date {
    if (!Number.isSafeInteger(providerRefund.createdAt) || providerRefund.createdAt <= 0) {
      throw new ConflictError("Razorpay refund has an invalid creation timestamp", {
        providerRefundId: providerRefund.id,
        createdAt: providerRefund.createdAt
      });
    }
    const createdAt = new Date(providerRefund.createdAt * 1000);
    if (Number.isNaN(createdAt.getTime())) {
      throw new ConflictError("Razorpay refund has an invalid creation timestamp", {
        providerRefundId: providerRefund.id
      });
    }
    return createdAt;
  }

  private providerFailure(error: unknown): never {
    if (error instanceof RazorpayProviderError) {
      throw new AppError("PAYMENT_PROVIDER_ERROR", 502, "Razorpay refund submission failed", {
        provider: "RAZORPAY",
        providerStatusCode: error.statusCode
      });
    }
    throw error;
  }

  async submit(
    input: SubmitInput,
    request: RequestMetadata,
    actor: ActorContext | null = null
  ): Promise<SubmitRazorpayRefundResult> {
    const initial = await this.db.transaction().execute(async (trx) => {
      const refund = await this.refunds.findById(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.refundRequestId
      );
      if (!refund) throw new NotFoundError("Refund request not found");
      this.assertRequest(refund);

      const latest = await this.submissions.findLatestByRefundRequestForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        refund.id
      );

      if (latest) {
        const expectedIdempotency = razorpayRefundIdempotencyKey(
          refund.id,
          latest.attempt_sequence
        );
        this.assertStoredSubmission(latest, refund, latest.attempt_sequence, expectedIdempotency);

        const finalization = await this.lifecycle.findFinalizationBySubmission(trx, latest.id);
        if (!finalization || finalization.status !== "FAILED") {
          return {
            refund,
            attemptSequence: latest.attempt_sequence,
            idempotencyKey: expectedIdempotency,
            existing: latest,
            submitToProvider: false
          };
        }
      }

      const reconciliation = await this.processing.findReconciliationByIdForUpdate(
        trx,
        refund.reconciliation_case_id
      );
      this.assertOpenReconciliation(reconciliation, refund);

      const attemptSequence = latest ? latest.attempt_sequence + 1 : 1;
      if (!Number.isSafeInteger(attemptSequence) || attemptSequence <= 0) {
        throw new ConflictError("Refund attempt sequence is no longer safe to increment", {
          refundRequestId: refund.id
        });
      }
      const idempotencyKey = razorpayRefundIdempotencyKey(refund.id, attemptSequence);

      return {
        refund,
        attemptSequence,
        idempotencyKey,
        existing: null,
        submitToProvider: true
      };
    });

    if (!initial.submitToProvider && initial.existing) {
      return {
        created: false,
        submission: this.submissions.view(initial.existing)
      };
    }

    let providerRefund: RazorpayRefund;
    try {
      providerRefund = await this.provider.createRefund({
        providerPaymentId: initial.refund.provider_payment_id,
        amountMinor: initial.refund.amount_minor,
        idempotencyKey: initial.idempotencyKey,
        notes: {
          refundRequestId: initial.refund.id,
          paymentIntentId: initial.refund.payment_intent_id,
          reconciliationCaseId: initial.refund.reconciliation_case_id,
          reasonCode: initial.refund.reason_code,
          refundAttemptSequence: String(initial.attemptSequence)
        }
      });
    } catch (error) {
      return this.providerFailure(error);
    }

    this.assertProviderRefund(providerRefund, initial.refund);
    const providerCreatedAt = this.providerCreatedAt(providerRefund);
    const initialProviderStatus = providerStatus(providerRefund.status);

    return this.db.transaction().execute(async (trx) => {
      const refund = await this.refunds.findById(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.refundRequestId
      );
      if (!refund) throw new NotFoundError("Refund request not found");
      this.assertRequest(refund);

      const idempotencyKey = razorpayRefundIdempotencyKey(refund.id, initial.attemptSequence);
      if (idempotencyKey !== initial.idempotencyKey) {
        throw new ConflictError("Refund idempotency identity changed during provider submission", {
          refundRequestId: refund.id
        });
      }
      this.assertProviderRefund(providerRefund, refund);

      let stored = await this.submissions.findByRefundRequestAttempt(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        refund.id,
        initial.attemptSequence
      );
      let created = false;

      if (!stored) {
        stored = await this.submissions.create(trx, {
          refundRequestId: refund.id,
          attemptSequence: initial.attemptSequence,
          paymentIntentId: refund.payment_intent_id,
          paymentEvidenceId: refund.payment_evidence_id,
          reconciliationCaseId: refund.reconciliation_case_id,
          organizationId: refund.organization_id,
          propertyId: refund.property_id,
          reservationId: refund.reservation_id,
          provider: refund.provider,
          providerPaymentId: refund.provider_payment_id,
          providerRefundId: providerRefund.id,
          amountMinor: refund.amount_minor,
          currencyCode: refund.currency_code,
          idempotencyKey,
          initialProviderStatus,
          providerCreatedAt,
          request
        });
        if (stored) created = true;
      }

      if (!stored) {
        stored = await this.submissions.findByRefundRequestAttempt(
          trx,
          input.organizationId,
          input.propertyId,
          input.reservationId,
          refund.id,
          initial.attemptSequence
        );
      }
      if (!stored) {
        throw new ConflictError("Razorpay refund submission could not be persisted", {
          refundRequestId: refund.id,
          providerRefundId: providerRefund.id
        });
      }

      this.assertStoredSubmission(stored, refund, initial.attemptSequence, idempotencyKey);
      if (stored.provider_refund_id !== providerRefund.id) {
        throw new ConflictError(
          "Refund request attempt is already linked to a different Razorpay refund",
          {
            refundRequestId: refund.id,
            attemptSequence: initial.attemptSequence,
            existingProviderRefundId: stored.provider_refund_id,
            observedProviderRefundId: providerRefund.id
          }
        );
      }

      if (created) {
        await this.payments.recordEvent(trx, {
          paymentIntentId: refund.payment_intent_id,
          organizationId: refund.organization_id,
          propertyId: refund.property_id,
          reservationId: refund.reservation_id,
          eventType: "REFUND_SUBMITTED",
          details: {
            refundRequestId: refund.id,
            refundSubmissionId: stored.id,
            attemptSequence: stored.attempt_sequence,
            paymentEvidenceId: refund.payment_evidence_id,
            reconciliationCaseId: refund.reconciliation_case_id,
            provider: refund.provider,
            providerPaymentId: refund.provider_payment_id,
            providerRefundId: stored.provider_refund_id,
            amountMinor: refund.amount_minor,
            currencyCode: refund.currency_code,
            initialProviderStatus: stored.initial_provider_status,
            recoveredFromWebhook: false
          },
          actorUserId: actor?.userId ?? null,
          request
        });

        const submissionView = this.submissions.view(stored);

        await new AuditService(trx).record({
          actor,
          organizationId: refund.organization_id,
          propertyId: refund.property_id,
          action: "payment.refund.submitted",
          entityType: "payment_refund_submission",
          entityId: stored.id,
          after: submissionView,
          reason: refund.reason_code,
          request
        });

        await new OutboxService(trx).enqueue({
          aggregateType: "payment_intent",
          aggregateId: refund.payment_intent_id,
          eventType: "payment.refund.submitted.v1",
          payload: submissionView
        });
      }

      return {
        created,
        submission: this.submissions.view(stored)
      };
    });
  }
}
