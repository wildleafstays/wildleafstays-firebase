import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { RazorpayPayment } from "../infrastructure/razorpay-provider.js";
import { PaymentProviderOrderRepository } from "../infrastructure/payment-provider-order-repository.js";
import { VerifiedPaymentEvidenceService } from "./verified-payment-evidence-service.js";
import { VerifiedPaymentProcessor } from "./verified-payment-processor.js";

export interface RazorpayPaymentRecoveryGateway {
  findPaymentsByOrder(providerOrderId: string): Promise<RazorpayPayment[]>;
}

interface RecoverInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
}

export class RazorpayPaymentRecoveryService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly provider: RazorpayPaymentRecoveryGateway,
    private readonly providerOrders = new PaymentProviderOrderRepository(),
    private readonly evidence = new VerifiedPaymentEvidenceService(),
    private readonly processor = new VerifiedPaymentProcessor()
  ) {}

  async recover(input: RecoverInput, request: RequestMetadata): Promise<boolean> {
    const providerOrder = await this.db
      .transaction()
      .execute((trx) =>
        this.providerOrders.findByIntent(
          trx,
          input.organizationId,
          input.propertyId,
          input.reservationId,
          input.paymentIntentId
        )
      );
    if (!providerOrder) return false;

    const payments = await this.provider.findPaymentsByOrder(providerOrder.provider_order_id);
    const captured = payments.filter(
      (payment) => payment.status === "captured" && payment.captured === true
    );
    const matching = captured.filter(
      (payment) =>
        payment.orderId === providerOrder.provider_order_id &&
        payment.amount === providerOrder.amount_minor &&
        payment.currency === providerOrder.currency_code
    );

    if (matching.length === 0) {
      if (captured.length > 0) {
        throw new ConflictError(
          "Captured Razorpay payment does not match the immutable provider-order economics",
          { paymentIntentId: providerOrder.payment_intent_id }
        );
      }
      return false;
    }
    if (matching.length > 1) {
      throw new ConflictError("Multiple captured Razorpay payments require reconciliation", {
        paymentIntentId: providerOrder.payment_intent_id
      });
    }

    const payment = matching[0]!;
    const normalizedPayload = JSON.stringify({
      amount: payment.amount,
      captured: payment.captured,
      createdAt: payment.createdAt,
      currency: payment.currency,
      id: payment.id,
      orderId: payment.orderId,
      status: payment.status
    });
    const payloadSha256 = createHash("sha256").update(normalizedPayload).digest("hex");

    await this.db.transaction().execute(async (trx) => {
      const lockedOrder = await this.providerOrders.findByProviderOrderForUpdate(
        trx,
        "RAZORPAY",
        providerOrder.provider_order_id
      );
      if (!lockedOrder) {
        throw new ConflictError("Razorpay provider order disappeared during payment recovery");
      }
      if (
        lockedOrder.payment_intent_id !== input.paymentIntentId ||
        lockedOrder.organization_id !== input.organizationId ||
        lockedOrder.property_id !== input.propertyId ||
        lockedOrder.reservation_id !== input.reservationId ||
        lockedOrder.amount_minor !== payment.amount ||
        lockedOrder.currency_code !== payment.currency
      ) {
        throw new ConflictError("Razorpay payment recovery context changed unexpectedly", {
          paymentIntentId: input.paymentIntentId
        });
      }

      const recorded = await this.evidence.record(
        trx,
        {
          organizationId: lockedOrder.organization_id,
          propertyId: lockedOrder.property_id,
          reservationId: lockedOrder.reservation_id,
          paymentIntentId: lockedOrder.payment_intent_id,
          provider: "RAZORPAY",
          providerEventId: `provider-api:${payment.id}`,
          providerPaymentId: payment.id,
          providerOrderId: payment.orderId,
          amountMinor: payment.amount,
          currencyCode: payment.currency,
          verificationMethod: "PROVIDER_API",
          payloadSha256
        },
        request
      );

      await this.processor.process(
        trx,
        {
          organizationId: lockedOrder.organization_id,
          propertyId: lockedOrder.property_id,
          reservationId: lockedOrder.reservation_id,
          paymentIntentId: lockedOrder.payment_intent_id,
          paymentEvidenceId: recorded.evidence.id,
          providerCapturedAt: new Date(payment.createdAt * 1000)
        },
        request
      );
    });

    return true;
  }
}
