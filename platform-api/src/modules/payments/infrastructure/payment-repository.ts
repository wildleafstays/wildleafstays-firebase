import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { PaymentIntentStatus, PaymentIntentView } from "../domain/payment.js";
import type { PaymentIntentsTable } from "./payment-database-types.js";

export type PaymentIntentRecord = Selectable<PaymentIntentsTable>;

function paymentIntentView(row: PaymentIntentRecord, now: Date): PaymentIntentView {
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    purpose: row.purpose as "RESERVATION_TOTAL",
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    status: row.status as PaymentIntentStatus,
    expiresAt: row.expires_at.toISOString(),
    expired: row.expires_at <= now,
    createdAt: row.created_at.toISOString()
  };
}

export class PaymentRepository {
  async findPendingByReservationForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<PaymentIntentRecord | undefined> {
    return trx
      .selectFrom("payment_intents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("status", "=", "PENDING")
      .forUpdate()
      .executeTakeFirst();
  }

  async findById(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string
  ): Promise<PaymentIntentRecord | undefined> {
    return trx
      .selectFrom("payment_intents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", paymentIntentId)
      .executeTakeFirst();
  }

  async findByIdForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string
  ): Promise<PaymentIntentRecord | undefined> {
    return trx
      .selectFrom("payment_intents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", paymentIntentId)
      .forUpdate()
      .executeTakeFirst();
  }

  async transitionStatus(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string,
    fromStatus: PaymentIntentStatus,
    toStatus: PaymentIntentStatus
  ): Promise<PaymentIntentRecord | undefined> {
    return trx
      .updateTable("payment_intents")
      .set({
        status: toStatus,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", paymentIntentId)
      .where("status", "=", fromStatus)
      .returningAll()
      .executeTakeFirst();
  }

  async createIntent(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
      paymentReference: string;
      amountMinor: number;
      currencyCode: string;
      expiresAt: Date;
      createdByUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<PaymentIntentRecord> {
    return trx
      .insertInto("payment_intents")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        payment_reference: input.paymentReference,
        purpose: "RESERVATION_TOTAL",
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        status: "PENDING",
        expires_at: input.expiresAt,
        created_by_user_id: input.createdByUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recordEvent(
    trx: Transaction<Database>,
    input: {
      paymentIntentId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      eventType: string;
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("payment_events")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        event_type: input.eventType,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }

  view(row: PaymentIntentRecord, now: Date): PaymentIntentView {
    return paymentIntentView(row, now);
  }
}
