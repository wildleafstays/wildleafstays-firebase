import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AppError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { GuestSelfService } from "../../guest/application/guest-self-service.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import {
  RazorpayOrderService,
  type RazorpayOrderGateway
} from "../../payments/application/razorpay-order-service.js";
import type { RazorpayCheckoutView } from "../../payments/domain/payment-provider-order.js";
import type { PaymentIntentView } from "../../payments/domain/payment.js";
import { BeginPaymentService } from "../../reservations/application/begin-payment-service.js";
import { HeldReservationService } from "../../reservations/application/held-reservation-service.js";
import type { ReservationView } from "../../reservations/domain/reservation.js";
import type {
  PublicCheckoutPreparation,
  PublicCheckoutRequest,
  PublicCheckoutReservationView,
  PublicPaymentIntentView,
  PublicRazorpayCheckoutView
} from "../domain/public-checkout.js";
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";
import { PublicRoomMixReservationService } from "./public-room-mix-reservation-service.js";

function reservationView(reservation: ReservationView): PublicCheckoutReservationView {
  if (reservation.status !== "PAYMENT_PENDING") {
    throw new ConflictError("Public checkout requires a PAYMENT_PENDING reservation", {
      reservationId: reservation.id,
      reservationStatus: reservation.status
    });
  }

  if (
    reservation.productType === "ROOM_MIX"
      ? reservation.roomMixQuoteId === null || reservation.quoteId !== null
      : reservation.quoteId === null || reservation.roomMixQuoteId !== null
  ) {
    throw new ConflictError("Public checkout reservation source identity is inconsistent", {
      reservationId: reservation.id,
      productType: reservation.productType
    });
  }

  return {
    id: reservation.id,
    reservationReference: reservation.reservationReference,
    quoteId: reservation.quoteId,
    roomMixQuoteId: reservation.roomMixQuoteId,
    status: "PAYMENT_PENDING",
    holdExpiresAt: reservation.holdExpiresAt,
    arrivalDate: reservation.arrivalDate,
    departureDate: reservation.departureDate,
    productType: reservation.productType,
    roomCategoryId: reservation.roomCategoryId,
    quantity: reservation.quantity,
    currencyCode: reservation.currencyCode,
    totalMinor: reservation.totalMinor,
    leadGuest: {
      name: reservation.leadGuest.name,
      email: reservation.leadGuest.email,
      phone: reservation.leadGuest.phone
    }
  };
}

function paymentIntentView(intent: PaymentIntentView): PublicPaymentIntentView {
  if (intent.status !== "PENDING") {
    throw new ConflictError("Public checkout requires a PENDING payment intent", {
      paymentIntentId: intent.id,
      paymentIntentStatus: intent.status
    });
  }

  return {
    id: intent.id,
    paymentReference: intent.paymentReference,
    reservationId: intent.reservationId,
    status: "PENDING",
    amountMinor: intent.amountMinor,
    currencyCode: intent.currencyCode,
    expiresAt: intent.expiresAt
  };
}

function checkoutView(checkout: RazorpayCheckoutView): PublicRazorpayCheckoutView {
  return {
    keyId: checkout.keyId,
    orderId: checkout.orderId,
    paymentIntentId: checkout.paymentIntentId,
    reservationId: checkout.reservationId,
    amountMinor: checkout.amountMinor,
    currencyCode: checkout.currencyCode,
    receipt: checkout.receipt,
    expiresAt: checkout.expiresAt
  };
}

export class PublicCheckoutService {
  private readonly razorpayOrders: RazorpayOrderService | null;

  constructor(
    private readonly db: Kysely<Database>,
    razorpayGateway: RazorpayOrderGateway | null,
    private readonly properties = new PublicAvailabilityRepository(),
    private readonly reservations = new HeldReservationService(),
    private readonly roomMixReservations = new PublicRoomMixReservationService(),
    private readonly payments = new BeginPaymentService(),
    private readonly guestSelfService = new GuestSelfService(db)
  ) {
    this.razorpayOrders = razorpayGateway ? new RazorpayOrderService(db, razorpayGateway) : null;
  }

