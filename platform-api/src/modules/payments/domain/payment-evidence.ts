import type { JsonObject } from "../../../infrastructure/database/types.js";

export const PaymentVerificationMethods = {
  WEBHOOK_SIGNATURE: "WEBHOOK_SIGNATURE",
  PROVIDER_API: "PROVIDER_API"
} as const;

export type PaymentVerificationMethod =
  (typeof PaymentVerificationMethods)[keyof typeof PaymentVerificationMethods];

export interface VerifiedPaymentEvidenceView extends JsonObject {
  id: string;
  paymentIntentId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  provider: string;
  providerEventId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountMinor: number;
  currencyCode: string;
  verificationMethod: PaymentVerificationMethod;
  payloadSha256: string;
  receivedAt: string;
}

export interface RecordVerifiedPaymentEvidenceResult extends JsonObject {
  created: boolean;
  evidence: VerifiedPaymentEvidenceView;
}
