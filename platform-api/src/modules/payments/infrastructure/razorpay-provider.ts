import { createHmac, timingSafeEqual } from "node:crypto";

export interface RazorpayProviderConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  apiBaseUrl?: string;
}

export interface RazorpayCreateOrderInput {
  amountMinor: number;
  currencyCode: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  receipt: string;
  status: "created" | "attempted" | "paid";
  attempts: number;
  createdAt: number;
}

export interface RazorpayPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  captured: boolean;
  createdAt: number;
}

export interface RazorpayCreateRefundInput {
  providerPaymentId: string;
  amountMinor: number;
  idempotencyKey: string;
  notes?: Record<string, string>;
}

export interface RazorpayRefund {
  id: string;
  amount: number;
  currency: string;
  paymentId: string;
  status: "pending" | "processed" | "failed";
  createdAt: number;
}

export type RazorpayFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class RazorpayProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null
  ) {
    super(message);
    this.name = "RazorpayProviderError";
  }
}

interface RazorpayOrderWire {
  id?: unknown;
  amount?: unknown;
  amount_paid?: unknown;
  amount_due?: unknown;
  currency?: unknown;
  receipt?: unknown;
  status?: unknown;
  attempts?: unknown;
  created_at?: unknown;
}

interface RazorpayRefundWire {
  id?: unknown;
  entity?: unknown;
  amount?: unknown;
  currency?: unknown;
  payment_id?: unknown;
  status?: unknown;
  created_at?: unknown;
}

interface RazorpayPaymentWire {
  id?: unknown;
  entity?: unknown;
  order_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
  captured?: unknown;
  created_at?: unknown;
}

function requiredSecret(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1) throw new RazorpayProviderError(`${field} is required`);
  return normalized;
}

function normalizedBaseUrl(value: string | undefined): string {
  const normalized = (value ?? "https://api.razorpay.com").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(normalized)) {
    throw new RazorpayProviderError("apiBaseUrl must be an HTTPS origin");
  }
  return normalized;
}

function normalizedReceipt(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 40) {
    throw new RazorpayProviderError("receipt must contain between 1 and 40 characters");
  }
  return normalized;
}

function normalizedCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new RazorpayProviderError("currencyCode must be a three-letter code");
  }
  return normalized;
}

function normalizedProviderIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new RazorpayProviderError(`${field} must contain between 1 and 200 characters`);
  }
  return normalized;
}

function normalizedRefundIdempotency(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 10 || normalized.length > 200 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new RazorpayProviderError(
      "refund idempotency key must be 10 to 200 alphanumeric, underscore or hyphen characters"
    );
  }
  return normalized;
}

function normalizedNotes(
  notes: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!notes) return undefined;
  const entries = Object.entries(notes);
  if (entries.length > 15) {
    throw new RazorpayProviderError("notes cannot contain more than 15 entries");
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    if (normalizedKey.length < 1 || normalizedKey.length > 256 || normalizedValue.length > 256) {
      throw new RazorpayProviderError(
        "each Razorpay note key must be 1 to 256 characters and each value at most 256 characters"
      );
    }
    normalized[normalizedKey] = normalizedValue;
  }
  return normalized;
}

function parseOrder(value: unknown): RazorpayOrder {
  if (typeof value !== "object" || value === null) {
    throw new RazorpayProviderError("Razorpay returned an invalid order response");
  }
  const row = value as RazorpayOrderWire;
  if (
    typeof row.id !== "string" ||
    typeof row.amount !== "number" ||
    typeof row.amount_paid !== "number" ||
    typeof row.amount_due !== "number" ||
    typeof row.currency !== "string" ||
    typeof row.receipt !== "string" ||
    (row.status !== "created" && row.status !== "attempted" && row.status !== "paid") ||
    typeof row.attempts !== "number" ||
    typeof row.created_at !== "number"
  ) {
    throw new RazorpayProviderError("Razorpay returned an incomplete order response");
  }
  return {
    id: row.id,
    amount: row.amount,
    amountPaid: row.amount_paid,
    amountDue: row.amount_due,
    currency: row.currency,
    receipt: row.receipt,
    status: row.status,
    attempts: row.attempts,
    createdAt: row.created_at
  };
}

