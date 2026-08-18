import { randomUUID } from "node:crypto";
import type { Insertable, Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { PaymentProviderOrderView } from "../domain/payment-provider-order.js";
import type { PaymentProviderOrdersTable } from "./payment-provider-order-database-types.js";

export type PaymentProviderOrderRecord = Selectable<PaymentProviderOrdersTable>;

function providerOrderView(row: PaymentProviderOrderRecord): PaymentProviderOrderView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    provider: row.provider as "RAZORPAY",
    providerOrderId: row.provider_order_id,
    receipt: row.receipt,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    providerCreatedAt: row.provider_created_at.toISOString(),
    linkedAt: row.created_at.toISOString()
  };
}

export class PaymentProviderOrderRepository {
  async findByIntent(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string
  ): Promise<PaymentProviderOrderRecord | undefined> {
    return trx
      .selectFrom("payment_provider_orders")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("payment_intent_id", "=", paymentIntentId)
      .executeTakeFirst();
  }

  async findByProviderOrderForUpdate(
    trx: Transaction<Database>,
    provider: string,
    providerOrderId: string
  ): Promise<PaymentProviderOrderRecord | undefined> {
    return trx
      .selectFrom("payment_provider_orders")
      .selectAll()
      .where("provider", "=", provider)
      .where("provider_order_id", "=", providerOrderId)
      .forUpdate()
      .executeTakeFirst();
  }

  async create(
    trx: Transaction<Database>,
    input: {
      paymentIntentId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      providerOrderId: string;
      receipt: string;
      amountMinor: number;
      currencyCode: string;
      providerCreatedAt: Date;
      request: RequestMetadata;
    }
  ): Promise<PaymentProviderOrderRecord | undefined> {
    const values: Insertable<PaymentProviderOrdersTable> = {
      id: randomUUID(),
      payment_intent_id: input.paymentIntentId,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      reservation_id: input.reservationId,
      provider: "RAZORPAY",
      provider_order_id: input.providerOrderId,
      receipt: input.receipt,
      amount_minor: input.amountMinor,
      currency_code: input.currencyCode,
      provider_created_at: input.providerCreatedAt,
      source: input.request.source,
      request_id: input.request.requestId,
      correlation_id: input.request.correlationId
    };

    return trx
      .insertInto("payment_provider_orders")
      .values(values)
      .onConflict((conflict) => conflict.column("payment_intent_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  view(row: PaymentProviderOrderRecord): PaymentProviderOrderView {
    return providerOrderView(row);
  }
}
