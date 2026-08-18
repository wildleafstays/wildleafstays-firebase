import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { AppError, ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import type {
  PrepareRazorpayCheckoutResult,
  RazorpayCheckoutView
} from "../domain/payment-provider-order.js";
import type {
  RazorpayCreateOrderInput,
  RazorpayOrder
} from "../infrastructure/razorpay-provider.js";
import { RazorpayProviderError } from "../infrastructure/razorpay-provider.js";
import {
  PaymentProviderOrderRepository,
  type PaymentProviderOrderRecord
} from "../infrastructure/payment-provider-order-repository.js";
import {
  PaymentRepository,
  type PaymentIntentRecord
} from "../infrastructure/payment-repository.js";

export interface RazorpayOrderGateway {
  publicKeyId(): string;
  createOrder(input: RazorpayCreateOrderInput): Promise<RazorpayOrder>;
  findOrdersByReceipt(receipt: string): Promise<RazorpayOrder[]>;
}

interface PrepareInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
}

function receiptForIntent(paymentIntentId: string): string {
  const compact = paymentIntentId.replaceAll("-", "");
  const receipt = `WL-${compact}`;
  if (!/^WL-[A-Fa-f0-9]{32}$/.test(receipt) || receipt.length > 40) {
    throw new ConflictError("Payment intent cannot be represented as a Razorpay receipt", {
      paymentIntentId
    });
  }
  return receipt;
}