function parseRefund(value: unknown): RazorpayRefund {
  if (typeof value !== "object" || value === null) {
    throw new RazorpayProviderError("Razorpay returned an invalid refund response");
  }
  const row = value as RazorpayRefundWire;
  if (
    typeof row.id !== "string" ||
    row.id.trim().length < 1 ||
    row.entity !== "refund" ||
    typeof row.amount !== "number" ||
    !Number.isSafeInteger(row.amount) ||
    row.amount <= 0 ||
    typeof row.currency !== "string" ||
    typeof row.payment_id !== "string" ||
    row.payment_id.trim().length < 1 ||
    (row.status !== "pending" && row.status !== "processed" && row.status !== "failed") ||
    typeof row.created_at !== "number" ||
    !Number.isSafeInteger(row.created_at) ||
    row.created_at <= 0
  ) {
    throw new RazorpayProviderError("Razorpay returned an incomplete refund response");
  }

  const currency = row.currency.trim().toUpperCase();
  if (currency.length > 0 && !/^[A-Z]{3}$/.test(currency)) {
    throw new RazorpayProviderError("Razorpay returned an invalid refund currency");
  }

  return {
    id: row.id.trim(),
    amount: row.amount,
    currency,
    paymentId: row.payment_id.trim(),
    status: row.status,
    createdAt: row.created_at
  };
}

function parsePayment(value: unknown): RazorpayPayment {
  if (typeof value !== "object" || value === null) {
    throw new RazorpayProviderError("Razorpay returned an invalid payment response");
  }
  const row = value as RazorpayPaymentWire;
  if (
    typeof row.id !== "string" ||
    row.id.trim().length < 1 ||
    row.entity !== "payment" ||
    typeof row.order_id !== "string" ||
    row.order_id.trim().length < 1 ||
    typeof row.amount !== "number" ||
    !Number.isSafeInteger(row.amount) ||
    row.amount <= 0 ||
    typeof row.currency !== "string" ||
    !["created", "authorized", "captured", "refunded", "failed"].includes(String(row.status)) ||
    typeof row.captured !== "boolean" ||
    typeof row.created_at !== "number" ||
    !Number.isSafeInteger(row.created_at) ||
    row.created_at <= 0
  ) {
    throw new RazorpayProviderError("Razorpay returned an incomplete payment response");
  }

  const currency = row.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RazorpayProviderError("Razorpay returned an invalid payment currency");
  }

  return {
    id: row.id.trim(),
    orderId: row.order_id.trim(),
    amount: row.amount,
    currency,
    status: row.status as RazorpayPayment["status"],
    captured: row.captured,
    createdAt: row.created_at
  };
}

