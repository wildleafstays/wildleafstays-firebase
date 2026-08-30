import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RazorpayProvider,
  RazorpayProviderError,
  type RazorpayFetch
} from "../src/modules/payments/infrastructure/razorpay-provider.js";

const config = {
  keyId: "rzp_test_key",
  keySecret: "test_key_secret",
  webhookSecret: "test_webhook_secret"
};

describe("RazorpayProvider", () => {
  it("verifies checkout signatures using the server-owned order id", () => {
    const provider = new RazorpayProvider(config, async () => {
      throw new Error("network should not be called");
    });
    const paymentId = "pay_test_123";
    const orderId = "order_server_123";
    const signature = createHmac("sha256", config.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(provider.verifyCheckoutSignature(orderId, paymentId, signature)).toBe(true);
    expect(provider.verifyCheckoutSignature("order_tampered", paymentId, signature)).toBe(false);
  });

  it("verifies webhook signatures against the raw body", () => {
    const provider = new RazorpayProvider(config, async () => {
      throw new Error("network should not be called");
    });
    const rawBody = Buffer.from('{"event":"payment.captured","value":1}', "utf8");
    const signature = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");

    expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{"event":"payment.captured","value":2}', "utf8"),
        signature
      )
    ).toBe(false);
  });

  it("creates an order with server credentials and validates provider economics", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const fetchFn: RazorpayFetch = async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(
        JSON.stringify({
          id: "order_test_123",
          amount: 250000,
          amount_paid: 0,
          amount_due: 250000,
          currency: "INR",
          receipt: "PI-ABC123",
          status: "created",
          attempts: 0,
          created_at: 1760000000
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new RazorpayProvider(config, fetchFn);

    const order = await provider.createOrder({
      amountMinor: 250000,
      currencyCode: "inr",
      receipt: "PI-ABC123",
      notes: { paymentIntentId: "intent_123" }
    });

    expect(order.id).toBe("order_test_123");
    expect(observedUrl).toBe("https://api.razorpay.com/v1/orders");
    expect(observedInit?.method).toBe("POST");
    const headers = observedInit?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(
      `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`, "utf8").toString("base64")}`
    );
    expect(JSON.parse(String(observedInit?.body))).toEqual({
      amount: 250000,
      currency: "INR",
      receipt: "PI-ABC123",
      notes: { paymentIntentId: "intent_123" }
    });
  });

  it("can recover provider orders by deterministic receipt", async () => {
    const fetchFn: RazorpayFetch = async (input) => {
      expect(String(input)).toBe(
        "https://api.razorpay.com/v1/orders?receipt=PI-ABC%20123&count=10"
      );
      return new Response(
        JSON.stringify({
          entity: "collection",
          count: 1,
          items: [
            {
              id: "order_recovered",
              amount: 1000,
              amount_paid: 0,
              amount_due: 1000,
              currency: "INR",
              receipt: "PI-ABC 123",
              status: "created",
              attempts: 0,
              created_at: 1760000000
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new RazorpayProvider(config, fetchFn);

    const orders = await provider.findOrdersByReceipt("PI-ABC 123");
    expect(orders).toHaveLength(1);
    expect(orders[0]?.id).toBe("order_recovered");
  });

  it("reads captured payments for an existing provider order", async () => {
    const fetchFn: RazorpayFetch = async (input, init) => {
      expect(String(input)).toBe("https://api.razorpay.com/v1/orders/order_test_123/payments");
      expect(init?.method).toBe("GET");
      return new Response(
        JSON.stringify({
          entity: "collection",
          count: 1,
          items: [
            {
              id: "pay_test_123",
              entity: "payment",
              order_id: "order_test_123",
              amount: 756000,
              currency: "INR",
              status: "captured",
              captured: true,
              created_at: 1788059106
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new RazorpayProvider(config, fetchFn);

    await expect(provider.findPaymentsByOrder("order_test_123")).resolves.toEqual([
      {
        id: "pay_test_123",
        orderId: "order_test_123",
        amount: 756000,
        currency: "INR",
        status: "captured",
        captured: true,
        createdAt: 1788059106
      }
    ]);
  });

  it("rejects a provider response that changes the requested economics", async () => {
    const fetchFn: RazorpayFetch = async () =>
      new Response(
        JSON.stringify({
          id: "order_bad",
          amount: 999,
          amount_paid: 0,
          amount_due: 999,
          currency: "INR",
          receipt: "PI-ABC123",
          status: "created",
          attempts: 0,
          created_at: 1760000000
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const provider = new RazorpayProvider(config, fetchFn);

    await expect(
      provider.createOrder({
        amountMinor: 1000,
        currencyCode: "INR",
        receipt: "PI-ABC123"
      })
    ).rejects.toBeInstanceOf(RazorpayProviderError);
  });

  it("submits a normal refund with deterministic provider idempotency", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const fetchFn: RazorpayFetch = async (input, init) => {
      observedUrl = String(input);
      observedInit = init;
      return new Response(
        JSON.stringify({
          id: "rfnd_test_123",
          entity: "refund",
          amount: 250000,
          currency: "",
          payment_id: "pay_test_123",
          status: "pending",
          created_at: 1760000000
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const provider = new RazorpayProvider(config, fetchFn);

    const refund = await provider.createRefund({
      providerPaymentId: "pay_test_123",
      amountMinor: 250000,
      idempotencyKey: "wl_refund_0123456789abcdef0123456789abcdef_1",
      notes: { refundRequestId: "refund_request_123" }
    });

    expect(refund).toMatchObject({
      id: "rfnd_test_123",
      amount: 250000,
      currency: "",
      paymentId: "pay_test_123",
      status: "pending"
    });
    expect(observedUrl).toBe("https://api.razorpay.com/v1/payments/pay_test_123/refund");
    expect(observedInit?.method).toBe("POST");
    const headers = observedInit?.headers as Record<string, string>;
    expect(headers["x-refund-idempotency"]).toBe("wl_refund_0123456789abcdef0123456789abcdef_1");
    expect(JSON.parse(String(observedInit?.body))).toEqual({
      amount: 250000,
      notes: { refundRequestId: "refund_request_123" }
    });
  });

  it("rejects a refund response that changes the requested payment or amount", async () => {
    const fetchFn: RazorpayFetch = async () =>
      new Response(
        JSON.stringify({
          id: "rfnd_bad",
          entity: "refund",
          amount: 250001,
          currency: "INR",
          payment_id: "pay_test_123",
          status: "processed",
          created_at: 1760000000
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const provider = new RazorpayProvider(config, fetchFn);

    await expect(
      provider.createRefund({
        providerPaymentId: "pay_test_123",
        amountMinor: 250000,
        idempotencyKey: "wl_refund_0123456789abcdef0123456789abcdef_1"
      })
    ).rejects.toBeInstanceOf(RazorpayProviderError);
  });

  it("rejects an invalid refund idempotency key before contacting Razorpay", async () => {
    let calls = 0;
    const provider = new RazorpayProvider(config, async () => {
      calls += 1;
      throw new Error("network should not be called");
    });

    await expect(
      provider.createRefund({
        providerPaymentId: "pay_test_123",
        amountMinor: 250000,
        idempotencyKey: "short"
      })
    ).rejects.toBeInstanceOf(RazorpayProviderError);
    expect(calls).toBe(0);
  });
});
