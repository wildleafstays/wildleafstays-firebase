import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { PaymentRefundRequestView, PaymentRefundSource } from "../domain/payment-refund.js";
import type { PaymentRefundRequestsTable } from "./payment-refund-database-types.js";

export type PaymentRefundRequestRecord = Selectable<PaymentRefundRequestsTable>;

function view(row: PaymentRefundRequestRecord): PaymentRefundRequestView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    refundSource: row.refund_source as PaymentRefundSource,
    reconciliationCaseId: row.reconciliation_case_id,
    cancellationDecisionId: row.cancellation_decision_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    amountMinor: row.amount_minor,
    currencyCode: row.currency_code,
    reasonCode: row.reason_code,
    createdAt: row.created_at.toISOString()
  };
}

export class PaymentRefundRequestRepository {
  async findById(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    refundRequestId: string
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", refundRequestId)
      .executeTakeFirst();
  }

  async findByIdForUpdate(
    trx: Transaction<Database>,
    refundRequestId: string
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("id", "=", refundRequestId)
      .forUpdate()
      .executeTakeFirst();
  }

  async findByReconciliationCase(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    reconciliationCaseId: string
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("refund_source", "=", "RECONCILIATION")
      .where("reconciliation_case_id", "=", reconciliationCaseId)
      .executeTakeFirst();
  }

  async findByCancellationDecision(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    cancellationDecisionId: string
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("refund_source", "=", "RESERVATION_CANCELLATION")
      .where("cancellation_decision_id", "=", cancellationDecisionId)
      .executeTakeFirst();
  }

  async create(
    trx: Transaction<Database>,
    input: {
      paymentIntentId: string;
      paymentEvidenceId: string;
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      provider: string;
      providerPaymentId: string;
      amountMinor: number;
      currencyCode: string;
      reasonCode: string;
      request: RequestMetadata;
    }
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .insertInto("payment_refund_requests")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        refund_source: "RECONCILIATION",
        reconciliation_case_id: input.reconciliationCaseId,
        cancellation_decision_id: null,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_payment_id: input.providerPaymentId,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        reason_code: input.reasonCode,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.column("reconciliation_case_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createForCancellation(
    trx: Transaction<Database>,
    input: {
      cancellationDecisionId: string;
      paymentIntentId: string;
      paymentEvidenceId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      provider: string;
      providerPaymentId: string;
      amountMinor: number;
      currencyCode: string;
      request: RequestMetadata;
    }
  ): Promise<PaymentRefundRequestRecord | undefined> {
    return trx
      .insertInto("payment_refund_requests")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        refund_source: "RESERVATION_CANCELLATION",
        reconciliation_case_id: null,
        cancellation_decision_id: input.cancellationDecisionId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        provider: input.provider,
        provider_payment_id: input.providerPaymentId,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        reason_code: "RESERVATION_CANCELLATION",
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  view(row: PaymentRefundRequestRecord): PaymentRefundRequestView {
    return view(row);
  }
}