function verifyHexSignature(message: string | Buffer, received: string, secret: string): boolean {
  const normalized = received.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) return false;
  const expected = createHmac("sha256", secret).update(message).digest();
  const actual = Buffer.from(normalized, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class RazorpayProvider {
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly apiBaseUrl: string;

  constructor(
    config: RazorpayProviderConfig,
    private readonly fetchFn: RazorpayFetch = fetch
  ) {
    this.keyId = requiredSecret(config.keyId, "Razorpay keyId");
    this.keySecret = requiredSecret(config.keySecret, "Razorpay keySecret");
    this.webhookSecret = requiredSecret(config.webhookSecret, "Razorpay webhookSecret");
    this.apiBaseUrl = normalizedBaseUrl(config.apiBaseUrl);
  }

  publicKeyId(): string {
    return this.keyId;
  }

  verifyCheckoutSignature(serverOrderId: string, paymentId: string, signature: string): boolean {
    const orderId = requiredSecret(serverOrderId, "serverOrderId");
    const normalizedPaymentId = requiredSecret(paymentId, "paymentId");
    return verifyHexSignature(`${orderId}|${normalizedPaymentId}`, signature, this.keySecret);
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHexSignature(rawBody, signature, this.webhookSecret);
  }

  private authorizationHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`, "utf8").toString("base64")}`;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          authorization: this.authorizationHeader(),
          accept: "application/json",
          ...init.headers
        }
      });
    } catch {
      throw new RazorpayProviderError("Razorpay request failed before a response was received");
    }

    if (!response.ok) {
      throw new RazorpayProviderError(
        `Razorpay request failed with HTTP ${response.status}`,
        response.status
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new RazorpayProviderError("Razorpay returned invalid JSON", response.status);
    }
  }

  async createOrder(input: RazorpayCreateOrderInput): Promise<RazorpayOrder> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new RazorpayProviderError("amountMinor must be a positive safe integer");
    }
    const currency = normalizedCurrency(input.currencyCode);
    const receipt = normalizedReceipt(input.receipt);
    const notes = normalizedNotes(input.notes);

    const body: {
      amount: number;
      currency: string;
      receipt: string;
      notes?: Record<string, string>;
    } = {
      amount: input.amountMinor,
      currency,
      receipt
    };
    if (notes) body.notes = notes;

    const order = parseOrder(
      await this.request("/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    );

    if (
      order.amount !== input.amountMinor ||
      order.currency !== currency ||
      order.receipt !== receipt
    ) {
      throw new RazorpayProviderError(
        "Razorpay order response does not match the requested amount, currency and receipt"
      );
    }
    return order;
  }

  async findOrdersByReceipt(receiptInput: string): Promise<RazorpayOrder[]> {
    const receipt = normalizedReceipt(receiptInput);
    const result = await this.request(
      `/v1/orders?receipt=${encodeURIComponent(receipt)}&count=10`,
      { method: "GET" }
    );
    if (typeof result !== "object" || result === null) {
      throw new RazorpayProviderError("Razorpay returned an invalid order collection");
    }
    const items = (result as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new RazorpayProviderError("Razorpay returned an invalid order collection");
    }
    return items.map(parseOrder);
  }

  async findPaymentsByOrder(providerOrderIdInput: string): Promise<RazorpayPayment[]> {
    const providerOrderId = normalizedProviderIdentifier(providerOrderIdInput, "providerOrderId");
    const result = await this.request(
      `/v1/orders/${encodeURIComponent(providerOrderId)}/payments`,
      { method: "GET" }
    );
    if (typeof result !== "object" || result === null) {
      throw new RazorpayProviderError("Razorpay returned an invalid payment collection");
    }
    const items = (result as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new RazorpayProviderError("Razorpay returned an invalid payment collection");
    }
    return items.map(parsePayment);
  }

  async createRefund(input: RazorpayCreateRefundInput): Promise<RazorpayRefund> {
    const providerPaymentId = normalizedProviderIdentifier(
      input.providerPaymentId,
      "providerPaymentId"
    );
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new RazorpayProviderError("amountMinor must be a positive safe integer");
    }
    const idempotencyKey = normalizedRefundIdempotency(input.idempotencyKey);
    const notes = normalizedNotes(input.notes);

    const body: {
      amount: number;
      notes?: Record<string, string>;
    } = {
      amount: input.amountMinor
    };
    if (notes) body.notes = notes;

    const refund = parseRefund(
      await this.request(`/v1/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-refund-idempotency": idempotencyKey
        },
        body: JSON.stringify(body)
      })
    );

    if (refund.amount !== input.amountMinor || refund.paymentId !== providerPaymentId) {
      throw new RazorpayProviderError(
        "Razorpay refund response does not match the requested payment and amount"
      );
    }
    return refund;
  }
}
