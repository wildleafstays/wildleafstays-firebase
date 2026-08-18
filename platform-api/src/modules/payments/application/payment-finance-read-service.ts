import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type {
  FinancePaymentEvidenceView,
  FinancePaymentEventView,
  FinancePaymentIntentView,
  FinancePaymentSuccessView,
  FinanceProviderOrderView,
  FinanceReconciliationView,
  FinanceRefundFinalizationView,
  FinanceRefundProviderEventView,
  FinanceRefundRequestView,
  FinanceRefundState,
  FinanceRefundSubmissionView,
  FinanceReservationSummary,
  ReconciliationDetailResult,
  ReconciliationQueueResult,
  ReservationPaymentHistoryResult
} from "../domain/payment-finance-read.js";
import {
  PaymentFinanceReadRepository,
  type FinancePaymentEvidenceRecord,
  type FinancePaymentEventRecord,
  type FinancePaymentIntentRecord,
  type FinancePaymentSuccessRecord,
  type FinanceProviderOrderRecord,
  type FinanceReconciliationRecord,
  type FinanceRefundFinalizationRecord,
  type FinanceRefundProviderEventRecord,
  type FinanceRefundRequestRecord,
  type FinanceRefundSubmissionRecord,
  type FinanceReservationRecord,
  type ReconciliationListCursor,
  type ReconciliationListFilters
} from "../infrastructure/payment-finance-read-repository.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ReconciliationListInput extends ReconciliationListFilters {
  limit?: number;
  cursor?: string | null;
}

function reservationView(row: FinanceReservationRecord): FinanceReservationSummary {
  return {
    id: row.id,
    reservationReference: row.reservation_reference,
    status: row.status,
    arrivalDate: row.arrival_date,
    departureDate: row.departure_date,
    totalMinor: row.total_minor,
    currencyCode: row.currency_code
  };
}

function intentView(row: FinancePaymentIntentRecord): FinancePaymentIntentView {
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    purpose: row.purpose,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

function providerOrderView(row: FinanceProviderOrderRecord): FinanceProviderOrderView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    receipt: row.receipt,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    providerCreatedAt: row.provider_created_at.toISOString(),
    linkedAt: row.created_at.toISOString()
  };
}

function evidenceView(row: FinancePaymentEvidenceRecord): FinancePaymentEvidenceView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerPaymentId: row.provider_payment_id,
    providerOrderId: row.provider_order_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    verificationMethod: row.verification_method,
    receivedAt: row.received_at.toISOString()
  };
}

function successView(row: FinancePaymentSuccessRecord): FinancePaymentSuccessView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    outcome: row.outcome,
    inventoryAllocationId: row.inventory_allocation_id,
    createdAt: row.created_at.toISOString()
  };
}

function reconciliationView(row: FinanceReconciliationRecord): FinanceReconciliationView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    reservationId: row.reservation_id,
    reasonCode: row.reason_code,
    requiredAction: row.required_action,
    status: row.status,
    details: row.details_json,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolutionNote: row.resolution_note
  };
}

function refundRequestView(row: FinanceRefundRequestRecord): FinanceRefundRequestView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    reconciliationCaseId: row.reconciliation_case_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    reasonCode: row.reason_code,
    createdAt: row.created_at.toISOString()
  };
}

