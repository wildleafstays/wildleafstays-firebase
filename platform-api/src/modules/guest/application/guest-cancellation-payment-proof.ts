import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import { PaymentEvidenceRepository } from "../../payments/infrastructure/payment-evidence-repository.js";
import { PaymentProcessingRepository } from "../../payments/infrastructure/payment-processing-repository.js";
import { PaymentRepository } from "../../payments/infrastructure/payment-repository.js";

export interface GuestCancellationPaymentProofInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  acceptedTotalMinor: number;
  currencyCode: string;
  expectedPaymentIntentId?: string;
  expectedPaymentEvidenceId?: string;
}

export interface GuestCancellationPaymentProof {
  paymentIntentId: string;
  paymentSuccessId: string;
  paymentEvidenceId: string;
  inventoryAllocationId: string;
  provider: string;
  providerPaymentId: string;
  paidMinor: number;
  currencyCode: string;
}

function paymentConflict(message: string, details: Record<string, unknown> = {}): ConflictError {
  return new ConflictError(message, {
    manualReviewRequired: true,
    ...details
  });
}

export class GuestCancellationPaymentProofService {
  constructor(
    private readonly payments = new PaymentRepository(),
    private readonly processing = new PaymentProcessingRepository(),
    private readonly evidence = new PaymentEvidenceRepository()
  ) {}

  async loadCanonical(
    trx: Transaction<Database>,
    input: GuestCancellationPaymentProofInput
  ): Promise<GuestCancellationPaymentProof> {
    if (!Number.isSafeInteger(input.acceptedTotalMinor) || input.acceptedTotalMinor < 0) {
      throw paymentConflict("Reservation accepted total is not valid canonical payment economics");
    }

    if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
      throw paymentConflict("Reservation currency is not valid canonical payment economics");
    }

    const successes = await trx
      .selectFrom("payment_successes")
      .selectAll()
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("reservation_id", "=", input.reservationId)
      .orderBy("created_at", "asc")
      .forUpdate()
      .execute();

    if (successes.length !== 1) {
      throw paymentConflict("Guest cancellation requires exactly one canonical payment success", {
        reservationId: input.reservationId,
        paymentSuccessCount: successes.length
      });
    }

    const success = successes[0];

    if (!success) {
      throw paymentConflict("Canonical payment success is unexpectedly unavailable");
    }

    if (success.outcome !== "RESERVATION_CONFIRMED" || success.inventory_allocation_id === null) {
      throw paymentConflict(
        "Canonical payment success does not represent reservation confirmation",
        {
          paymentSuccessId: success.id,
          outcome: success.outcome
        }
      );
    }

    if (
      input.expectedPaymentIntentId !== undefined &&
      success.payment_intent_id !== input.expectedPaymentIntentId
    ) {
      throw paymentConflict(
        "Expected payment intent does not belong to the canonical reservation payment",
        {
          reservationId: input.reservationId
        }
      );
    }

    if (
      input.expectedPaymentEvidenceId !== undefined &&
      success.payment_evidence_id !== input.expectedPaymentEvidenceId
    ) {
      throw paymentConflict(
        "Expected payment evidence does not belong to the canonical reservation payment",
        {
          reservationId: input.reservationId
        }
      );
    }

    const succeededIntents = await trx
      .selectFrom("payment_intents")
      .select(["id"])
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("reservation_id", "=", input.reservationId)
      .where("status", "=", "SUCCEEDED")
      .forUpdate()
      .execute();

    if (succeededIntents.length !== 1 || succeededIntents[0]?.id !== success.payment_intent_id) {
      throw paymentConflict("Reservation payment intent state is ambiguous", {
        reservationId: input.reservationId,
        succeededIntentCount: succeededIntents.length
      });
    }

    const openReconciliations = await trx
      .selectFrom("payment_reconciliation_cases")
      .select("id")
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("reservation_id", "=", input.reservationId)
      .where("status", "=", "OPEN")
      .forUpdate()
      .execute();

    if (openReconciliations.length !== 0) {
      throw paymentConflict("Reservation has unresolved payment reconciliation", {
        reservationId: input.reservationId,
        openReconciliationCount: openReconciliations.length
      });
    }

    const intent = await this.payments.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      success.payment_intent_id
    );

    if (!intent) {
      throw paymentConflict("Canonical payment intent is missing");
    }

    if (intent.status !== "SUCCEEDED" || intent.purpose !== "RESERVATION_TOTAL") {
      throw paymentConflict(
        "Canonical payment intent is not a successful reservation-total payment",
        {
          paymentIntentId: intent.id,
          status: intent.status,
          purpose: intent.purpose
        }
      );
    }

    if (
      intent.amount_minor !== input.acceptedTotalMinor ||
      intent.currency_code !== input.currencyCode
    ) {
      throw paymentConflict("Canonical payment intent economics do not match the reservation", {
        paymentIntentId: intent.id
      });
    }

    const canonicalSuccess = await this.processing.findSuccessByIntentForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      intent.id
    );

    if (
      !canonicalSuccess ||
      canonicalSuccess.id !== success.id ||
      canonicalSuccess.payment_evidence_id !== success.payment_evidence_id ||
      canonicalSuccess.inventory_allocation_id !== success.inventory_allocation_id ||
      canonicalSuccess.outcome !== "RESERVATION_CONFIRMED"
    ) {
      throw paymentConflict("Canonical payment success identity is inconsistent");
    }

    const evidence = await this.evidence.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      intent.id,
      success.payment_evidence_id
    );

    if (!evidence) {
      throw paymentConflict("Canonical successful payment evidence is missing");
    }

    if (
      evidence.payment_intent_id !== intent.id ||
      evidence.organization_id !== input.organizationId ||
      evidence.property_id !== input.propertyId ||
      evidence.reservation_id !== input.reservationId
    ) {
      throw paymentConflict("Canonical payment evidence identity is inconsistent");
    }

    if (
      evidence.amount_minor !== input.acceptedTotalMinor ||
      evidence.amount_minor !== intent.amount_minor ||
      evidence.currency_code !== input.currencyCode ||
      evidence.currency_code !== intent.currency_code
    ) {
      throw paymentConflict("Canonical payment evidence economics do not match the reservation");
    }

    if (evidence.provider.trim().length === 0 || evidence.provider_payment_id.trim().length === 0) {
      throw paymentConflict("Canonical provider payment identity is incomplete");
    }

    return {
      paymentIntentId: intent.id,
      paymentSuccessId: success.id,
      paymentEvidenceId: evidence.id,
      inventoryAllocationId: success.inventory_allocation_id,
      provider: evidence.provider,
      providerPaymentId: evidence.provider_payment_id,
      paidMinor: evidence.amount_minor,
      currencyCode: evidence.currency_code
    };
  }
}
