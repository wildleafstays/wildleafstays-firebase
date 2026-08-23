import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { PaymentIntentStatus } from "../../payments/domain/payment.js";
import type { ReservationStatus } from "../../reservations/domain/reservation.js";

export interface PublicCheckoutStatusRequest extends JsonObject {
  reservationId: string;
  paymentIntentId: string;
}

export type PublicCheckoutOutcome =
  "PAYMENT_PENDING" | "CONFIRMED" | "PAYMENT_FAILED" | "CLOSED" | "REQUIRES_ASSISTANCE";

export interface PublicCheckoutStatusResult extends JsonObject {
  outcome: PublicCheckoutOutcome;
  reservation: {
    id: string;
    reservationReference: string;
    status: ReservationStatus;
    arrivalDate: string;
    departureDate: string;
    holdExpiresAt: string;
    holdExpired: boolean;
  };
  paymentIntent: {
    id: string;
    status: PaymentIntentStatus;
    expiresAt: string;
    expired: boolean;
  };
}
