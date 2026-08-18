import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError
} from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { ProcessVerifiedPaymentResult } from "../domain/payment-processing.js";
import { PaymentProviderOrderRepository } from "../infrastructure/payment-provider-order-repository.js";
import {
  RazorpayRefundWebhookService,
  type RazorpayRefundWebhookResult
} from "./razorpay-refund-webhook-service.js";
import { VerifiedPaymentEvidenceService } from "./verified-payment-evidence-service.js";
import { VerifiedPaymentProcessor } from "./verified-payment-processor.js";

export interface RazorpayWebhookVerifier {
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
}

export interface RazorpayWebhookInput {
  rawBody: Buffer;
  signature: string;
  providerEventId: string;
}

export interface RazorpayWebhookHandleResult extends JsonObject {
  received: true;
  handled: boolean;
  eventType: string;
  providerEventId: string;
  paymentIntentId: string | null;
  paymentEvidenceId: string | null;
  evidenceCreated: boolean;
  processing: ProcessVerifiedPaymentResult | null;
  refund: RazorpayRefundWebhookResult | null;
}

interface CapturedPayment {
  providerPaymentId: string;
  providerOrderId: string;
  amountMinor: number;
  currencyCode: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("Razorpay webhook payload must contain JSON objects");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maxLength) {
    throw new ValidationError(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function parseWebhookEnvelope(rawBody: Buffer): {
  eventType: string;
  root: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
  } catch {
    throw new ValidationError("Razorpay webhook body is not valid JSON");
  }

  const root = record(parsed);
  if (root["entity"] !== "event") {
    throw new ValidationError("Razorpay webhook entity must be event");
  }

  return {
    eventType: boundedString(root["event"], "event", 100),
    root
  };
}

function parseCapturedPayment(root: Record<string, unknown>): CapturedPayment {
  const payload = record(root["payload"]);
  const paymentWrapper = record(payload["payment"]);
  const payment = record(paymentWrapper["entity"]);

  if (payment["entity"] !== "payment") {
    throw new ValidationError("Razorpay captured webhook must contain a payment entity");
  }

  const providerPaymentId = boundedString(payment["id"], "payment.id");
  const providerOrderId = boundedString(payment["order_id"], "payment.order_id");

  if (!Number.isSafeInteger(payment["amount"]) || (payment["amount"] as number) <= 0) {
    throw new ValidationError("payment.amount must be a positive safe integer");
  }

  const currencyCode = boundedString(payment["currency"], "payment.currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ValidationError("payment.currency must be a three-letter currency code");
  }

  if (payment["status"] !== "captured" || payment["captured"] !== true) {
    throw new ValidationError(
      "payment.captured webhook must contain a captured payment with status captured"
    );
  }

  return {
    providerPaymentId,
    providerOrderId,
    amountMinor: payment["amount"] as number,
    currencyCode
  };
}

function isRefundLifecycleEvent(
  eventType: string
): eventType is "refund.created" | "refund.processed" | "refund.failed" {
  return (
    eventType === "refund.created" ||
    eventType === "refund.processed" ||
    eventType === "refund.failed"
  );
}

export class RazorpayWebhookService {
  private readonly evidence: VerifiedPaymentEvidenceService;
  private readonly processor: VerifiedPaymentProcessor;
  private readonly providerOrders: PaymentProviderOrderRepository;
  private readonly refunds: RazorpayRefundWebhookService;

  constructor(
    private readonly db: Kysely<Database>,
    private readonly verifier: RazorpayWebhookVerifier,
    dependencies: {
      evidence?: VerifiedPaymentEvidenceService;
      processor?: VerifiedPaymentProcessor;
      providerOrders?: PaymentProviderOrderRepository;
      refunds?: RazorpayRefundWebhookService;
    } = {}
  ) {
    this.evidence = dependencies.evidence ?? new VerifiedPaymentEvidenceService();
    this.processor = dependencies.processor ?? new VerifiedPaymentProcessor();
    this.providerOrders = dependencies.providerOrders ?? new PaymentProviderOrderRepository();
    this.refunds = dependencies.refunds ?? new RazorpayRefundWebhookService(db);
  }

  async handle(
    rawInput: RazorpayWebhookInput,
    request: RequestMetadata
  ): Promise<RazorpayWebhookHandleResult> {
    const providerEventId = boundedString(rawInput.providerEventId, "x-razorpay-event-id");
    const signature = boundedString(rawInput.signature, "x-razorpay-signature", 200);

    if (!this.verifier.verifyWebhookSignature(rawInput.rawBody, signature)) {
      throw new AppError(
        "INVALID_WEBHOOK_SIGNATURE",
        401,
        "Razorpay webhook signature verification failed"
      );
    }

    const payloadSha256 = createHash("sha256").update(rawInput.rawBody).digest("hex");
    const envelope = parseWebhookEnvelope(rawInput.rawBody);

    if (isRefundLifecycleEvent(envelope.eventType)) {
      const refund = await this.refunds.handle(
        {
          eventType: envelope.eventType,
          root: envelope.root,
          providerEventId,
          payloadSha256
        },
        request
      );

      return {
        received: true,
        handled: true,
        eventType: envelope.eventType,
        providerEventId,
        paymentIntentId: refund.paymentIntentId,
        paymentEvidenceId: refund.paymentEvidenceId,
        evidenceCreated: false,
        processing: null,
        refund
      };
    }

    if (envelope.eventType !== "payment.captured") {
      return {
        received: true,
        handled: false,
        eventType: envelope.eventType,
        providerEventId,
        paymentIntentId: null,
        paymentEvidenceId: null,
        evidenceCreated: false,
        processing: null,
        refund: null
      };
    }

    const payment = parseCapturedPayment(envelope.root);

    return this.db.transaction().execute(async (trx) => {
      const providerOrder = await this.providerOrders.findByProviderOrderForUpdate(
        trx,
        "RAZORPAY",
        payment.providerOrderId
      );
      if (!providerOrder) {
        throw new NotFoundError(
          "Razorpay provider order is not linked to a Wildleaf payment intent",
          {
            provider: "RAZORPAY",
            providerOrderId: payment.providerOrderId
          }
        );
      }

      if (
        providerOrder.amount_minor !== payment.amountMinor ||
        providerOrder.currency_code !== payment.currencyCode
      ) {
        throw new ConflictError(
          "Captured Razorpay payment does not match the immutable provider-order economics",
          {
            paymentIntentId: providerOrder.payment_intent_id,
            providerOrderId: providerOrder.provider_order_id,
            expectedAmountMinor: providerOrder.amount_minor,
            providerAmountMinor: payment.amountMinor,
            expectedCurrencyCode: providerOrder.currency_code,
            providerCurrencyCode: payment.currencyCode
          }
        );
      }

      const evidence = await this.evidence.record(
        trx,
        {
          organizationId: providerOrder.organization_id,
          propertyId: providerOrder.property_id,
          reservationId: providerOrder.reservation_id,
          paymentIntentId: providerOrder.payment_intent_id,
          provider: "RAZORPAY",
          providerEventId,
          providerPaymentId: payment.providerPaymentId,
          providerOrderId: payment.providerOrderId,
          amountMinor: payment.amountMinor,
          currencyCode: payment.currencyCode,
          verificationMethod: "WEBHOOK_SIGNATURE",
          payloadSha256
        },
        request
      );

      const processing = await this.processor.process(
        trx,
        {
          organizationId: providerOrder.organization_id,
          propertyId: providerOrder.property_id,
          reservationId: providerOrder.reservation_id,
          paymentIntentId: providerOrder.payment_intent_id,
          paymentEvidenceId: evidence.evidence.id
        },
        request
      );

      return {
        received: true,
        handled: true,
        eventType: envelope.eventType,
        providerEventId,
        paymentIntentId: providerOrder.payment_intent_id,
        paymentEvidenceId: evidence.evidence.id,
        evidenceCreated: evidence.created,
        processing,
        refund: null
      };
    });
  }
}
