import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  RoomMixInventoryHoldsTable,
  RoomMixQuoteItemsTable,
  RoomMixQuotesTable
} from "./room-mix-database-types.js";

export type RoomMixQuoteRecord = Selectable<RoomMixQuotesTable>;
export type RoomMixQuoteItemRecord = Selectable<RoomMixQuoteItemsTable>;
export type RoomMixInventoryHoldRecord = Selectable<RoomMixInventoryHoldsTable>;

export class RoomMixRepository {
  async createQuote(
    trx: Transaction<Database>,
    input: Omit<RoomMixQuoteRecord, "id" | "created_at">
  ): Promise<RoomMixQuoteRecord> {
    return trx
      .insertInto("room_mix_quotes")
      .values({ id: randomUUID(), ...input })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createQuoteItem(
    trx: Transaction<Database>,
    input: Omit<RoomMixQuoteItemRecord, "id" | "created_at">
  ): Promise<RoomMixQuoteItemRecord> {
    return trx
      .insertInto("room_mix_quote_items")
      .values({ id: randomUUID(), ...input })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findQuoteForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    roomMixQuoteId: string
  ): Promise<RoomMixQuoteRecord | undefined> {
    return trx
      .selectFrom("room_mix_quotes")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", roomMixQuoteId)
      .forUpdate()
      .executeTakeFirst();
  }

  async listQuoteItems(
    trx: Transaction<Database>,
    roomMixQuoteId: string
  ): Promise<RoomMixQuoteItemRecord[]> {
    return trx
      .selectFrom("room_mix_quote_items")
      .selectAll()
      .where("room_mix_quote_id", "=", roomMixQuoteId)
      .orderBy("item_index")
      .execute();
  }

  async findHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    roomMixQuoteId: string
  ): Promise<RoomMixInventoryHoldRecord | undefined> {
    return trx
      .selectFrom("room_mix_inventory_holds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("room_mix_quote_id", "=", roomMixQuoteId)
      .executeTakeFirst();
  }

  async createHold(
    trx: Transaction<Database>,
    input: {
      roomMixQuoteId: string;
      inventoryHoldId: string;
      organizationId: string;
      propertyId: string;
      request: RequestMetadata;
    }
  ): Promise<RoomMixInventoryHoldRecord> {
    return trx
      .insertInto("room_mix_inventory_holds")
      .values({
        id: randomUUID(),
        room_mix_quote_id: input.roomMixQuoteId,
        inventory_hold_id: input.inventoryHoldId,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
