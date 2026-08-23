import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { PaymentEventsTable, PaymentIntentsTable } from "./payment-database-types.js";
import type { PaymentProviderEvidenceTable } from "./payment-evidence-database-types.js";
import type {
  PaymentReconciliationCasesTable,
  PaymentSuccessesTable
} from "./payment-processing-database-types.js";
import type { PaymentProviderOrdersTable } from "./payment-provider-order-database-types.js";
import type { PaymentRefundRequestsTable } from "./payment-refund-database-types.js";
import type {
  PaymentRefundFinalizationsTable,
  PaymentRefundProviderEventsTable
} from "./payment-refund-lifecycle-database-types.js";
import type { PaymentRefundSubmissionsTable } from "./payment-refund-submission-database-types.js";
import type { ReservationsTable } from "../../reservations/infrastructure/reservation-database-types.js";

export type FinanceReservationRecord = Selectable<ReservationsTable>;
export type FinancePaymentIntentRecord = Selectable<PaymentIntentsTable>;
export type FinancePaymentEventRecord = Selectable<PaymentEventsTable>;
export type FinanceProviderOrderRecord = Selectable<PaymentProviderOrdersTable>;
export type FinancePaymentEvidenceRecord = Selectable<PaymentProviderEvidenceTable>;
export type FinancePaymentSuccessRecord = Selectable<PaymentSuccessesTable>;
export type FinanceReconciliationRecord = Selectable<PaymentReconciliationCasesTable>;
export type FinanceRefundRequestRecord = Selectable<PaymentRefundRequestsTable>;
export type FinanceRefundSubmissionRecord = Selectable<PaymentRefundSubmissionsTable>;
export type FinanceRefundProviderEventRecord = Selectable<PaymentRefundProviderEventsTable>;
export type FinanceRefundFinalizationRecord = Selectable<PaymentRefundFinalizationsTable>;

export interface ReconciliationListFilters {
  status?: "OPEN" | "RESOLVED";
  requiredAction?: "REFUND_REQUIRED" | "MANUAL_REVIEW";
  reasonCode?:
    | "INVENTORY_HOLD_EXPIRED"
    | "INVENTORY_HOLD_NOT_ACTIVE"
    | "INVENTORY_HOLD_UNAVAILABLE"
    | "RESERVATION_STATE_MISMATCH"
    | "DUPLICATE_VERIFIED_PAYMENT";
}

export interface ReconciliationListCursor {
  createdAt: Date;
  id: string;
}

export class PaymentFinanceReadRepository {
  async findReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .executeTakeFirst();
  }

  async listPaymentIntentsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinancePaymentIntentRecord[]> {
    return trx
      .selectFrom("payment_intents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async findPaymentIntent(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string
  ): Promise<FinancePaymentIntentRecord | undefined> {
    return trx
      .selectFrom("payment_intents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", paymentIntentId)
      .executeTakeFirst();
  }

  async listProviderOrdersByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceProviderOrderRecord[]> {
    return trx
      .selectFrom("payment_provider_orders")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listPaymentEvidenceByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinancePaymentEvidenceRecord[]> {
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("received_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listPaymentEvidenceByIds(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    ids: string[]
  ): Promise<FinancePaymentEvidenceRecord[]> {
    if (ids.length === 0) return [];
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "in", ids)
      .execute();
  }

  async findPaymentEvidence(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentEvidenceId: string
  ): Promise<FinancePaymentEvidenceRecord | undefined> {
    return trx
      .selectFrom("payment_provider_evidence")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("id", "=", paymentEvidenceId)
      .executeTakeFirst();
  }

  async listPaymentSuccessesByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinancePaymentSuccessRecord[]> {
    return trx
      .selectFrom("payment_successes")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listReconciliationsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceReconciliationRecord[]> {
    return trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listReconciliations(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    filters: ReconciliationListFilters,
    cursor: ReconciliationListCursor | null,
    limit: number
  ): Promise<FinanceReconciliationRecord[]> {
    let query = trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId);

    if (filters.status) query = query.where("status", "=", filters.status);
    if (filters.requiredAction) {
      query = query.where("required_action", "=", filters.requiredAction);
    }
    if (filters.reasonCode) query = query.where("reason_code", "=", filters.reasonCode);

    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("created_at", "<", cursor.createdAt),
          eb.and([eb("created_at", "=", cursor.createdAt), eb("id", "<", cursor.id)])
        ])
      );
    }

    return query.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
  }

  async findReconciliation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reconciliationCaseId: string
  ): Promise<FinanceReconciliationRecord | undefined> {
    return trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reconciliationCaseId)
      .executeTakeFirst();
  }

  async listRefundRequestsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceRefundRequestRecord[]> {
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listRefundRequestsByReconciliationIds(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reconciliationCaseIds: string[]
  ): Promise<FinanceRefundRequestRecord[]> {
    if (reconciliationCaseIds.length === 0) return [];
    return trx
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reconciliation_case_id", "in", reconciliationCaseIds)
      .execute();
  }

  async listRefundSubmissionsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceRefundSubmissionRecord[]> {
    return trx
      .selectFrom("payment_refund_submissions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("attempt_sequence", "asc")
      .execute();
  }

  async listRefundSubmissionsByRequestIds(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    refundRequestIds: string[]
  ): Promise<FinanceRefundSubmissionRecord[]> {
    if (refundRequestIds.length === 0) return [];
    return trx
      .selectFrom("payment_refund_submissions")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("refund_request_id", "in", refundRequestIds)
      .orderBy("attempt_sequence", "asc")
      .execute();
  }

  async listRefundProviderEventsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceRefundProviderEventRecord[]> {
    return trx
      .selectFrom("payment_refund_provider_events")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("provider_event_created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listRefundProviderEventsBySubmissionIds(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    refundSubmissionIds: string[]
  ): Promise<FinanceRefundProviderEventRecord[]> {
    if (refundSubmissionIds.length === 0) return [];
    return trx
      .selectFrom("payment_refund_provider_events")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("refund_submission_id", "in", refundSubmissionIds)
      .orderBy("provider_event_created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listRefundFinalizationsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinanceRefundFinalizationRecord[]> {
    return trx
      .selectFrom("payment_refund_finalizations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async listRefundFinalizationsBySubmissionIds(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    refundSubmissionIds: string[]
  ): Promise<FinanceRefundFinalizationRecord[]> {
    if (refundSubmissionIds.length === 0) return [];
    return trx
      .selectFrom("payment_refund_finalizations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("refund_submission_id", "in", refundSubmissionIds)
      .execute();
  }

  async listPaymentEventsByReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<FinancePaymentEventRecord[]> {
    return trx
      .selectFrom("payment_events")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }
}
