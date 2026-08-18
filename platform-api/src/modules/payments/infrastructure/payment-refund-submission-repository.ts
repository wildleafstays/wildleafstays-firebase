import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  PaymentRefundProviderStatus,
  PaymentRefundSubmissionView
} from "../domain/payment-refund.js";
import type { PaymentRefundSubmissionsTable } from "./payment-refund-submission-database-types.js";

export type PaymentRefundSubmissionRecord = Selectable<PaymentRefundSubmissionsTable>;

function view(row: PaymentRefundSubmissionRecord): PaymentRefundSubmissionView {
  return {
    id: row.id,
    refundRequestId: row.refund_request_id,
    attemptSequence: row.attempt_sequence,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    reconciliationCaseId: row.reconciliation_case_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    providerRefundId: row.provider_refund_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    idempotencyKey: row.idempotency_key,
    initialProviderStatus: row.initial_provider_status as PaymentRefundProviderStatus,
    providerCreatedAt: row.provider_created_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

export class PaymentRefundSubmissionRepository {
  async findByRefundRequestAttempt(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    refundRequestId: string,
    attemptSequence: number
  ): Promise<PaymentRefundSubmissionRecord | undefined> {
    return trx
      .selectFrom("payment_refund_submissions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("refund_request_id", "=", refundRequestId)
      .where("attempt_sequence", "=", attemptSequence)
      .executeTakeFirst();
  }

  async create(
    trx: Transaction<Database>,
    input: {
      refundRequestId: string;
      attemptSequence: number;
      paymentIntentId: string;
      paymentEvidenceId: string;
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      provider: string;
      providerPaymentId: string;
      providerRefundId: string;
      amountMinor: number;
      currencyCode: string;
      idempotencyKey: string;
      initialProviderStatus: PaymentRefundProviderStatus;
      providerCreatedAt: Date;
      request: RequestMetadata;
    }
  ): Promise<PaymentRefundSubmissionRecord | undefined> {
    return trx
      .insertInto("payment_refund_submissions")
      .values({
        id: randomUUID(),
        refund_request_id: input.refundRequestId,
        attempt_sequence: input.attemptSequence,
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        reconciliation_case_id: input.reconciliationCaseId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_payment_id: input.providerPaymentId,
        provider_refund_id: input.providerRefundId,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        idempotency_key: input.idempotencyKey,
        initial_provider_status: input.initialProviderStatus,
        provider_created_at: input.providerCreatedAt,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) =>
        conflict.columns(["refund_request_id", "attempt_sequence"]).doNothing()
      )
      .returningAll()
      .executeTakeFirst();
  }

  view(row: PaymentRefundSubmissionRecord): PaymentRefundSubmissionView {
    return view(row);
  }
}
