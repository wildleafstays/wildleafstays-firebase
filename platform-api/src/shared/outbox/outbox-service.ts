import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../infrastructure/database/types.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export class OutboxService {
  constructor(private readonly db: DbExecutor) {}

  async enqueue(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: JsonObject;
  }): Promise<string> {
    const id = randomUUID();
    await this.db
      .insertInto("outbox_events")
      .values({
        id,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        event_type: input.eventType,
        payload: input.payload,
        processed_at: null,
        last_error: null
      })
      .executeTakeFirst();
    return id;
  }
}
