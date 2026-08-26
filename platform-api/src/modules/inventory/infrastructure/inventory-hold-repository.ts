import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { InventoryBucketRecord } from "./inventory-repository.js";
import type {
  InventoryHoldItemsTable,
  InventoryHoldNightsTable,
  InventoryHoldsTable
} from "./inventory-hold-database-types.js";

export type InventoryHoldRecord = Selectable<InventoryHoldsTable>;
export type InventoryHoldItemRecord = Selectable<InventoryHoldItemsTable>;
export type InventoryHoldNightRecord = Selectable<InventoryHoldNightsTable>;

export class InventoryHoldRepository {
  async createHold(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      startDate: string;
      endDate: string;
      expiresAt: Date;
      clientReference: string | null;
      createdByUserId: string | null;
    }
  ): Promise<InventoryHoldRecord> {
    return trx
      .insertInto("inventory_holds")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        start_date: input.startDate,
        end_date: input.endDate,
        expires_at: input.expiresAt,
        client_reference: input.clientReference,
        created_by_user_id: input.createdByUserId,
        released_by_user_id: null,
        released_at: null,
        release_reason: null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createItem(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      holdId: string;
      bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY";
      roomCategoryId: string | null;
      quantity: number;
    }
  ): Promise<InventoryHoldItemRecord> {
    return trx
      .insertInto("inventory_hold_items")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        hold_id: input.holdId,
        bucket_type: input.bucketType,
        room_category_id: input.roomCategoryId,
        quantity: input.quantity
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createNight(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      holdId: string;
      holdItemId: string;
      bucketId: string;
      stayDate: string;
      quantity: number;
    }
  ): Promise<void> {
    await trx
      .insertInto("inventory_hold_nights")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        hold_id: input.holdId,
        hold_item_id: input.holdItemId,
        bucket_id: input.bucketId,
        stay_date: input.stayDate,
        quantity: input.quantity
      })
      .execute();
  }

  async findHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    holdId: string
  ): Promise<InventoryHoldRecord | undefined> {
    return trx
      .selectFrom("inventory_holds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", holdId)
      .executeTakeFirst();
  }

  async findHoldForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    holdId: string
  ): Promise<InventoryHoldRecord | undefined> {
    return trx
      .selectFrom("inventory_holds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", holdId)
      .forUpdate()
      .executeTakeFirst();
  }

  async listItems(trx: Transaction<Database>, holdId: string): Promise<InventoryHoldItemRecord[]> {
    return trx
      .selectFrom("inventory_hold_items")
      .selectAll()
      .where("hold_id", "=", holdId)
      .orderBy("created_at")
      .execute();
  }

  async listNights(
    trx: Transaction<Database>,
    holdId: string
  ): Promise<InventoryHoldNightRecord[]> {
    return trx
      .selectFrom("inventory_hold_nights")
      .selectAll()
      .where("hold_id", "=", holdId)
      .orderBy("stay_date")
      .orderBy("hold_item_id")
      .execute();
  }

  async listDueHoldsForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    now: Date,
    limit: number
  ): Promise<InventoryHoldRecord[]> {
    return trx
      .selectFrom("inventory_holds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .where("expires_at", "<=", now)
      .orderBy("expires_at")
      .limit(limit)
      .forUpdate()
      .execute();
  }

  async lockPropertyBuckets(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<InventoryBucketRecord[]> {
    return trx
      .selectFrom("inventory_daily_buckets")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("stay_date")
      .orderBy("bucket_type")
      .orderBy("room_category_id")
      .forUpdate()
      .execute();
  }

  async lockBucketsByIds(
    trx: Transaction<Database>,
    bucketIds: string[]
  ): Promise<InventoryBucketRecord[]> {
    if (bucketIds.length === 0) {
      return [];
    }

    return trx
      .selectFrom("inventory_daily_buckets")
      .selectAll()
      .where("id", "in", bucketIds)
      .orderBy("id")
      .forUpdate()
      .execute();
  }

  async increaseHeldQuantity(
    trx: Transaction<Database>,
    bucketId: string,
    quantity: number
  ): Promise<void> {
    const row = await trx
      .updateTable("inventory_daily_buckets")
      .set({
        held_quantity: sql<number>`held_quantity + ${quantity}`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", bucketId)
      .where(
        sql<boolean>`held_quantity + confirmed_quantity + ${quantity} <= coalesce(capacity_override, capacity) + overbooking_limit`
      )
      .returning("id")
      .executeTakeFirst();

    if (!row) {
      throw new ConflictError("Inventory hold counter update was rejected");
    }
  }

  async decreaseHeldQuantity(
    trx: Transaction<Database>,
    bucketId: string,
    quantity: number
  ): Promise<void> {
    const row = await trx
      .updateTable("inventory_daily_buckets")
      .set({
        held_quantity: sql<number>`held_quantity - ${quantity}`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", bucketId)
      .where("held_quantity", ">=", quantity)
      .returning("id")
      .executeTakeFirst();

    if (!row) {
      throw new ConflictError("Inventory hold counter invariant failed");
    }
  }

  async closeHold(
    trx: Transaction<Database>,
    holdId: string,
    status: "RELEASED" | "EXPIRED",
    releasedByUserId: string | null,
    releaseReason: string
  ): Promise<InventoryHoldRecord> {
    return trx
      .updateTable("inventory_holds")
      .set({
        status,
        released_by_user_id: releasedByUserId,
        released_at: sql<Date>`now()`,
        release_reason: releaseReason,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", holdId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recordEvent(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      roomCategoryId: string | null;
      stayDate: string;
      eventType: "HOLD_CREATED" | "HOLD_RELEASED" | "HOLD_EXPIRED";
      quantityDelta: number;
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<void> {
    await trx
      .insertInto("inventory_events")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        room_category_id: input.roomCategoryId,
        physical_unit_id: null,
        stay_date: input.stayDate,
        event_type: input.eventType,
        quantity_delta: input.quantityDelta,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }
}
