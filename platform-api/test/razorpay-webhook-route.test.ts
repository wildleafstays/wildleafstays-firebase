import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type {
  RazorpayWebhookHandleResult,
  RazorpayWebhookInput
} from "../src/modules/payments/application/razorpay-webhook-service.js";
import {
  registerRazorpayWebhookRoutes,
  type RazorpayWebhookHandler
} from "../src/modules/payments/transport/razorpay-webhook-routes.js";
import type { RequestMetadata } from "../src/shared/http/request-metadata.js";

class CapturingHandler implements RazorpayWebhookHandler {
  calls = 0;
  input: RazorpayWebhookInput | null = null;
  request: RequestMetadata | null = null;

  async handle(
    input: RazorpayWebhookInput,
    request: RequestMetadata
  ): Promise<RazorpayWebhookHandleResult> {
    this.calls += 1;
    this.input = input;
    this.request = request;
    return {
      received: true,
      handled: false,
      eventType: "payment.authorized",
      providerEventId: input.providerEventId,
      paymentIntentId: null,
      paymentEvidenceId: null,
      evidenceCreated: false,
      processing: null,
      refund: null
    };
  }
}

async function testApp(handler: RazorpayWebhookHandler) {
  const app = Fastify({ logger: false });
  app.decorateRequest("correlationId", "route-test-correlation");
  await registerRazorpayWebhookRoutes(app, handler);
  return app;
}

describe("Razorpay webhook transport", () => {
  it("preserves the exact application/json request bytes for webhook signature verification", async () => {
    const handler = new CapturingHandler();
    const app = await testApp(handler);
    const rawBody = '{\n  "entity": "event",\n  "event": "payment.authorized",\n  "value": 1\n}';

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/razorpay",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": "a".repeat(64),
        "x-razorpay-event-id": "evt_route_raw_body_1"
      },
      payload: rawBody
    });

    expect(response.statusCode).toBe(200);
    expect(handler.calls).toBe(1);
    expect(Buffer.isBuffer(handler.input?.rawBody)).toBe(true);
    expect(handler.input?.rawBody.equals(Buffer.from(rawBody, "utf8"))).toBe(true);
    expect(handler.input?.signature).toBe("a".repeat(64));
    expect(handler.input?.providerEventId).toBe("evt_route_raw_body_1");

    await app.close();
  });

  it("keeps Fastify's normal JSON parser unchanged outside the encapsulated webhook route", async () => {
    const handler = new CapturingHandler();
    const app = await testApp(handler);

    app.post("/normal-json", async (request) => ({
      isBuffer: Buffer.isBuffer(request.body),
      body: request.body
    }));

    const response = await app.inject({
      method: "POST",
      url: "/normal-json",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ hello: "world" })
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      isBuffer: false,
      body: { hello: "world" }
    });

    await app.close();
  });

  it("rejects webhook delivery when Razorpay signature or event id headers are missing", async () => {
    const handler = new CapturingHandler();
    const app = await testApp(handler);

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/razorpay",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ entity: "event", event: "payment.captured" })
    });

    expect(response.statusCode).toBe(400);
    expect(handler.calls).toBe(0);

    await app.close();
  });
});
