import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { InventoryHoldService } from "../../inventory/application/inventory-hold-service.js";
import type { BeginPaymentResult } from "../../payments/domain/payment.js";
import { PaymentRepository } from "../../payments/infrastructure/payment-repository.js";
import { ReservationRepository } from "../infrastructure/reservation-repository.js";

const MIN_NEW_PAYMENT_WINDOW_MS = 60_000;

function paymentReference(): string {
  return `PI-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

export class BeginPaymentService {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly reservations = new ReservationRepository(),
    private readonly payments = new PaymentRepository(),
    private readonly holds = new InventoryHoldService(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async beginPayment(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<BeginPaymentResult> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const reservation = await this.reservations.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );
    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    if (reservation.status !== "HELD" && reservation.status !== "PAYMENT_PENDING") {
      throw new ConflictError(
        "Payment can begin only for a HELD reservation or resume for PAYMENT_PENDING",
        {
          reservationId: reservation.id,
          reservationStatus: reservation.status
        }
      );
    }

    const now = this.now();
    if (reservation.hold_expires_at <= now) {
      throw new ConflictError("The reservation inventory hold has expired", {
        reservationId: reservation.id,
        holdExpiresAt: reservation.hold_expires_at.toISOString()
      });
    }

    const existingIntent = await this.payments.findPendingByReservationForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.id
    );

    if (reservation.status === "PAYMENT_PENDING" && !existingIntent) {
      throw new ConflictError("Reservation is PAYMENT_PENDING but has no active payment intent", {
        reservationId: reservation.id
      });
    }

    if (reservation.status === "HELD" && existingIntent) {
      throw new ConflictError(
        "HELD reservation unexpectedly already has a pending payment intent",
        {
          reservationId: reservation.id,
          paymentIntentId: existingIntent.id
        }
      );
    }

    if (
      reservation.status === "HELD" &&
      reservation.hold_expires_at.getTime() - now.getTime() < MIN_NEW_PAYMENT_WINDOW_MS
    ) {
      throw new ConflictError(
        "Reservation hold is too close to expiry to safely begin a new payment",
        {
          reservationId: reservation.id,
          holdExpiresAt: reservation.hold_expires_at.toISOString(),
          remainingMilliseconds: reservation.hold_expires_at.getTime() - now.getTime()
        }
      );
    }

    const holdResult = await this.holds.getHold(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      reservation.inventory_hold_id,
      request,
      Permissions.RESERVATION_MANAGE
    );
    const hold = holdResult.hold;
    if (hold.status !== "ACTIVE") {
      throw new ConflictError("Reservation inventory hold is no longer active", {
        reservationId: reservation.id,
        inventoryHoldId: hold.id,
        holdStatus: hold.status
      });
    }

    const authoritativeExpiry = new Date(
      Math.min(reservation.hold_expires_at.getTime(), new Date(hold.expiresAt).getTime())
    );
    if (authoritativeExpiry <= now) {
      throw new ConflictError("Reservation inventory hold has expired", {
        reservationId: reservation.id,
        holdExpiresAt: authoritativeExpiry.toISOString()
      });
    }

    if (existingIntent) {
      if (
        existingIntent.amount_minor !== reservation.total_minor ||
        existingIntent.currency_code !== reservation.currency_code
      ) {
        throw new ConflictError(
          "Existing payment intent does not match the immutable reservation amount and currency",
          {
            reservationId: reservation.id,
            paymentIntentId: existingIntent.id
          }
        );
      }
      if (existingIntent.expires_at > authoritativeExpiry) {
        throw new ConflictError("Existing payment intent outlives the reservation inventory hold", {
          reservationId: reservation.id,
          paymentIntentId: existingIntent.id
        });
      }

      return {
        created: false,
        paymentIntent: this.payments.view(existingIntent, now),
        reservation: await this.reservations.view(trx, reservation, now)
      };
    }

    const intent = await this.payments.createIntent(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: reservation.id,
      paymentReference: paymentReference(),
      amountMinor: reservation.total_minor,
      currencyCode: reservation.currency_code,
      expiresAt: authoritativeExpiry,
      createdByUserId: actor.userId,
      request
    });

    await this.payments.recordEvent(trx, {
      paymentIntentId: intent.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: reservation.id,
      eventType: "PAYMENT_INTENT_CREATED",
      details: {
        paymentReference: intent.payment_reference,
        purpose: intent.purpose,
        amountMinor: intent.amount_minor,
        currencyCode: intent.currency_code,
        status: intent.status,
        expiresAt: intent.expires_at.toISOString()
      },
      actorUserId: actor.userId,
      request
    });

    const transitioned = await this.reservations.transitionStatus(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.id,
      "HELD",
      "PAYMENT_PENDING"
    );
    if (!transitioned) {
      throw new ConflictError("Reservation state changed while beginning payment", {
        reservationId: reservation.id
      });
    }

    await this.reservations.appendStatusHistory(trx, {
      reservationId: reservation.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      fromStatus: "HELD",
      toStatus: "PAYMENT_PENDING",
      reason: "PAYMENT_INTENT_CREATED",
      actorUserId: actor.userId,
      request
    });

    const reservationView = await this.reservations.view(trx, transitioned, now);
    const paymentView = this.payments.view(intent, now);
    const audit = new AuditService(trx);

    await audit.record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "payment.intent.created",
      entityType: "payment_intent",
      entityId: intent.id,
      after: {
        paymentIntentId: intent.id,
        paymentReference: intent.payment_reference,
        reservationId: reservation.id,
        amountMinor: intent.amount_minor,
        currencyCode: intent.currency_code,
        status: intent.status,
        expiresAt: intent.expires_at.toISOString()
      },
      request
    });

    await audit.record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "reservation.payment.started",
      entityType: "reservation",
      entityId: reservation.id,
      before: { status: "HELD" },
      after: {
        status: "PAYMENT_PENDING",
        paymentIntentId: intent.id,
        paymentReference: intent.payment_reference
      },
      request
    });

    const outbox = new OutboxService(trx);
    await outbox.enqueue({
      aggregateType: "payment_intent",
      aggregateId: intent.id,
      eventType: "payment.intent.created.v1",
      payload: {
        paymentIntentId: intent.id,
        paymentReference: intent.payment_reference,
        reservationId: reservation.id,
        propertyId: input.propertyId,
        amountMinor: intent.amount_minor,
        currencyCode: intent.currency_code,
        status: intent.status,
        expiresAt: intent.expires_at.toISOString()
      }
    });

    await outbox.enqueue({
      aggregateType: "reservation",
      aggregateId: reservation.id,
      eventType: "reservation.payment_pending.v1",
      payload: {
        reservationId: reservation.id,
        reservationReference: reservation.reservation_reference,
        propertyId: input.propertyId,
        paymentIntentId: intent.id,
        status: "PAYMENT_PENDING",
        holdExpiresAt: reservation.hold_expires_at.toISOString()
      }
    });

    return {
      created: true,
      paymentIntent: paymentView,
      reservation: reservationView
    };
  }

  async getPaymentIntent(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
      paymentIntentId: string;
    }
  ): Promise<{ paymentIntent: ReturnType<PaymentRepository["view"]> }> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const intent = await this.payments.findById(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.paymentIntentId
    );
    if (!intent) {
      throw new NotFoundError("Payment intent not found");
    }

    return { paymentIntent: this.payments.view(intent, this.now()) };
  }
}
