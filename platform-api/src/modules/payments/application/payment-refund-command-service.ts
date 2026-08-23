import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type { PaymentRefundSubmissionView } from "../domain/payment-refund.js";
import { PaymentFinanceReadRepository } from "../infrastructure/payment-finance-read-repository.js";
import { PaymentRefundRequestRepository } from "../infrastructure/payment-refund-repository.js";
import {
  RazorpayRefundSubmissionService,
  type RazorpayRefundGateway
} from "./razorpay-refund-submission-service.js";

export interface SafePaymentRefundSubmissionView extends JsonObject {
  id: string;
  refundRequestId: string;
  attemptSequence: number;
  paymentIntentId: string;
  paymentEvidenceId: string;
  reconciliationCaseId: string;
  provider: string;
  providerPaymentId: string;
  providerRefundId: string;
  amountMinor: number;
  currencyCode: string;
  initialProviderStatus: string;
  providerCreatedAt: string;
  createdAt: string;
}

export interface PaymentRefundCommandResult extends JsonObject {
  created: boolean;
  reconciliationCaseId: string;
  refundRequestId: string;
  submission: SafePaymentRefundSubmissionView;
}

interface SubmitRefundCommandInput {
  organizationId: string;
  propertyId: string;
  reconciliationCaseId: string;
}

function safeSubmission(view: PaymentRefundSubmissionView): SafePaymentRefundSubmissionView {
  return {
    id: view.id,
    refundRequestId: view.refundRequestId,
    attemptSequence: view.attemptSequence,
    paymentIntentId: view.paymentIntentId,
    paymentEvidenceId: view.paymentEvidenceId,
    reconciliationCaseId: view.reconciliationCaseId,
    provider: view.provider,
    providerPaymentId: view.providerPaymentId,
    providerRefundId: view.providerRefundId,
    amountMinor: view.amountMinor,
    currencyCode: view.currencyCode,
    initialProviderStatus: view.initialProviderStatus,
    providerCreatedAt: view.providerCreatedAt,
    createdAt: view.createdAt
  };
}

export class PaymentRefundCommandService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly provider: RazorpayRefundGateway,
    private readonly finance = new PaymentFinanceReadRepository(),
    private readonly refunds = new PaymentRefundRequestRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async submit(
    actor: ActorContext,
    input: SubmitRefundCommandInput,
    request: RequestMetadata
  ): Promise<PaymentRefundCommandResult> {
    this.authorization.assert(actor, Permissions.SETTLEMENT_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const target = await this.db.transaction().execute(async (trx) => {
      const reconciliation = await this.finance.findReconciliation(
        trx,
        input.organizationId,
        input.propertyId,
        input.reconciliationCaseId
      );
      if (!reconciliation) throw new NotFoundError("Payment reconciliation case not found");

      if (reconciliation.required_action !== "REFUND_REQUIRED") {
        throw new ConflictError("Payment reconciliation does not authorize a provider refund", {
          reconciliationCaseId: reconciliation.id,
          requiredAction: reconciliation.required_action,
          status: reconciliation.status
        });
      }

      const refund = await this.refunds.findByReconciliationCase(
        trx,
        input.organizationId,
        input.propertyId,
        reconciliation.reservation_id,
        reconciliation.id
      );
      if (!refund) {
        throw new ConflictError("Refund-required reconciliation has no canonical refund request", {
          reconciliationCaseId: reconciliation.id
        });
      }

      if (
        refund.reconciliation_case_id !== reconciliation.id ||
        refund.payment_intent_id !== reconciliation.payment_intent_id ||
        refund.payment_evidence_id !== reconciliation.payment_evidence_id ||
        refund.organization_id !== reconciliation.organization_id ||
        refund.property_id !== reconciliation.property_id ||
        refund.reservation_id !== reconciliation.reservation_id ||
        refund.reason_code !== reconciliation.reason_code
      ) {
        throw new ConflictError("Canonical refund request does not match its reconciliation case", {
          reconciliationCaseId: reconciliation.id,
          refundRequestId: refund.id
        });
      }

      return {
        reconciliationCaseId: reconciliation.id,
        reservationId: reconciliation.reservation_id,
        refundRequestId: refund.id
      };
    });

    const result = await new RazorpayRefundSubmissionService(this.db, this.provider).submit(
      {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: target.reservationId,
        refundRequestId: target.refundRequestId
      },
      request,
      actor
    );

    return {
      created: result.created,
      reconciliationCaseId: target.reconciliationCaseId,
      refundRequestId: target.refundRequestId,
      submission: safeSubmission(result.submission)
    };
  }
}