function refundSubmissionView(row: FinanceRefundSubmissionRecord): FinanceRefundSubmissionView {
  return {
    id: row.id,
    refundRequestId: row.refund_request_id,
    attemptSequence: row.attempt_sequence,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    reconciliationCaseId: row.reconciliation_case_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    providerRefundId: row.provider_refund_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    initialProviderStatus: row.initial_provider_status,
    providerCreatedAt: row.provider_created_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

function refundProviderEventView(
  row: FinanceRefundProviderEventRecord
): FinanceRefundProviderEventView {
  return {
    id: row.id,
    refundSubmissionId: row.refund_submission_id,
    refundRequestId: row.refund_request_id,
    reconciliationCaseId: row.reconciliation_case_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerRefundId: row.provider_refund_id,
    providerPaymentId: row.provider_payment_id,
    eventType: row.event_type,
    providerStatus: row.provider_status,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    providerRefundCreatedAt: row.provider_refund_created_at.toISOString(),
    providerEventCreatedAt: row.provider_event_created_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

function refundFinalizationView(
  row: FinanceRefundFinalizationRecord
): FinanceRefundFinalizationView {
  return {
    id: row.id,
    refundSubmissionId: row.refund_submission_id,
    refundRequestId: row.refund_request_id,
    reconciliationCaseId: row.reconciliation_case_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerRefundId: row.provider_refund_id,
    status: row.status,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    providerEventCreatedAt: row.provider_event_created_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

function paymentEventView(row: FinancePaymentEventRecord): FinancePaymentEventView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at.toISOString()
  };
}

function encodeCursor(row: FinanceReconciliationRecord): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.created_at.toISOString(),
      id: row.id
    }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string | null | undefined): ReconciliationListCursor | null {
  if (!value) return null;
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError("Invalid reconciliation cursor");
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (
      typeof decoded.createdAt !== "string" ||
      typeof decoded.id !== "string" ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("invalid cursor shape");
    }
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== decoded.createdAt) {
      throw new Error("invalid cursor timestamp");
    }
    return { createdAt, id: decoded.id };
  } catch {
    throw new ValidationError("Invalid reconciliation cursor");
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new ValidationError(`limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return limit;
}

function latestSubmission(
  submissions: FinanceRefundSubmissionRecord[]
): FinanceRefundSubmissionRecord | null {
  let latest: FinanceRefundSubmissionRecord | null = null;
  for (const submission of submissions) {
    if (!latest || submission.attempt_sequence > latest.attempt_sequence) latest = submission;
  }
  return latest;
}

function refundState(
  reconciliation: FinanceReconciliationRecord,
  request: FinanceRefundRequestRecord | null,
  submission: FinanceRefundSubmissionRecord | null,
  finalization: FinanceRefundFinalizationRecord | null
): FinanceRefundState {
  if (reconciliation.required_action !== "REFUND_REQUIRED") return "NOT_APPLICABLE";
  if (!request) return "MISSING_REQUEST";
  if (!submission) return "REQUESTED";
  if (!finalization) return "SUBMITTED";
  return finalization.status === "PROCESSED" ? "PROCESSED" : "FAILED";
}

export class PaymentFinanceReadService {
  constructor(
    private readonly repository = new PaymentFinanceReadRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private authorize(actor: ActorContext, organizationId: string, propertyId: string): void {
    this.authorization.assert(actor, Permissions.FINANCE_READ, {
      kind: "property",
      organizationId,
      propertyId
    });
  }

  async getReservationPaymentHistory(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    }
  ): Promise<ReservationPaymentHistoryResult> {
    this.authorize(actor, input.organizationId, input.propertyId);

    const reservation = await this.repository.findReservation(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );
    if (!reservation) throw new NotFoundError("Reservation not found");

    const [
      paymentIntents,
      providerOrders,
      verifiedPayments,
      paymentSuccesses,
      reconciliations,
      refundRequests,
      refundSubmissions,
      refundProviderEvents,
      refundFinalizations,
      paymentEvents
    ] = await Promise.all([
      this.repository.listPaymentIntentsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listProviderOrdersByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listPaymentEvidenceByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listPaymentSuccessesByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listReconciliationsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listRefundRequestsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listRefundSubmissionsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listRefundProviderEventsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listRefundFinalizationsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      ),
      this.repository.listPaymentEventsByReservation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      )
    ]);

    return {
      reservation: reservationView(reservation),
      paymentIntents: paymentIntents.map(intentView),
      providerOrders: providerOrders.map(providerOrderView),
      verifiedPayments: verifiedPayments.map(evidenceView),
      paymentSuccesses: paymentSuccesses.map(successView),
      reconciliations: reconciliations.map(reconciliationView),
      refundRequests: refundRequests.map(refundRequestView),
      refundSubmissions: refundSubmissions.map(refundSubmissionView),
      refundProviderEvents: refundProviderEvents.map(refundProviderEventView),
      refundFinalizations: refundFinalizations.map(refundFinalizationView),
      paymentEvents: paymentEvents.map(paymentEventView)
    };
  }

  async listReconciliations(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      filters: ReconciliationListInput;
    }
  ): Promise<ReconciliationQueueResult> {
    this.authorize(actor, input.organizationId, input.propertyId);
    const limit = normalizeLimit(input.filters.limit);
    const cursor = decodeCursor(input.filters.cursor);

    const filters: ReconciliationListFilters = {};
    if (input.filters.status) filters.status = input.filters.status;
    if (input.filters.requiredAction) filters.requiredAction = input.filters.requiredAction;
    if (input.filters.reasonCode) filters.reasonCode = input.filters.reasonCode;

    const rows = await this.repository.listReconciliations(
      trx,
      input.organizationId,
      input.propertyId,
      filters,
      cursor,
      limit + 1
    );

    const pageRows = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const reconciliationIds = pageRows.map((row) => row.id);
    const evidenceIds = pageRows.map((row) => row.payment_evidence_id);

    const [refundRequests, evidenceRows] = await Promise.all([
      this.repository.listRefundRequestsByReconciliationIds(
        trx,
        input.organizationId,
        input.propertyId,
        reconciliationIds
      ),
      this.repository.listPaymentEvidenceByIds(
        trx,
        input.organizationId,
        input.propertyId,
        evidenceIds
      )
    ]);

    const requestIds = refundRequests.map((row) => row.id);
    const submissions = await this.repository.listRefundSubmissionsByRequestIds(
      trx,
      input.organizationId,
      input.propertyId,
      requestIds
    );
    const finalizations = await this.repository.listRefundFinalizationsBySubmissionIds(
      trx,
      input.organizationId,
      input.propertyId,
      submissions.map((row) => row.id)
    );

    const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
    const requestByReconciliation = new Map(
      refundRequests.map((row) => [row.reconciliation_case_id, row])
    );
    const submissionsByRequest = new Map<string, FinanceRefundSubmissionRecord[]>();
    for (const submission of submissions) {
      const list = submissionsByRequest.get(submission.refund_request_id) ?? [];
      list.push(submission);
      submissionsByRequest.set(submission.refund_request_id, list);
    }
    const finalizationBySubmission = new Map(
      finalizations.map((row) => [row.refund_submission_id, row])
    );

    return {
      items: pageRows.map((row) => {
        const request = requestByReconciliation.get(row.id) ?? null;
        const latest = request
          ? latestSubmission(submissionsByRequest.get(request.id) ?? [])
          : null;
        const finalization = latest ? (finalizationBySubmission.get(latest.id) ?? null) : null;
        const evidence = evidenceById.get(row.payment_evidence_id);

        return {
          reconciliation: reconciliationView(row),
          paymentEvidence: evidence ? evidenceView(evidence) : null,
          refundRequestId: request?.id ?? null,
          latestRefundSubmissionId: latest?.id ?? null,
          latestRefundAttemptSequence: latest?.attempt_sequence ?? null,
          latestProviderRefundId: latest?.provider_refund_id ?? null,
          refundState: refundState(row, request, latest, finalization)
        };
      }),
      nextCursor:
        hasMore && pageRows.length > 0 ? encodeCursor(pageRows[pageRows.length - 1]!) : null
    };
  }

  async getReconciliationDetail(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reconciliationCaseId: string;
    }
  ): Promise<ReconciliationDetailResult> {
    this.authorize(actor, input.organizationId, input.propertyId);

    const reconciliation = await this.repository.findReconciliation(
      trx,
      input.organizationId,
      input.propertyId,
      input.reconciliationCaseId
    );
    if (!reconciliation) throw new NotFoundError("Payment reconciliation case not found");

    const [paymentIntent, paymentEvidence, refundRequests] = await Promise.all([
      this.repository.findPaymentIntent(
        trx,
        input.organizationId,
        input.propertyId,
        reconciliation.reservation_id,
        reconciliation.payment_intent_id
      ),
      this.repository.findPaymentEvidence(
        trx,
        input.organizationId,
        input.propertyId,
        reconciliation.reservation_id,
        reconciliation.payment_evidence_id
      ),
      this.repository.listRefundRequestsByReconciliationIds(
        trx,
        input.organizationId,
        input.propertyId,
        [reconciliation.id]
      )
    ]);

    if (!paymentIntent) throw new NotFoundError("Payment intent for reconciliation not found");
    if (!paymentEvidence) {
      throw new NotFoundError("Verified payment evidence for reconciliation not found");
    }

    const refundRequest = refundRequests[0] ?? null;
    const submissions = refundRequest
      ? await this.repository.listRefundSubmissionsByRequestIds(
          trx,
          input.organizationId,
          input.propertyId,
          [refundRequest.id]
        )
      : [];

    const submissionIds = submissions.map((row) => row.id);
    const [providerEvents, finalizations] = await Promise.all([
      this.repository.listRefundProviderEventsBySubmissionIds(
        trx,
        input.organizationId,
        input.propertyId,
        submissionIds
      ),
      this.repository.listRefundFinalizationsBySubmissionIds(
        trx,
        input.organizationId,
        input.propertyId,
        submissionIds
      )
    ]);

    return {
      reconciliation: reconciliationView(reconciliation),
      paymentIntent: intentView(paymentIntent),
      paymentEvidence: evidenceView(paymentEvidence),
      refundRequest: refundRequest ? refundRequestView(refundRequest) : null,
      refundSubmissions: submissions.map(refundSubmissionView),
      refundProviderEvents: providerEvents.map(refundProviderEventView),
      refundFinalizations: finalizations.map(refundFinalizationView)
    };
  }
}
