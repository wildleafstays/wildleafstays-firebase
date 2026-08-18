import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  PaymentReconciliationResolutionCodes,
  type PaymentReconciliationResolutionCode,
  type PaymentReconciliationView
} from "../domain/payment-processing.js";
import { PaymentProcessingRepository } from "../infrastructure/payment-processing-repository.js";
import { PaymentRepository } from "../infrastructure/payment-repository.js";

export interface ManualReconciliationResolutionInput {
  organizationId: string;
  propertyId: string;
  reconciliationCaseId: string;
  resolutionCode: PaymentReconciliationResolutionCode;
  note: string;
}

export interface ManualReconciliationResolutionResult extends JsonObject {
  created: boolean;
  reconciliation: PaymentReconciliationView;
}

function normalizedNote(note: string): string {
  const normalized = note.trim();
  if (normalized.length < 10 || normalized.length > 1000) {
    throw new ValidationError(
      "Manual reconciliation resolution note must be 10 to 1000 characters"
    );
  }
  return normalized;
}

export class PaymentReconciliationCommandService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly processing = new PaymentProcessingRepository(),
    private readonly payments = new PaymentRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async resolveManualReview(
    actor: ActorContext,
    input: ManualReconciliationResolutionInput,
    request: RequestMetadata
  ): Promise<ManualReconciliationResolutionResult> {
    this.authorization.assert(actor, Permissions.SETTLEMENT_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    if (input.resolutionCode !== PaymentReconciliationResolutionCodes.PAYMENT_RETAINED) {
      throw new ValidationError("Unsupported manual reconciliation resolution code", {
        resolutionCode: input.resolutionCode
      });
    }

    const note = normalizedNote(input.note);

    return this.db.transaction().execute(async (trx) => {
      const existing = await this.processing.findScopedReconciliationByIdForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reconciliationCaseId
      );

      if (!existing) {
        throw new NotFoundError("Payment reconciliation case not found");
      }

      if (existing.required_action !== "MANUAL_REVIEW") {
        throw new ConflictError("Only MANUAL_REVIEW reconciliation can be resolved manually", {
          reconciliationCaseId: existing.id,
          requiredAction: existing.required_action,
          status: existing.status
        });
      }

      if (existing.status === "RESOLVED") {
        if (
          existing.resolution_code === input.resolutionCode &&
          existing.resolution_note === note &&
          existing.resolved_by_user_id !== null
        ) {
          return {
            created: false,
            reconciliation: this.processing.reconciliationView(existing)
          };
        }

        throw new ConflictError("Payment reconciliation is already resolved", {
          reconciliationCaseId: existing.id,
          resolutionCode: existing.resolution_code
        });
      }

      if (existing.status !== "OPEN") {
        throw new ConflictError("Payment reconciliation is not open", {
          reconciliationCaseId: existing.id,
          status: existing.status
        });
      }

      const before = this.processing.reconciliationView(existing);
      const resolved = await this.processing.resolveManualReviewReconciliation(trx, {
        reconciliationCaseId: existing.id,
        organizationId: existing.organization_id,
        propertyId: existing.property_id,
        reservationId: existing.reservation_id,
        resolvedAt: new Date(),
        resolvedByUserId: actor.userId,
        resolutionCode: PaymentReconciliationResolutionCodes.PAYMENT_RETAINED,
        resolutionNote: note
      });

      if (!resolved) {
        throw new ConflictError("Payment reconciliation state changed while resolving", {
          reconciliationCaseId: existing.id
        });
      }

      const after = this.processing.reconciliationView(resolved);

      await this.payments.recordEvent(trx, {
        paymentIntentId: resolved.payment_intent_id,
        organizationId: resolved.organization_id,
        propertyId: resolved.property_id,
        reservationId: resolved.reservation_id,
        eventType: "PAYMENT_RECONCILIATION_RESOLVED",
        details: {
          reconciliationCaseId: resolved.id,
          paymentEvidenceId: resolved.payment_evidence_id,
          reasonCode: resolved.reason_code,
          requiredAction: resolved.required_action,
          resolutionCode: input.resolutionCode
        },
        actorUserId: actor.userId,
        request
      });

      await new AuditService(trx).record({
        actor,
        organizationId: resolved.organization_id,
        propertyId: resolved.property_id,
        action: "payment.reconciliation.resolved",
        entityType: "payment_reconciliation_case",
        entityId: resolved.id,
        before,
        after,
        reason: input.resolutionCode,
        request
      });

      await new OutboxService(trx).enqueue({
        aggregateType: "payment_intent",
        aggregateId: resolved.payment_intent_id,
        eventType: "payment.reconciliation.resolved.v1",
        payload: {
          paymentIntentId: resolved.payment_intent_id,
          paymentEvidenceId: resolved.payment_evidence_id,
          reservationId: resolved.reservation_id,
          reconciliationCaseId: resolved.id,
          reasonCode: resolved.reason_code,
          requiredAction: resolved.required_action,
          resolutionCode: input.resolutionCode,
          resolvedByUserId: actor.userId,
          resolutionNote: note,
          resolvedAt: resolved.resolved_at?.toISOString() ?? null
        }
      });

      return {
        created: true,
        reconciliation: after
      };
    });
  }
}
