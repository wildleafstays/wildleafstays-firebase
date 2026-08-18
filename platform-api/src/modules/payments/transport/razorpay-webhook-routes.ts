import type { FastifyInstance } from "fastify";
import { ValidationError } from "../../../shared/errors/app-error.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  RazorpayWebhookHandleResult,
  RazorpayWebhookInput
} from "../application/razorpay-webhook-service.js";

export interface RazorpayWebhookHandler {
  handle(
    input: RazorpayWebhookInput,
    request: ReturnType<typeof requestMetadata>
  ): Promise<RazorpayWebhookHandleResult>;
}

const webhookHeadersSchema = {
  type: "object",
  additionalProperties: true,
  required: ["x-razorpay-signature", "x-razorpay-event-id"],
  properties: {
    "x-razorpay-signature": {
      type: "string",
      minLength: 1,
      maxLength: 200
    },
    "x-razorpay-event-id": {
      type: "string",
      minLength: 1,
      maxLength: 200
    }
  }
} as const;

function requiredHeader(headers: Record<string, unknown>, name: string): string {
  const value = headers[name];
  if (typeof value !== "string") {
    throw new ValidationError(`${name} header is required`);
  }
  return value;
}

export async function registerRazorpayWebhookRoutes(
  app: FastifyInstance,
  handler: RazorpayWebhookHandler
): Promise<void> {
  await app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser("application/json");
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 256 * 1024 },
      (_request, body, done) => {
        done(null, body);
      }
    );

    webhookApp.post<{ Body: Buffer }>(
      "/v1/webhooks/razorpay",
      {
        bodyLimit: 256 * 1024,
        schema: {
          tags: ["Payments"],
          summary: "Receive verified Razorpay payment webhooks",
          description:
            "Receives Razorpay webhooks using the untouched raw request bytes for signature verification. Only payment.captured is converted into canonical verified payment evidence; other valid signed events are acknowledged without changing booking state.",
          headers: webhookHeadersSchema
        }
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) {
          throw new ValidationError("Razorpay webhook body must be received as raw bytes");
        }

        const result = await handler.handle(
          {
            rawBody: request.body,
            signature: requiredHeader(request.headers, "x-razorpay-signature"),
            providerEventId: requiredHeader(request.headers, "x-razorpay-event-id")
          },
          requestMetadata(request, "razorpay-webhook")
        );

        return reply.status(200).send(result);
      }
    );
  });
}
