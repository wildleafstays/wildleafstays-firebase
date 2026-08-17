import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import type {
  PaymentVerificationMethod,
  RecordVerifiedPaymentEvidenceResult
} from "../domain/payment-evidence.js";
import { PaymentEvidenceRepository } from "../infrastructure/payment-evidence-repository.js";
import { PaymentRepository } from "../infrastructure/payment-repository.js";

interface EvidenceInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  provider: string;
  providerEventId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  amountMinor: number;
  currencyCode: string;
  verificationMethod: PaymentVerificationMethod;
  payloadSha256: string;
}

function bounded(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200)
    throw new ValidationError(`${field} must contain between 1 and 200 characters`);
  return normalized;
}

function normalize(input: EvidenceInput): EvidenceInput {
  const provider = input.provider.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,32}$/.test(provider))
    throw new ValidationError(
      "provider must contain 2 to 32 uppercase letters, numbers or underscores"
    );
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode))
    throw new ValidationError("currencyCode must be a three-letter ISO-style code");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0)
    throw new ValidationError("amountMinor must be a non-negative safe integer");
  if (
    input.verificationMethod !== "WEBHOOK_SIGNATURE" &&
    input.verificationMethod !== "PROVIDER_API"
  )
    throw new ValidationError("verificationMethod is not supported");
  const payloadSha256 = input.payloadSha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(payloadSha256))
    throw new ValidationError("payloadSha256 must be a SHA-256 hex digest");
  return {
    ...input,
    provider,
    providerEventId: bounded(input.providerEventId, "providerEventId"),
    providerPaymentId: bounded(input.providerPaymentId, "providerPaymentId"),
    providerOrderId:
      input.providerOrderId === null ? null : bounded(input.providerOrderId, "providerOrderId"),
    currencyCode,
    payloadSha256
  };
}

function assertSame(
  row: {
    payment_intent_id: string;
    organization_id: string;
    property_id: string;
    reservation_id: string;
    provider: string;
    provider_event_id: string;
    provider_payment_id: string;
    provider_order_id: string | null;
    amount_minor: number;
    currency_code: string;
    verification_method: string;
    payload_sha256: string;
  },
  input: EvidenceInput
): void {
  if (!(
    row.payment_intent_id === input.paymentIntentId &&
    row.organization_id === input.organizationId &&
    row.property_id === input.propertyId &&
    row.reservation_id === input.reservationId &&
    row.provider === input.provider &&
    row.provider_event_id === input.providerEventId &&
    row.provider_payment_id === input.providerPaymentId &&
    row.provider_order_id === input.providerOrderId &&
    row.amount_minor === input.amountMinor &&
    row.currency_code === input.currencyCode &&
    row.verification_method === input.verificationMethod &&
    row.payload_sha256 === input.payloadSha256
  )) {
    throw new ConflictError(
      "Provider event or payment identifier is already attached to different verified evidence"
    );
  }
}

export class VerifiedPaymentEvidenceService {
  constructor(
    private readonly evidence = new PaymentEvidenceRepository(),
    private readonly payments = new PaymentRepository(),
    private readonly reservations = new ReservationRepository()
  ) {}

  async record(
    trx: Transaction<Database>,
    rawInput: EvidenceInput,
    request: RequestMetadata
  ): Promise<RecordVerifiedPaymentEvidenceResult> {
    const input = normalize(rawInput);
    const intent = await this.payments.findById(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.paymentIntentId
    );
    if (!intent) throw new NotFoundError("Payment intent not found");
    if (intent.amount_minor !== input.amountMinor || intent.currency_code !== input.currencyCode) {
      throw new ConflictError(
        "Verified provider evidence does not match the immutable payment intent amount and currency",
        {
          paymentIntentId: intent.id,
          expectedAmountMinor: intent.amount_minor,
          expectedCurrencyCode: intent.currency_code
        }
      );
    }

    const [byEvent, byPayment] = await Promise.all([
      this.evidence.findByProviderEvent(trx, input.provider, input.providerEventId),
      this.evidence.findByProviderPayment(trx, input.provider, input.providerPaymentId)
    ]);
    const existing = byEvent ?? byPayment;
    if (existing) {
      assertSame(existing, input);
      return { created: false, evidence: this.evidence.view(existing) };
    }

    const reservation = await this.reservations.findById(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );
    if (!reservation) throw new NotFoundError("Reservation not found");
    if (reservation.status !== "PAYMENT_PENDING")
      throw new ConflictError(
        "Verified provider evidence can be recorded only for a PAYMENT_PENDING reservation",
        { reservationId: reservation.id, reservationStatus: reservation.status }
      );
    if (intent.status !== "PENDING")
      throw new ConflictError(
        "New verified provider evidence can be recorded only for a pending payment intent",
        { paymentIntentId: intent.id, paymentIntentStatus: intent.status }
      );

    const created = await this.evidence.create(trx, { ...input, request });
    if (!created) {
      const raced =
        (await this.evidence.findByProviderEvent(trx, input.provider, input.providerEventId)) ??
        (await this.evidence.findByProviderPayment(trx, input.provider, input.providerPaymentId));
      if (!raced) throw new ConflictError("Verified provider evidence could not be persisted");
      assertSame(raced, input);
      return { created: false, evidence: this.evidence.view(raced) };
    }

    await this.payments.recordEvent(trx, {
      paymentIntentId: intent.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      eventType: "VERIFIED_PAYMENT_EVIDENCE_RECORDED",
      details: {
        evidenceId: created.id,
        provider: created.provider,
        providerEventId: created.provider_event_id,
        providerPaymentId: created.provider_payment_id,
        providerOrderId: created.provider_order_id,
        amountMinor: created.amount_minor,
        currencyCode: created.currency_code,
        verificationMethod: created.verification_method,
        payloadSha256: created.payload_sha256
      },
      actorUserId: null,
      request
    });
    const evidenceView = this.evidence.view(created);
    await new AuditService(trx).record({
      actor: null,
      actorType: "PROVIDER",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "payment.verified_evidence.recorded",
      entityType: "payment_provider_evidence",
      entityId: created.id,
      after: evidenceView,
      request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: "payment_intent",
      aggregateId: intent.id,
      eventType: "payment.verified_evidence.recorded.v1",
      payload: evidenceView
    });
    return { created: true, evidence: evidenceView };
  }
}
