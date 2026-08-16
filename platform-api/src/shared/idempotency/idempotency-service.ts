import { createHash, randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../infrastructure/database/types.js";
import { ConflictError, ValidationError } from "../errors/app-error.js";

export interface IdempotentExecution<T extends JsonObject> {
  body: T;
  statusCode: number;
  replayed: boolean;
}

export interface IdempotencyInput {
  scopeKey: string;
  key: string;
  requestBody: JsonObject;
  ttlMs?: number;
}

export class IdempotencyService {
  constructor(private readonly db: Kysely<Database>) {}

  async execute<T extends JsonObject>(
    input: IdempotencyInput,
    operation: (trx: Transaction<Database>) => Promise<{ body: T; statusCode: number }>
  ): Promise<IdempotentExecution<T>> {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(input.key)) {
      throw new ValidationError("Invalid idempotency key format");
    }

    const requestHash = hashRequest(input.requestBody);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 24 * 60 * 60 * 1000));

    return this.db.transaction().execute(async (trx) => {
      const insertResult = await trx
        .insertInto("idempotency_keys")
        .values({
          id: randomUUID(),
          scope_key: input.scopeKey,
          idempotency_key: input.key,
          request_hash: requestHash,
          state: "STARTED",
          response_status: null,
          response_body: null,
          expires_at: expiresAt
        })
        .onConflict((conflict) => conflict.columns(["scope_key", "idempotency_key"]).doNothing())
        .returning("id")
        .executeTakeFirst();

      const inserted = Boolean(insertResult);
      const row = await trx
        .selectFrom("idempotency_keys")
        .selectAll()
        .where("scope_key", "=", input.scopeKey)
        .where("idempotency_key", "=", input.key)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (row.request_hash !== requestHash) {
        throw new ConflictError("Idempotency key was already used with a different request");
      }

      const expired = row.expires_at.getTime() <= now.getTime();
      if (!expired && row.state === "COMPLETED" && row.response_body && row.response_status) {
        return {
          body: row.response_body as T,
          statusCode: row.response_status,
          replayed: true
        };
      }

      if (!inserted && !expired && row.state === "STARTED") {
        throw new ConflictError("An identical request is already in progress");
      }

      if (!inserted) {
        await trx
          .updateTable("idempotency_keys")
          .set({
            state: "STARTED",
            response_status: null,
            response_body: null,
            expires_at: expiresAt,
            updated_at: now
          })
          .where("id", "=", row.id)
          .executeTakeFirst();
      }

      const result = await operation(trx);
      await trx
        .updateTable("idempotency_keys")
        .set({
          state: "COMPLETED",
          response_status: result.statusCode,
          response_body: result.body,
          updated_at: new Date()
        })
        .where("id", "=", row.id)
        .executeTakeFirst();

      return { ...result, replayed: false };
    });
  }
}

export function hashRequest(value: JsonObject): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