  assertProviderAvailable(): void {
    if (!this.razorpayOrders) {
      throw new AppError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        503,
        "Razorpay checkout is not currently available"
      );
    }
  }

  private async liveProperty(
    executor: Kysely<Database> | Transaction<Database>,
    publicSlug: string
  ) {
    const property = await this.properties.findLivePropertyBySlug(
      executor,
      publicSlug.toLowerCase()
    );

    if (!property) {
      throw new NotFoundError("Public property not found");
    }

    return property;
  }

  async createReservationPayment(
    trx: Transaction<Database>,
    publicSlug: string,
    quoteId: string,
    input: PublicCheckoutRequest,
    request: RequestMetadata,
    actor: ActorContext | null
  ): Promise<PublicCheckoutPreparation> {
    const property = await this.liveProperty(trx, publicSlug);

    const held = await this.reservations.createFromQuoteHoldSystem(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        quoteId,
        leadGuest: {
          name: input.leadGuest.name,
          email: input.leadGuest.email ?? null,
          phone: input.leadGuest.phone ?? null
        }
      },
      request
    );

    const payment = await this.payments.beginPaymentSystem(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        reservationId: held.reservation.id
      },
      request
    );

    if (
      payment.reservation.id !== held.reservation.id ||
      payment.reservation.productType === "ROOM_MIX" ||
      payment.reservation.quoteId !== quoteId ||
      payment.reservation.roomMixQuoteId !== null ||
      payment.paymentIntent.reservationId !== held.reservation.id
    ) {
      throw new ConflictError("Public checkout canonical identity mismatch", {
        quoteId,
        reservationId: held.reservation.id,
        paymentIntentId: payment.paymentIntent.id
      });
    }

    if (actor) {
      await this.guestSelfService.linkAuthenticatedCheckout(trx, {
        actor,
        reservationId: held.reservation.id,
        organizationId: property.organization_id,
        propertyId: property.id,
        request
      });
    }

    return {
      reservation: reservationView(payment.reservation),
      paymentIntent: paymentIntentView(payment.paymentIntent)
    };
  }

  async createRoomMixReservationPayment(
    trx: Transaction<Database>,
    publicSlug: string,
    roomMixQuoteId: string,
    input: PublicCheckoutRequest,
    request: RequestMetadata,
    actor: ActorContext | null
  ): Promise<PublicCheckoutPreparation> {
    const property = await this.liveProperty(trx, publicSlug);

    const held = await this.roomMixReservations.create(
      trx,
      publicSlug,
      roomMixQuoteId,
      {
        name: input.leadGuest.name,
        email: input.leadGuest.email ?? null,
        phone: input.leadGuest.phone ?? null
      },
      request,
      actor?.userId ?? null
    );

    const payment = await this.payments.beginPaymentSystem(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        reservationId: held.reservation.id
      },
      request
    );

    if (
      payment.reservation.id !== held.reservation.id ||
      payment.reservation.productType !== "ROOM_MIX" ||
      payment.reservation.quoteId !== null ||
      payment.reservation.roomMixQuoteId !== roomMixQuoteId ||
      payment.paymentIntent.reservationId !== held.reservation.id
    ) {
      throw new ConflictError("Public mixed-room checkout canonical identity mismatch", {
        roomMixQuoteId,
        reservationId: held.reservation.id,
        paymentIntentId: payment.paymentIntent.id
      });
    }

    if (actor) {
      await this.guestSelfService.linkAuthenticatedCheckout(trx, {
        actor,
        reservationId: held.reservation.id,
        organizationId: property.organization_id,
        propertyId: property.id,
        request
      });
    }

    return {
      reservation: reservationView(payment.reservation),
      paymentIntent: paymentIntentView(payment.paymentIntent)
    };
  }

  async prepareCheckout(
    publicSlug: string,
    reservationId: string,
    paymentIntentId: string,
    request: RequestMetadata
  ): Promise<PublicRazorpayCheckoutView> {
    this.assertProviderAvailable();

    const property = await this.liveProperty(this.db, publicSlug);

    const prepared = await this.razorpayOrders!.prepareCheckoutSystem(
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        reservationId,
        paymentIntentId
      },
      request
    );

    if (
      prepared.checkout.reservationId !== reservationId ||
      prepared.checkout.paymentIntentId !== paymentIntentId
    ) {
      throw new ConflictError("Razorpay checkout identity mismatch", {
        reservationId,
        paymentIntentId
      });
    }

    return checkoutView(prepared.checkout);
  }
}
