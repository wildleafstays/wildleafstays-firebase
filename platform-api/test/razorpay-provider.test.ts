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
});
