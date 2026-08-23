import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  PaymentVerificationMethod,
  VerifiedPaymentEvidenceView
} from "../domain/payment-evidence.js";
import type { PaymentProviderEvidenceTable } from "./payment-evidence-database-types.js";

export type PaymentProviderEvidenceRecord = Selectable<PaymentProviderEvidenceTable>;

function view(row: PaymentProviderEvidenceRecord): VerifiedPaymentEvidenceView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    provider: row.provider,
    providerEventId: row.provider_event_id,
    providerPaymentId: row.provider_payment_id,
    providerOrderId: row.provider_order_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    verificationMethod: row.verification_method as PaymentVerificationMethod,
    payloadSha256: row.payload_sha256,
    receivedAt: row.received_at.toISOString()
  };
}

export class PaymentEvidenceRepository {
  async findByProviderEvent(
    trx: Transaction<Database>,
    provider: string,
    providerEventId: string
  ): Promise<PaymentProviderEvidenceRecord | undefined> {
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("provider", "=", provider)
      .where("provider_event_id", "=", providerEventId)
      .executeTakeFirst();
  }

  async findByProviderPayment(
    trx: Transaction<Database>,
    provider: string,
    providerPaymentId: string
  ): Promise<PaymentProviderEvidenceRecord | undefined> {
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("provider", "=", provider)
      .where("provider_payment_id", "=", providerPaymentId)
      .executeTakeFirst();
  }

  async findByIdForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string,
    paymentEvidenceId: string
  ): Promise<PaymentProviderEvidenceRecord | undefined> {
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("payment_intent_id", "=", paymentIntentId)
      .where("id", "=", paymentEvidenceId)
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
      provider: string;
      providerEventId: string;
      providerPaymentId: string;
      providerOrderId: string | null;
      amountMinor: number;
      currencyCode: string;
      verificationMethod: PaymentVerificationMethod;
      payloadSha256: string;
      request: RequestMetadata;
    }
  ): Promise<PaymentProviderEvidenceRecord | undefined> {
    return trx
      .insertInto("payment_provider_evidence")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_event_id: input.providerEventId,
        provider_payment_id: input.providerPaymentId,
        provider_order_id: input.providerOrderId,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        verification_method: input.verificationMethod,
        payload_sha256: input.payloadSha256,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  view(row: PaymentProviderEvidenceRecord): VerifiedPaymentEvidenceView {
    return view(row);
  }
}
