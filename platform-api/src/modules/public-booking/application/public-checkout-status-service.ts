import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { PaymentRepository } from "../../payments/infrastructure/payment-repository.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import type {
  PublicCheckoutOutcome,
  PublicCheckoutStatusRequest,
  PublicCheckoutStatusResult
} from "../domain/public-checkout-status.js";
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";

function checkoutOutcome(reservationStatus: string, paymentStatus: string): PublicCheckoutOutcome {
  if (
    paymentStatus === "SUCCEEDED" &&
    ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(reservationStatus)
  ) {
    return "CONFIRMED";
  }

  if (["FAILED", "CANCELLED", "EXPIRED"].includes(paymentStatus)) {
    return "PAYMENT_FAILED";
  }

  if (["CANCELLED", "EXPIRED", "NO_SHOW"].includes(reservationStatus)) {
    return "CLOSED";
  }

  if (reservationStatus === "PAYMENT_PENDING" && paymentStatus === "PENDING") {
    return "PAYMENT_PENDING";
  }

  return "REQUIRES_ASSISTANCE";
}

export class PublicCheckoutStatusService {
  constructor(
    private readonly properties = new PublicAvailabilityRepository(),
    private readonly reservations = new ReservationRepository(),
    private readonly payments = new PaymentRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async getStatus(
    db: Kysely<Database>,
    publicSlug: string,
    input: PublicCheckoutStatusRequest
  ): Promise<PublicCheckoutStatusResult> {
    return db.transaction().execute(async (trx) => {
      const property = await this.properties.findLivePropertyBySlug(trx, publicSlug.toLowerCase());
      if (!property) {
        throw new NotFoundError("Public checkout not found");
      }

      const reservation = await this.reservations.findById(
        trx,
        property.organization_id,
        property.id,
        input.reservationId
      );
      if (!reservation || reservation.source !== "public-api") {
        throw new NotFoundError("Public checkout not found");
      }

      const paymentIntent = await this.payments.findById(
        trx,
        property.organization_id,
        property.id,
        reservation.id,
        input.paymentIntentId
      );
      if (!paymentIntent || paymentIntent.source !== "public-api") {
        throw new NotFoundError("Public checkout not found");
      }

      const now = this.now();
      return {
        outcome: checkoutOutcome(reservation.status, paymentIntent.status),
        reservation: {
          id: reservation.id,
          reservationReference: reservation.reservation_reference,
          status: reservation.status as PublicCheckoutStatusResult["reservation"]["status"],
          arrivalDate: reservation.arrival_date,
          departureDate: reservation.departure_date,
          holdExpiresAt: reservation.hold_expires_at.toISOString(),
          holdExpired: reservation.hold_expires_at <= now
        },
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status as PublicCheckoutStatusResult["paymentIntent"]["status"],
          expiresAt: paymentIntent.expires_at.toISOString(),
          expired: paymentIntent.expires_at <= now
        }
      };
    });
  }
}
