import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { ReservationView } from "../../reservations/domain/reservation.js";

export const PaymentIntentStatuses = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED"
} as const;

export type PaymentIntentStatus =
  (typeof PaymentIntentStatuses)[keyof typeof PaymentIntentStatuses];

export interface PaymentIntentView extends JsonObject {
  id: string;
  paymentReference: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  purpose: "RESERVATION_TOTAL";
  amountMinor: number;
  currencyCode: string;
  status: PaymentIntentStatus;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
}

export interface BeginPaymentResult extends JsonObject {
  created: boolean;
  paymentIntent: PaymentIntentView;
  reservation: ReservationView;
}
