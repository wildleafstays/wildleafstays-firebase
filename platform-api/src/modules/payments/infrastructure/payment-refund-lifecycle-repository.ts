import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { PaymentRefundProviderStatus } from "../domain/payment-refund.js";
import type {
  PaymentRefundFinalizationsTable,
  PaymentRefundProviderEventsTable
} from "./payment-refund-lifecycle-database-types.js";

export type PaymentRefundProviderEventRecord = Selectable<PaymentRefundProviderEventsTable>;
export type PaymentRefundFinalizationRecord = Selectable<PaymentRefundFinalizationsTable>;

export class PaymentRefundLifecycleRepository {
  async findEventByProviderEvent(
    trx: Transaction<Database>,
    provider: string,
    providerEventId: string
  ): Promise<PaymentRefundProviderEventRecord | undefined> {
    return trx
      .selectFrom("payment_refund_provider_events")
      .selectAll()
      .where("provider", "=", provider)
      .where("provider_event_id", "=", providerEventId)
      .executeTakeFirst();
  }

  async createEvent(
    trx: Transaction<Database>,
    input: {
      refundSubmissionId: string;
      refundRequestId: string;
      paymentIntentId: string;
      paymentEvidenceId: string;
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      provider: string;
      providerEventId: string;
      providerRefundId: string;
      providerPaymentId: string;
      eventType: string;
      providerStatus: PaymentRefundProviderStatus;
      amountMinor: number;
      currencyCode: string;
      payloadSha256: string;
      providerRefundCreatedAt: Date;
      providerEventCreatedAt: Date;
      request: RequestMetadata;
    }
  ): Promise<PaymentRefundProviderEventRecord | undefined> {
    return trx
      .insertInto("payment_refund_provider_events")
      .values({
        id: randomUUID(),
        refund_submission_id: input.refundSubmissionId,
        refund_request_id: input.refundRequestId,
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        reconciliation_case_id: input.reconciliationCaseId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_event_id: input.providerEventId,
        provider_refund_id: input.providerRefundId,
        provider_payment_id: input.providerPaymentId,
        event_type: input.eventType,
        provider_status: input.providerStatus,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        payload_sha256: input.payloadSha256,
        provider_refund_created_at: input.providerRefundCreatedAt,
        provider_event_created_at: input.providerEventCreatedAt,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.columns(["provider", "provider_event_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async findFinalizationBySubmission(
    trx: Transaction<Database>,
    refundSubmissionId: string
  ): Promise<PaymentRefundFinalizationRecord | undefined> {
    return trx
      .selectFrom("payment_refund_finalizations")
      .selectAll()
      .where("refund_submission_id", "=", refundSubmissionId)
      .executeTakeFirst();
  }

  async createFinalization(
    trx: Transaction<Database>,
    input: {
      refundSubmissionId: string;
      refundRequestId: string;
      finalizationEventId: string;
      paymentIntentId: string;
      paymentEvidenceId: string;
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      provider: string;
      providerEventId: string;
      providerRefundId: string;
      status: "PROCESSED" | "FAILED";
      amountMinor: number;
      currencyCode: string;
      providerEventCreatedAt: Date;
      request: RequestMetadata;
    }
  ): Promise<PaymentRefundFinalizationRecord | undefined> {
    return trx
      .insertInto("payment_refund_finalizations")
      .values({
        id: randomUUID(),
        refund_submission_id: input.refundSubmissionId,
        refund_request_id: input.refundRequestId,
        finalization_event_id: input.finalizationEventId,
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        reconciliation_case_id: input.reconciliationCaseId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_event_id: input.providerEventId,
        provider_refund_id: input.providerRefundId,
        status: input.status,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        provider_event_created_at: input.providerEventCreatedAt,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.column("refund_submission_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }
}
