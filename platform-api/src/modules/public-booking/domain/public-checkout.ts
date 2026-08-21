import type { JsonObject } from "../../../infrastructure/database/types.js";

export interface PublicCheckoutRequest extends JsonObject {
  leadGuest: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
}

export interface PublicCheckoutReservationView extends JsonObject {
  id: string;
  reservationReference: string;
  quoteId: string;
  status: "PAYMENT_PENDING";
  holdExpiresAt: string;
  arrivalDate: string;
  departureDate: string;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  roomCategoryId: string | null;
  quantity: number;
  currencyCode: string;
  totalMinor: number;
  leadGuest: {
    name: string;
    email: string | null;
    phone: string | null;
  };
}

export interface PublicPaymentIntentView extends JsonObject {
  id: string;
  paymentReference: string;
  reservationId: string;
  status: "PENDING";
  amountMinor: number;
  currencyCode: string;
  expiresAt: string;
}

export interface PublicRazorpayCheckoutView extends JsonObject {
  keyId: string;
  orderId: string;
  paymentIntentId: string;
  reservationId: string;
  amountMinor: number;
  currencyCode: string;
  receipt: string;
  expiresAt: string;
}

export interface PublicCheckoutPreparation extends JsonObject {
  reservation: PublicCheckoutReservationView;
  paymentIntent: PublicPaymentIntentView;
}

export interface PublicCheckoutResult extends JsonObject {
  reservation: PublicCheckoutReservationView;
  paymentIntent: PublicPaymentIntentView;
  checkout: PublicRazorpayCheckoutView;
}
