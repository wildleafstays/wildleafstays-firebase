import type { Transaction, Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { PaymentRefundProviderStatus } from "../domain/payment-refund.js";
import {
  PaymentProcessingRepository,
  type PaymentReconciliationRecord
} from "../infrastructure/payment-processing-repository.js";
import {
  PaymentRefundLifecycleRepository,
  type PaymentRefundFinalizationRecord,
  type PaymentRefundProviderEventRecord
} from "../infrastructure/payment-refund-lifecycle-repository.js";
import {
  PaymentRefundRequestRepository,
  type PaymentRefundRequestRecord
} from "../infrastructure/payment-refund-repository.js";
import {
  PaymentRefundSubmissionRepository,
  type PaymentRefundSubmissionRecord
} from "../infrastructure/payment-refund-submission-repository.js";
import { PaymentRepository } from "../infrastructure/payment-repository.js";
import { razorpayRefundIdempotencyKey } from "./razorpay-refund-submission-service.js";

export interface VerifiedRazorpayRefundWebhookInput {
  eventType: "refund.created" | "refund.processed" | "refund.failed";
  root: Record<string, unknown>;
  providerEventId: string;
  payloadSha256: string;
}

export interface RazorpayRefundWebhookResult extends JsonObject {
  paymentIntentId: string;
  paymentEvidenceId: string;
  refundRequestId: string;
  refundSubmissionId: string;
  providerRefundId: string;
  lifecycleEventId: string;
  lifecycleEventCreated: boolean;
  submissionRecovered: boolean;
  finalizationId: string | null;
  finalizationCreated: boolean;
  finalizationStatus: "PROCESSED" | "FAILED" | null;
  reconciliationResolved: boolean;
}

interface ParsedRefundWebhook {
  providerRefundId: string;
  providerPaymentId: string;
  amountMinor: number;
  currencyCode: string;
  providerStatus: PaymentRefundProviderStatus;
  providerRefundCreatedAt: Date;
  providerEventCreatedAt: Date;
  notes: Record<string, unknown>;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maxLength) {
    throw new ValidationError(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function unixTimestamp(value: unknown, field: string): Date {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ValidationError(`${field} must be a positive Unix timestamp`);
  }
  const result = new Date((value as number) * 1000);
  if (Number.isNaN(result.getTime())) {
    throw new ValidationError(`${field} must be a valid Unix timestamp`);
  }
  return result;
}

function providerStatus(value: unknown): PaymentRefundProviderStatus {
  switch (value) {
    case "pending":
      return "PENDING";
    case "processed":
      return "PROCESSED";
    case "failed":
      return "FAILED";
    default:
      throw new ValidationError("refund.status must be pending, processed or failed");
  }
}

function parseRefundWebhook(input: VerifiedRazorpayRefundWebhookInput): ParsedRefundWebhook {
  const payload = record(input.root["payload"], "payload");
  const refundWrapper = record(payload["refund"], "payload.refund");
  const refund = record(refundWrapper["entity"], "payload.refund.entity");

  if (refund["entity"] !== "refund") {
    throw new ValidationError("Razorpay refund webhook must contain a refund entity");
  }

  if (!Number.isSafeInteger(refund["amount"]) || (refund["amount"] as number) <= 0) {
    throw new ValidationError("refund.amount must be a positive safe integer");
  }

  const currencyCode = boundedString(refund["currency"], "refund.currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ValidationError("refund.currency must be a three-letter currency code");
  }

  const status = providerStatus(refund["status"]);
  if (input.eventType === "refund.processed" && status !== "PROCESSED") {
    throw new ValidationError("refund.processed webhook must contain status processed");
  }
  if (input.eventType === "refund.failed" && status !== "FAILED") {
    throw new ValidationError("refund.failed webhook must contain status failed");
  }

  const notesValue = refund["notes"];
  const notes =
    typeof notesValue === "object" && notesValue !== null && !Array.isArray(notesValue)
      ? (notesValue as Record<string, unknown>)
      : {};

  return {
    providerRefundId: boundedString(refund["id"], "refund.id"),
    providerPaymentId: boundedString(refund["payment_id"], "refund.payment_id"),
    amountMinor: refund["amount"] as number,
    currencyCode,
    providerStatus: status,
    providerRefundCreatedAt: unixTimestamp(refund["created_at"], "refund.created_at"),
    providerEventCreatedAt: unixTimestamp(input.root["created_at"], "event.created_at"),
    notes
  };
}

function recoveryAttemptSequence(notes: Record<string, unknown>): number {
  const raw = boundedString(
    notes["refundAttemptSequence"],
    "refund.notes.refundAttemptSequence",
    20
  );
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new ValidationError("refund.notes.refundAttemptSequence must be a positive integer");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError("refund.notes.refundAttemptSequence is not a safe integer");
  }
  return value;
}

export class RazorpayRefundWebhookService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly refunds = new PaymentRefundRequestRepository(),
    private readonly submissions = new PaymentRefundSubmissionRepository(),
    private readonly lifecycle = new PaymentRefundLifecycleRepository(),
    private readonly processing = new PaymentProcessingRepository(),
    private readonly payments = new PaymentRepository()
  ) {}

  private assertSubmission(
    submission: PaymentRefundSubmissionRecord,
    parsed: ParsedRefundWebhook
  ): void {
    if (
      submission.provider !== "RAZORPAY" ||
      submission.provider_refund_id !== parsed.providerRefundId ||
      submission.provider_payment_id !== parsed.providerPaymentId ||
      submission.amount_minor !== parsed.amountMinor ||
      submission.currency_code !== parsed.currencyCode
    ) {
      throw new ConflictError(
        "Razorpay refund webhook does not match the immutable refund submission",
        {
          refundSubmissionId: submission.id,
          providerRefundId: parsed.providerRefundId,
          providerPaymentId: parsed.providerPaymentId,
          amountMinor: parsed.amountMinor,
          currencyCode: parsed.currencyCode
        }
      );
    }
  }

  private assertProviderEvent(
    row: PaymentRefundProviderEventRecord,
    submission: PaymentRefundSubmissionRecord,
    parsed: ParsedRefundWebhook,
    input: VerifiedRazorpayRefundWebhookInput
  ): void {
    if (
      row.refund_submission_id !== submission.id ||
      row.refund_request_id !== submission.refund_request_id ||
      row.payment_intent_id !== submission.payment_intent_id ||
      row.payment_evidence_id !== submission.payment_evidence_id ||
      row.reconciliation_case_id !== submission.reconciliation_case_id ||
      row.organization_id !== submission.organization_id ||
      row.property_id !== submission.property_id ||
      row.reservation_id !== submission.reservation_id ||
      row.provider !== "RAZORPAY" ||
      row.provider_event_id !== input.providerEventId ||
      row.provider_refund_id !== parsed.providerRefundId ||
      row.provider_payment_id !== parsed.providerPaymentId ||
      row.event_type !== input.eventType ||
      row.provider_status !== parsed.providerStatus ||
      row.amount_minor !== parsed.amountMinor ||
      row.currency_code !== parsed.currencyCode ||
      row.payload_sha256 !== input.payloadSha256 ||
      row.provider_refund_created_at.getTime() !== parsed.providerRefundCreatedAt.getTime() ||
      row.provider_event_created_at.getTime() !== parsed.providerEventCreatedAt.getTime()
    ) {
      throw new ConflictError(
        "Razorpay provider event id was reused with different refund evidence",
        {
          providerEventId: input.providerEventId,
          providerRefundId: parsed.providerRefundId
        }
      );
    }
  }

  private assertRefundRequest(
    refund: PaymentRefundRequestRecord,
    parsed: ParsedRefundWebhook,
    notes: Record<string, unknown>
  ): number {
    if (
      refund.provider !== "RAZORPAY" ||
      refund.provider_payment_id !== parsed.providerPaymentId ||
      refund.amount_minor !== parsed.amountMinor ||
      refund.currency_code !== parsed.currencyCode
    ) {
      throw new ConflictError(
        "Razorpay refund recovery evidence does not match the immutable refund request",
        {
          refundRequestId: refund.id,
          providerPaymentId: parsed.providerPaymentId,
          amountMinor: parsed.amountMinor,
          currencyCode: parsed.currencyCode
        }
      );
    }

    const paymentIntentId = boundedString(notes["paymentIntentId"], "refund.notes.paymentIntentId");
    const reconciliationCaseId = boundedString(
      notes["reconciliationCaseId"],
      "refund.notes.reconciliationCaseId"
    );
    if (
      paymentIntentId !== refund.payment_intent_id ||
      reconciliationCaseId !== refund.reconciliation_case_id
    ) {
      throw new ConflictError("Razorpay refund recovery notes do not match the refund request", {
        refundRequestId: refund.id
      });
    }

    return recoveryAttemptSequence(notes);
  }

  private assertReconciliation(
    reconciliation: PaymentReconciliationRecord | undefined,
    submission: PaymentRefundSubmissionRecord
  ): void {
    if (
      !reconciliation ||
      reconciliation.id !== submission.reconciliation_case_id ||
      reconciliation.payment_intent_id !== submission.payment_intent_id ||
      reconciliation.payment_evidence_id !== submission.payment_evidence_id ||
      reconciliation.organization_id !== submission.organization_id ||
      reconciliation.property_id !== submission.property_id ||
      reconciliation.reservation_id !== submission.reservation_id ||
      reconciliation.required_action !== "REFUND_REQUIRED"
    ) {
      throw new ConflictError("Refund lifecycle does not match its reconciliation case", {
        refundSubmissionId: submission.id,
        reconciliationCaseId: submission.reconciliation_case_id
      });
    }
  }

  private async recordRecoveredSubmission(
    trx: Transaction<Database>,
    refund: PaymentRefundRequestRecord,
    submission: PaymentRefundSubmissionRecord,
    request: RequestMetadata
  ): Promise<void> {
    await this.payments.recordEvent(trx, {
      paymentIntentId: refund.payment_intent_id,
      organizationId: refund.organization_id,
      propertyId: refund.property_id,
      reservationId: refund.reservation_id,
      eventType: "REFUND_SUBMITTED",
      details: {
        refundRequestId: refund.id,
        refundSubmissionId: submission.id,
        attemptSequence: submission.attempt_sequence,
        paymentEvidenceId: refund.payment_evidence_id,
        reconciliationCaseId: refund.reconciliation_case_id,
        provider: refund.provider,
        providerPaymentId: refund.provider_payment_id,
        providerRefundId: submission.provider_refund_id,
        amountMinor: refund.amount_minor,
        currencyCode: refund.currency_code,
        initialProviderStatus: submission.initial_provider_status,
        recoveredFromWebhook: true
      },
      actorUserId: null,
      request
    });

    const submissionView = this.submissions.view(submission);
    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      organizationId: refund.organization_id,
      propertyId: refund.property_id,
      action: "payment.refund.submitted",
      entityType: "payment_refund_submission",
      entityId: submission.id,
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

  private async recoverSubmission(
    trx: Transaction<Database>,
    parsed: ParsedRefundWebhook,
    request: RequestMetadata
  ): Promise<{ submission: PaymentRefundSubmissionRecord; recovered: boolean }> {
    const refundRequestId = boundedString(
      parsed.notes["refundRequestId"],
      "refund.notes.refundRequestId"
    );
    const refund = await this.refunds.findByIdForUpdate(trx, refundRequestId);
    if (!refund) {
      throw new NotFoundError("Razorpay refund webhook references an unknown refund request", {
        refundRequestId
      });
    }

    const attemptSequence = this.assertRefundRequest(refund, parsed, parsed.notes);
    const idempotencyKey = razorpayRefundIdempotencyKey(refund.id, attemptSequence);

    const existingAttempt = await this.submissions.findByRefundRequestAttempt(
      trx,
      refund.organization_id,
      refund.property_id,
      refund.reservation_id,
      refund.id,
      attemptSequence
    );
    if (existingAttempt) {
      this.assertSubmission(existingAttempt, parsed);
      return { submission: existingAttempt, recovered: false };
    }

    let submission = await this.submissions.create(trx, {
      refundRequestId: refund.id,
      attemptSequence,
      paymentIntentId: refund.payment_intent_id,
      paymentEvidenceId: refund.payment_evidence_id,
      reconciliationCaseId: refund.reconciliation_case_id,
      organizationId: refund.organization_id,
      propertyId: refund.property_id,
      reservationId: refund.reservation_id,
      provider: refund.provider,
      providerPaymentId: refund.provider_payment_id,
      providerRefundId: parsed.providerRefundId,
      amountMinor: refund.amount_minor,
      currencyCode: refund.currency_code,
      idempotencyKey,
      initialProviderStatus: parsed.providerStatus,
      providerCreatedAt: parsed.providerRefundCreatedAt,
      request
    });
    const created = Boolean(submission);

    if (!submission) {
      submission = await this.submissions.findByProviderRefundForUpdate(
        trx,
        "RAZORPAY",
        parsed.providerRefundId
      );
    }
    if (!submission) {
      submission = await this.submissions.findByRefundRequestAttempt(
        trx,
        refund.organization_id,
        refund.property_id,
        refund.reservation_id,
        refund.id,
        attemptSequence
      );
    }
    if (!submission) {
      throw new ConflictError("Razorpay refund submission recovery could not be persisted", {
        refundRequestId: refund.id,
        providerRefundId: parsed.providerRefundId
      });
    }

    this.assertSubmission(submission, parsed);
    if (
      submission.refund_request_id !== refund.id ||
      submission.attempt_sequence !== attemptSequence ||
      submission.idempotency_key !== idempotencyKey
    ) {
      throw new ConflictError(
        "Recovered refund submission identity does not match provider notes",
        {
          refundRequestId: refund.id,
          providerRefundId: parsed.providerRefundId
        }
      );
    }

    if (created) {
      await this.recordRecoveredSubmission(trx, refund, submission, request);
    }
    return { submission, recovered: created };
  }

  private async finalizationResult(
    trx: Transaction<Database>,
    submission: PaymentRefundSubmissionRecord
  ): Promise<PaymentRefundFinalizationRecord | undefined> {
    return this.lifecycle.findFinalizationBySubmission(trx, submission.id);
  }

  private async recordFinalizationEffects(
    trx: Transaction<Database>,
    submission: PaymentRefundSubmissionRecord,
    finalization: PaymentRefundFinalizationRecord,
    input: VerifiedRazorpayRefundWebhookInput,
    request: RequestMetadata
  ): Promise<boolean> {
    let reconciliationResolved = false;
    const reconciliation = await this.processing.findReconciliationByIdForUpdate(
      trx,
      submission.reconciliation_case_id
    );
    this.assertReconciliation(reconciliation, submission);

    if (finalization.status === "PROCESSED" && reconciliation?.status === "OPEN") {
      const resolved = await this.processing.resolveRefundRequiredReconciliation(trx, {
        reconciliationCaseId: submission.reconciliation_case_id,
        organizationId: submission.organization_id,
        propertyId: submission.property_id,
        reservationId: submission.reservation_id,
        resolvedAt: new Date(),
        resolutionNote: `Razorpay refund processed: ${submission.provider_refund_id}`
      });
      if (!resolved) {
        throw new ConflictError("Refund reconciliation could not be resolved atomically", {
          reconciliationCaseId: submission.reconciliation_case_id
        });
      }
      reconciliationResolved = true;
    }

    await this.payments.recordEvent(trx, {
      paymentIntentId: submission.payment_intent_id,
      organizationId: submission.organization_id,
      propertyId: submission.property_id,
      reservationId: submission.reservation_id,
      eventType: finalization.status === "PROCESSED" ? "REFUND_PROCESSED" : "REFUND_FAILED",
      details: {
        refundRequestId: submission.refund_request_id,
        refundSubmissionId: submission.id,
        attemptSequence: submission.attempt_sequence,
        reconciliationCaseId: submission.reconciliation_case_id,
        provider: submission.provider,
        providerEventId: input.providerEventId,
        providerRefundId: submission.provider_refund_id,
        providerPaymentId: submission.provider_payment_id,
        amountMinor: submission.amount_minor,
        currencyCode: submission.currency_code,
        payloadSha256: input.payloadSha256,
        finalizationStatus: finalization.status
      },
      actorUserId: null,
      request
    });

    const after = {
      id: finalization.id,
      refundSubmissionId: submission.id,
      refundRequestId: submission.refund_request_id,
      providerEventId: finalization.provider_event_id,
      providerRefundId: finalization.provider_refund_id,
      status: finalization.status,
      amountMinor: finalization.amount_minor,
      currencyCode: finalization.currency_code,
      createdAt: finalization.created_at.toISOString()
    };

    const action =
      finalization.status === "PROCESSED" ? "payment.refund.processed" : "payment.refund.failed";
    const eventType =
      finalization.status === "PROCESSED"
        ? "payment.refund.processed.v1"
        : "payment.refund.failed.v1";

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      organizationId: submission.organization_id,
      propertyId: submission.property_id,
      action,
      entityType: "payment_refund_finalization",
      entityId: finalization.id,
      after,
      reason: finalization.status,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: submission.payment_intent_id,
      eventType,
      payload: after
    });

    return reconciliationResolved;
  }

  async handle(
    input: VerifiedRazorpayRefundWebhookInput,
    request: RequestMetadata
  ): Promise<RazorpayRefundWebhookResult> {
    const parsed = parseRefundWebhook(input);

    return this.db.transaction().execute(async (trx) => {
      let submission = await this.submissions.findByProviderRefundForUpdate(
        trx,
        "RAZORPAY",
        parsed.providerRefundId
      );
      let submissionRecovered = false;

      if (!submission) {
        const recovered = await this.recoverSubmission(trx, parsed, request);
        submission = recovered.submission;
        submissionRecovered = recovered.recovered;
      }

      this.assertSubmission(submission, parsed);

      let lifecycleEvent = await this.lifecycle.findEventByProviderEvent(
        trx,
        "RAZORPAY",
        input.providerEventId
      );
      let lifecycleEventCreated = false;

      if (lifecycleEvent) {
        this.assertProviderEvent(lifecycleEvent, submission, parsed, input);
      } else {
        lifecycleEvent = await this.lifecycle.createEvent(trx, {
          refundSubmissionId: submission.id,
          refundRequestId: submission.refund_request_id,
          paymentIntentId: submission.payment_intent_id,
          paymentEvidenceId: submission.payment_evidence_id,
          reconciliationCaseId: submission.reconciliation_case_id,
          organizationId: submission.organization_id,
          propertyId: submission.property_id,
          reservationId: submission.reservation_id,
          provider: "RAZORPAY",
          providerEventId: input.providerEventId,
          providerRefundId: parsed.providerRefundId,
          providerPaymentId: parsed.providerPaymentId,
          eventType: input.eventType,
          providerStatus: parsed.providerStatus,
          amountMinor: parsed.amountMinor,
          currencyCode: parsed.currencyCode,
          payloadSha256: input.payloadSha256,
          providerRefundCreatedAt: parsed.providerRefundCreatedAt,
          providerEventCreatedAt: parsed.providerEventCreatedAt,
          request
        });
        if (lifecycleEvent) lifecycleEventCreated = true;
      }

      if (!lifecycleEvent) {
        lifecycleEvent = await this.lifecycle.findEventByProviderEvent(
          trx,
          "RAZORPAY",
          input.providerEventId
        );
      }
      if (!lifecycleEvent) {
        throw new ConflictError("Razorpay refund provider event could not be persisted", {
          providerEventId: input.providerEventId
        });
      }
      this.assertProviderEvent(lifecycleEvent, submission, parsed, input);

      let finalization = await this.finalizationResult(trx, submission);
      let finalizationCreated = false;
      let reconciliationResolved = false;

      const terminalStatus =
        input.eventType === "refund.processed"
          ? "PROCESSED"
          : input.eventType === "refund.failed"
            ? "FAILED"
            : null;

      if (terminalStatus) {
        if (finalization && finalization.status !== terminalStatus) {
          throw new ConflictError("Razorpay refund has conflicting terminal lifecycle events", {
            refundSubmissionId: submission.id,
            providerRefundId: submission.provider_refund_id,
            existingStatus: finalization.status,
            observedStatus: terminalStatus
          });
        }

        if (!finalization) {
          finalization = await this.lifecycle.createFinalization(trx, {
            refundSubmissionId: submission.id,
            refundRequestId: submission.refund_request_id,
            finalizationEventId: lifecycleEvent.id,
            paymentIntentId: submission.payment_intent_id,
            paymentEvidenceId: submission.payment_evidence_id,
            reconciliationCaseId: submission.reconciliation_case_id,
            organizationId: submission.organization_id,
            propertyId: submission.property_id,
            reservationId: submission.reservation_id,
            provider: "RAZORPAY",
            providerEventId: input.providerEventId,
            providerRefundId: submission.provider_refund_id,
            status: terminalStatus,
            amountMinor: submission.amount_minor,
            currencyCode: submission.currency_code,
            providerEventCreatedAt: parsed.providerEventCreatedAt,
            request
          });
          if (finalization) finalizationCreated = true;
        }

        if (!finalization) {
          finalization = await this.finalizationResult(trx, submission);
        }
        if (!finalization) {
          throw new ConflictError("Razorpay refund finalization could not be persisted", {
            refundSubmissionId: submission.id
          });
        }
        if (finalization.status !== terminalStatus) {
          throw new ConflictError("Razorpay refund has conflicting terminal lifecycle events", {
            refundSubmissionId: submission.id,
            existingStatus: finalization.status,
            observedStatus: terminalStatus
          });
        }

        if (finalizationCreated) {
          reconciliationResolved = await this.recordFinalizationEffects(
            trx,
            submission,
            finalization,
            input,
            request
          );
        }
      }

      return {
        paymentIntentId: submission.payment_intent_id,
        paymentEvidenceId: submission.payment_evidence_id,
        refundRequestId: submission.refund_request_id,
        refundSubmissionId: submission.id,
        providerRefundId: submission.provider_refund_id,
        lifecycleEventId: lifecycleEvent.id,
        lifecycleEventCreated,
        submissionRecovered,
        finalizationId: finalization?.id ?? null,
        finalizationCreated,
        finalizationStatus:
          finalization?.status === "PROCESSED" || finalization?.status === "FAILED"
            ? finalization.status
            : null,
        reconciliationResolved
      };
    });
  }
}
