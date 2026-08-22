import type { JsonObject } from "../../../infrastructure/database/types.js";

export type PaymentRefundProviderStatus = "PENDING" | "PROCESSED" | "FAILED";

export const PaymentRefundSources = {
  RECONCILIATION: "RECONCILIATION",
  RESERVATION_CANCELLATION: "RESERVATION_CANCELLATION"
} as const;

export type PaymentRefundSource = (typeof PaymentRefundSources)[keyof typeof PaymentRefundSources];

export interface PaymentRefundRequestView extends JsonObject {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string | null;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  provider: string;
  providerPaymentId: string;
  amountMinor: number;
  currencyCode: string;
  reasonCode: string;
  createdAt: string;
}

export interface EnsurePaymentRefundRequestResult extends JsonObject {
  created: boolean;
  refundRequest: PaymentRefundRequestView;
}

export interface PaymentRefundSubmissionView extends JsonObject {
  id: string;
  refundRequestId: string;
  attemptSequence: number;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  provider: string;
  providerPaymentId: string;
  providerRefundId: string;
  amountMinor: number;
  currencyCode: string;
  idempotencyKey: string;
  initialProviderStatus: PaymentRefundProviderStatus;
  providerCreatedAt: string;
  createdAt: string;
}

export interface SubmitRazorpayRefundResult extends JsonObject {
  created: boolean;
  submission: PaymentRefundSubmissionView;
}
