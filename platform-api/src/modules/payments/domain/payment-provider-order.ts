import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PaymentProviderOrderView extends JsonObject {
  id: string;
  paymentIntentId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  provider: "RAZORPAY";
  providerOrderId: string;
  receipt: string;
  amountMinor: number;
  currencyCode: string;
  providerCreatedAt: string;
  linkedAt: string;
}

export interface RazorpayCheckoutView extends JsonObject {
  keyId: string;
  orderId: string;
  paymentIntentId: string;
  reservationId: string;
  amountMinor: number;
  currencyCode: string;
  receipt: string;
  expiresAt: string;
}

export interface PrepareRazorpayCheckoutResult extends JsonObject {
  created: boolean;
  recovered: boolean;
  providerOrder: PaymentProviderOrderView;
  checkout: RazorpayCheckoutView;
}
