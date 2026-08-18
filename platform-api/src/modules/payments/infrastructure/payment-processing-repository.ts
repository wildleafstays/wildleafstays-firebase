import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  PaymentProcessingOutcome,
  PaymentReconciliationAction,
  PaymentReconciliationReason,
  PaymentReconciliationResolutionCode,
  PaymentReconciliationView,
  PaymentSuccessView
} from "../domain/payment-processing.js";
import type {
  PaymentReconciliationCasesTable,
  PaymentSuccessesTable
} from "./payment-processing-database-types.js";

export type PaymentSuccessRecord = Selectable<PaymentSuccessesTable>;
export type PaymentReconciliationRecord = Selectable<PaymentReconciliationCasesTable>;

function successView(row: PaymentSuccessRecord): PaymentSuccessView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    outcome: row.outcome as PaymentProcessingOutcome,
    inventoryAllocationId: row.inventory_allocation_id,
    createdAt: row.created_at.toISOString()
  };
}

function reconciliationView(row: PaymentReconciliationRecord): PaymentReconciliationView {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    paymentEvidenceId: row.payment_evidence_id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    reservationId: row.reservation_id,
    reasonCode: row.reason_code as PaymentReconciliationReason,
    requiredAction: row.required_action as PaymentReconciliationAction,
    status: row.status as "OPEN" | "RESOLVED",
    details: row.details_json,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedByUserId: row.resolved_by_user_id,
    resolutionCode: row.resolution_code as PaymentReconciliationResolutionCode | null,
    resolutionNote: row.resolution_note
  };
}

export class PaymentProcessingRepository {
  async findSuccessByIntentForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    paymentIntentId: string
  ): Promise<PaymentSuccessRecord | undefined> {
    return trx
      .selectFrom("payment_successes")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("payment_intent_id", "=", paymentIntentId)
      .forUpdate()
      .executeTakeFirst();
  }

  async createSuccess(
    trx: Transaction<Database>,
    input: {
      paymentIntentId: string;
      paymentEvidenceId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      outcome: PaymentProcessingOutcome;
      inventoryAllocationId: string | null;
      request: RequestMetadata;
    }
  ): Promise<PaymentSuccessRecord | undefined> {
    return trx
      .insertInto("payment_successes")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        outcome: input.outcome,
        inventory_allocation_id: input.inventoryAllocationId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async findReconciliationByEvidence(
    trx: Transaction<Database>,
    paymentEvidenceId: string
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("payment_evidence_id", "=", paymentEvidenceId)
      .executeTakeFirst();
  }

  async findReconciliationByIdForUpdate(
    trx: Transaction<Database>,
    reconciliationCaseId: string
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("id", "=", reconciliationCaseId)
      .forUpdate()
      .executeTakeFirst();
  }

  async findScopedReconciliationByIdForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reconciliationCaseId: string
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .selectFrom("payment_reconciliation_cases")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reconciliationCaseId)
      .forUpdate()
      .executeTakeFirst();
  }

  async resolveRefundRequiredReconciliation(
    trx: Transaction<Database>,
    input: {
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      resolvedAt: Date;
      resolutionNote: string;
    }
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .updateTable("payment_reconciliation_cases")
      .set({
        status: "RESOLVED",
        resolved_at: input.resolvedAt,
        resolved_by_user_id: null,
        resolution_code: "PROVIDER_REFUND_PROCESSED",
        resolution_note: input.resolutionNote
      })
      .where("id", "=", input.reconciliationCaseId)
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("reservation_id", "=", input.reservationId)
      .where("required_action", "=", "REFUND_REQUIRED")
      .where("status", "=", "OPEN")
      .returningAll()
      .executeTakeFirst();
  }

  async resolveManualReviewReconciliation(
    trx: Transaction<Database>,
    input: {
      reconciliationCaseId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      resolvedAt: Date;
      resolvedByUserId: string;
      resolutionCode: "PAYMENT_RETAINED";
      resolutionNote: string;
    }
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .updateTable("payment_reconciliation_cases")
      .set({
        status: "RESOLVED",
        resolved_at: input.resolvedAt,
        resolved_by_user_id: input.resolvedByUserId,
        resolution_code: input.resolutionCode,
        resolution_note: input.resolutionNote
      })
      .where("id", "=", input.reconciliationCaseId)
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("reservation_id", "=", input.reservationId)
      .where("required_action", "=", "MANUAL_REVIEW")
      .where("status", "=", "OPEN")
      .returningAll()
      .executeTakeFirst();
  }

  async createReconciliation(
    trx: Transaction<Database>,
    input: {
      paymentIntentId: string;
      paymentEvidenceId: string;
      organizationId: string;
      propertyId: string;
      reservationId: string;
      reasonCode: PaymentReconciliationReason;
      requiredAction: PaymentReconciliationAction;
      details: JsonObject;
      request: RequestMetadata;
    }
  ): Promise<PaymentReconciliationRecord | undefined> {
    return trx
      .insertInto("payment_reconciliation_cases")
      .values({
        id: randomUUID(),
        payment_intent_id: input.paymentIntentId,
        payment_evidence_id: input.paymentEvidenceId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        reason_code: input.reasonCode,
        required_action: input.requiredAction,
        status: "OPEN",
        details_json: input.details,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId,
        resolved_at: null,
        resolved_by_user_id: null,
        resolution_note: null
      })
      .onConflict((conflict) => conflict.column("payment_evidence_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  successView(row: PaymentSuccessRecord): PaymentSuccessView {
    return successView(row);
  }

  reconciliationView(row: PaymentReconciliationRecord): PaymentReconciliationView {
    return reconciliationView(row);
  }
}
