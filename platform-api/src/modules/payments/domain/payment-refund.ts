import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PaymentRefundRequestView extends JsonObject {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string;
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
