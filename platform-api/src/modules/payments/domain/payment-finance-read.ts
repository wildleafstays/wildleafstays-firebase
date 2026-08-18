import type { JsonObject } from "../../../infrastructure/database/types.js";

export type FinanceRefundState =
  "NOT_APPLICABLE" | "MISSING_REQUEST" | "REQUESTED" | "SUBMITTED" | "PROCESSED" | "FAILED";

export interface FinanceReservationSummary {
  id: string;
  reservationReference: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  totalMinor: number;
  currencyCode: string;
}

export interface FinancePaymentIntentView {
  id: string;
  paymentReference: string;
  purpose: string;
  amountMinor: number;
  currencyCode: string;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface FinanceProviderOrderView {
  id: string;
  paymentIntentId: string;
  provider: string;
  providerOrderId: string;
  receipt: string;
  amountMinor: number;
  currencyCode: string;
  providerCreatedAt: string;
  linkedAt: string;
}

export interface FinancePaymentEvidenceView {
  id: string;
  paymentIntentId: string;
  provider: string;
  providerEventId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountMinor: number;
  currencyCode: string;
  verificationMethod: string;
  receivedAt: string;
}

export interface FinancePaymentSuccessView {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  outcome: string;
  inventoryAllocationId: string | null;
  createdAt: string;
}

export interface FinanceReconciliationView {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reservationId: string;
  reasonCode: string;
  requiredAction: string;
  status: string;
  details: JsonObject;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface FinanceRefundRequestView {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string;
  provider: string;
  providerPaymentId: string;
  amountMinor: number;
  currencyCode: string;
  reasonCode: string;
  createdAt: string;
}

export interface FinanceRefundSubmissionView {
  id: string;
  refundRequestId: string;
  attemptSequence: number;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string;
  provider: string;
  providerPaymentId: string;
  providerRefundId: string;
  amountMinor: number;
  currencyCode: string;
  initialProviderStatus: string;
  providerCreatedAt: string;
  createdAt: string;
}

export interface FinanceRefundProviderEventView {
  id: string;
  refundSubmissionId: string;
  refundRequestId: string;
  reconciliationCaseId: string;
  provider: string;
  providerEventId: string;
  providerRefundId: string;
  providerPaymentId: string;
  eventType: string;
  providerStatus: string;
  amountMinor: number;
  currencyCode: string;
  providerRefundCreatedAt: string;
  providerEventCreatedAt: string;
  createdAt: string;
}

export interface FinanceRefundFinalizationView {
  id: string;
  refundSubmissionId: string;
  refundRequestId: string;
  reconciliationCaseId: string;
  provider: string;
  providerEventId: string;
  providerRefundId: string;
  status: string;
  amountMinor: number;
  currencyCode: string;
  providerEventCreatedAt: string;
  createdAt: string;
}

export interface FinancePaymentEventView {
  id: string;
  paymentIntentId: string;
  eventType: string;
  actorUserId: string | null;
  createdAt: string;
}

export interface ReservationPaymentHistoryResult {
  reservation: FinanceReservationSummary;
  paymentIntents: FinancePaymentIntentView[];
  providerOrders: FinanceProviderOrderView[];
  verifiedPayments: FinancePaymentEvidenceView[];
  paymentSuccesses: FinancePaymentSuccessView[];
  reconciliations: FinanceReconciliationView[];
  refundRequests: FinanceRefundRequestView[];
  refundSubmissions: FinanceRefundSubmissionView[];
  refundProviderEvents: FinanceRefundProviderEventView[];
  refundFinalizations: FinanceRefundFinalizationView[];
  paymentEvents: FinancePaymentEventView[];
}

export interface ReconciliationQueueItemView {
  reconciliation: FinanceReconciliationView;
  paymentEvidence: FinancePaymentEvidenceView | null;
  refundRequestId: string | null;
  latestRefundSubmissionId: string | null;
  latestRefundAttemptSequence: number | null;
  latestProviderRefundId: string | null;
  refundState: FinanceRefundState;
}

export interface ReconciliationQueueResult {
  items: ReconciliationQueueItemView[];
  nextCursor: string | null;
}

export interface ReconciliationDetailResult {
  reconciliation: FinanceReconciliationView;
  paymentIntent: FinancePaymentIntentView;
  paymentEvidence: FinancePaymentEvidenceView;
  refundRequest: FinanceRefundRequestView | null;
  refundSubmissions: FinanceRefundSubmissionView[];
  refundProviderEvents: FinanceRefundProviderEventView[];
  refundFinalizations: FinanceRefundFinalizationView[];
}