export class RazorpayOrderService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly provider: RazorpayOrderGateway,
    private readonly now: () => Date = () => new Date(),
    private readonly authorization = new AuthorizationService(),
    private readonly payments = new PaymentRepository(),
    private readonly reservations = new ReservationRepository(),
    private readonly providerOrders = new PaymentProviderOrderRepository()
  ) {}

  private assertIntentEconomics(intent: PaymentIntentRecord): void {
    if (!Number.isSafeInteger(intent.amount_minor) || intent.amount_minor <= 0) {
      throw new ConflictError("Razorpay checkout requires a positive payment amount", {
        paymentIntentId: intent.id,
        amountMinor: intent.amount_minor
      });
    }
    if (!/^[A-Z]{3}$/.test(intent.currency_code)) {
      throw new ConflictError("Payment intent currency is not valid for provider checkout", {
        paymentIntentId: intent.id,
        currencyCode: intent.currency_code
      });
    }
  }

  private assertStoredMapping(
    row: PaymentProviderOrderRecord,
    intent: PaymentIntentRecord,
    receipt: string
  ): void {
    if (
      row.provider !== "RAZORPAY" ||
      row.payment_intent_id !== intent.id ||
      row.organization_id !== intent.organization_id ||
      row.property_id !== intent.property_id ||
      row.reservation_id !== intent.reservation_id ||
      row.receipt !== receipt ||
      row.amount_minor !== intent.amount_minor ||
      row.currency_code !== intent.currency_code
    ) {
      throw new ConflictError("Stored Razorpay order does not match the immutable payment intent", {
        paymentIntentId: intent.id,
        paymentProviderOrderId: row.id
      });
    }
  }

  private assertProviderOrder(
    order: RazorpayOrder,
    intent: PaymentIntentRecord,
    receipt: string
  ): void {
    if (
      order.amount !== intent.amount_minor ||
      order.currency !== intent.currency_code ||
      order.receipt !== receipt
    ) {
      throw new ConflictError("Razorpay order does not match the immutable payment intent", {
        paymentIntentId: intent.id,
        providerOrderId: order.id,
        expectedAmountMinor: intent.amount_minor,
        providerAmountMinor: order.amount,
        expectedCurrencyCode: intent.currency_code,
        providerCurrencyCode: order.currency,
        expectedReceipt: receipt,
        providerReceipt: order.receipt
      });
    }
  }

  private providerCreatedAt(order: RazorpayOrder): Date {
    if (!Number.isSafeInteger(order.createdAt) || order.createdAt <= 0) {
      throw new ConflictError("Razorpay order has an invalid creation timestamp", {
        providerOrderId: order.id,
        createdAt: order.createdAt
      });
    }
    const createdAt = new Date(order.createdAt * 1000);
    if (Number.isNaN(createdAt.getTime())) {
      throw new ConflictError("Razorpay order has an invalid creation timestamp", {
        providerOrderId: order.id
      });
    }
    return createdAt;
  }

  private providerFailure(error: unknown): never {
    if (error instanceof RazorpayProviderError) {
      throw new AppError("PAYMENT_PROVIDER_ERROR", 502, "Razorpay request failed", {
        provider: "RAZORPAY",
        providerStatusCode: error.statusCode
      });
    }
    throw error;
  }

  private async findProviderOrder(receipt: string): Promise<RazorpayOrder | null> {
    let orders: RazorpayOrder[];
    try {
      orders = await this.provider.findOrdersByReceipt(receipt);
    } catch (error) {
      return this.providerFailure(error);
    }
    if (orders.length > 1) {
      throw new ConflictError("Razorpay returned multiple orders for a unique receipt", {
        receipt,
        providerOrderIds: orders.map((order) => order.id)
      });
    }
    return orders[0] ?? null;
  }

  private checkout(
    intent: PaymentIntentRecord,
    providerOrder: PaymentProviderOrderRecord
  ): RazorpayCheckoutView {
    return {
      keyId: this.provider.publicKeyId(),
      orderId: providerOrder.provider_order_id,
      paymentIntentId: intent.id,
      reservationId: intent.reservation_id,
      amountMinor: intent.amount_minor,
      currencyCode: intent.currency_code,
      receipt: providerOrder.receipt,
      expiresAt: intent.expires_at.toISOString()
    };
  }

  async prepareCheckout(
    actor: ActorContext,
    input: PrepareInput,
    request: RequestMetadata
  ): Promise<PrepareRazorpayCheckoutResult> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const initial = await this.db.transaction().execute(async (trx) => {
      const intent = await this.payments.findById(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.paymentIntentId
      );
      if (!intent) throw new NotFoundError("Payment intent not found");
      this.assertIntentEconomics(intent);

      const reservation = await this.reservations.findById(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      );
      if (!reservation) throw new NotFoundError("Reservation not found");

      if (intent.status !== "PENDING") {
        throw new ConflictError(
          "Razorpay checkout can be prepared only for a PENDING payment intent",
          {
            paymentIntentId: intent.id,
            paymentIntentStatus: intent.status
          }
        );
      }
      if (intent.expires_at <= this.now()) {
        throw new ConflictError("Payment intent has expired before Razorpay checkout", {
          paymentIntentId: intent.id,
          expiresAt: intent.expires_at.toISOString()
        });
      }
      if (reservation.status !== "PAYMENT_PENDING") {
        throw new ConflictError("Razorpay checkout requires a PAYMENT_PENDING reservation", {
          reservationId: reservation.id,
          reservationStatus: reservation.status
        });
      }

      const receipt = receiptForIntent(intent.id);
      const existing = await this.providerOrders.findByIntent(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.paymentIntentId
      );
      if (existing) this.assertStoredMapping(existing, intent, receipt);

      return { intent, receipt, existing };
    });

    if (initial.existing) {
      return {
        created: false,
        recovered: false,
        providerOrder: this.providerOrders.view(initial.existing),
        checkout: this.checkout(initial.intent, initial.existing)
      };
    }

    let providerOrder = await this.findProviderOrder(initial.receipt);
    let recovered = providerOrder !== null;

    if (!providerOrder) {
      try {
        providerOrder = await this.provider.createOrder({
          amountMinor: initial.intent.amount_minor,
          currencyCode: initial.intent.currency_code,
          receipt: initial.receipt,
          notes: {
            paymentIntentId: initial.intent.id,
            paymentReference: initial.intent.payment_reference,
            reservationId: initial.intent.reservation_id
          }
        });
      } catch (error) {
        if (error instanceof RazorpayProviderError && error.statusCode === 400) {
          providerOrder = await this.findProviderOrder(initial.receipt);
          recovered = providerOrder !== null;
        }
        if (!providerOrder) this.providerFailure(error);
      }
    }

    this.assertProviderOrder(providerOrder, initial.intent, initial.receipt);
    const providerCreatedAt = this.providerCreatedAt(providerOrder);

    const persisted = await this.db.transaction().execute(async (trx) => {
      const intent = await this.payments.findByIdForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.paymentIntentId
      );
      if (!intent) throw new NotFoundError("Payment intent not found");
      this.assertIntentEconomics(intent);

      const reservation = await this.reservations.findByIdForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId
      );
      if (!reservation) throw new NotFoundError("Reservation not found");

      const receipt = receiptForIntent(intent.id);
      this.assertProviderOrder(providerOrder, intent, receipt);

      let stored = await this.providerOrders.findByIntent(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.paymentIntentId
      );
      let created = false;

      if (!stored) {
        stored = await this.providerOrders.create(trx, {
          paymentIntentId: intent.id,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          providerOrderId: providerOrder.id,
          receipt,
          amountMinor: intent.amount_minor,
          currencyCode: intent.currency_code,
          providerCreatedAt,
          request
        });
        if (stored) created = true;
      }

      if (!stored) {
        stored = await this.providerOrders.findByIntent(
          trx,
          input.organizationId,
          input.propertyId,
          input.reservationId,
          input.paymentIntentId
        );
      }
      if (!stored) {
        throw new ConflictError("Razorpay provider order could not be linked", {
          paymentIntentId: intent.id,
          providerOrderId: providerOrder.id
        });
      }

      this.assertStoredMapping(stored, intent, receipt);
      if (stored.provider_order_id !== providerOrder.id) {
        throw new ConflictError("Payment intent is already linked to a different Razorpay order", {
          paymentIntentId: intent.id,
          existingProviderOrderId: stored.provider_order_id,
          observedProviderOrderId: providerOrder.id
        });
      }

      if (created) {
        await this.payments.recordEvent(trx, {
          paymentIntentId: intent.id,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          reservationId: input.reservationId,
          eventType: "PROVIDER_ORDER_LINKED",
          details: {
            provider: "RAZORPAY",
            paymentProviderOrderId: stored.id,
            providerOrderId: stored.provider_order_id,
            receipt: stored.receipt,
            amountMinor: stored.amount_minor,
            currencyCode: stored.currency_code,
            providerCreatedAt: stored.provider_created_at.toISOString(),
            recovered
          },
          actorUserId: actor.userId,
          request
        });

        await new AuditService(trx).record({
          actor,
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          action: "payment.provider_order.linked",
          entityType: "payment_provider_order",
          entityId: stored.id,
          after: {
            ...this.providerOrders.view(stored),
            recovered
          },
          request
        });

        await new OutboxService(trx).enqueue({
          aggregateType: "payment_intent",
          aggregateId: intent.id,
          eventType: "payment.provider_order.linked.v1",
          payload: {
            paymentIntentId: intent.id,
            reservationId: input.reservationId,
            propertyId: input.propertyId,
            paymentProviderOrderId: stored.id,
            provider: "RAZORPAY",
            providerOrderId: stored.provider_order_id,
            receipt: stored.receipt,
            amountMinor: stored.amount_minor,
            currencyCode: stored.currency_code,
            recovered
          }
        });
      }

      return {
        intent,
        reservation,
        stored,
        created
      };
    });

    if (
      persisted.intent.status !== "PENDING" ||
      persisted.intent.expires_at <= this.now() ||
      persisted.reservation.status !== "PAYMENT_PENDING"
    ) {
      throw new ConflictError("Payment state changed while the Razorpay order was being prepared", {
        paymentIntentId: persisted.intent.id,
        paymentIntentStatus: persisted.intent.status,
        paymentIntentExpiresAt: persisted.intent.expires_at.toISOString(),
        reservationId: persisted.reservation.id,
        reservationStatus: persisted.reservation.status,
        paymentProviderOrderId: persisted.stored.id
      });
    }

    return {
      created: persisted.created,
      recovered,
      providerOrder: this.providerOrders.view(persisted.stored),
      checkout: this.checkout(persisted.intent, persisted.stored)
    };
  }
}
