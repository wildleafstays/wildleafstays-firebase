import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  InventoryBlocksTable,
  InventoryDailyBucketsTable
} from "./inventory-database-types.js";
import type {
  CreateInventoryBlockInput,
  InventoryBlockType,
  InventoryBlockScope
} from "../domain/inventory.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type InventoryBucketRecord = Selectable<InventoryDailyBucketsTable>;
export type InventoryBlockRecord = Selectable<InventoryBlocksTable>;

export interface PropertyInventoryRecord {
  id: string;
  organization_id: string;
  sale_mode: string | null;
  status: string;
}

export interface RoomCategoryCapacity {
  id: string;
  code: string;
  name: string;
  capacity: number;
}

export interface PhysicalUnitReference {
  id: string;
  room_category_id: string;
  status: string;
}

export interface BucketSeed {
  organizationId: string;
  propertyId: string;
  bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY";
  roomCategoryId: string | null;
  stayDate: string;
  capacity: number;
}

export class InventoryRepository {
  async findProperty(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyInventoryRecord | undefined> {
    return db
      .selectFrom("properties")
      .select(["id", "organization_id", "sale_mode", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", propertyId)
      .executeTakeFirst();
  }

  async listRoomCategoryCapacities(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<RoomCategoryCapacity[]> {
    return db
      .selectFrom("room_categories as rc")
      .leftJoin("physical_units as pu", (join) =>
        join
          .onRef("pu.room_category_id", "=", "rc.id")
          .onRef("pu.property_id", "=", "rc.property_id")
          .onRef("pu.organization_id", "=", "rc.organization_id")
          .on("pu.status", "=", "ACTIVE")
      )
      .select([
        "rc.id as id",
        "rc.code as code",
        "rc.name as name",
        sql<number>`count(pu.id)::int`.as("capacity")
      ])
      .where("rc.organization_id", "=", organizationId)
      .where("rc.property_id", "=", propertyId)
      .where("rc.status", "=", "ACTIVE")
      .groupBy(["rc.id", "rc.code", "rc.name"])
      .orderBy("rc.sort_order")
      .orderBy("rc.name")
      .execute();
  }

  async findRoomCategoryCapacity(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string
  ): Promise<RoomCategoryCapacity | undefined> {
    return db
      .selectFrom("room_categories as rc")
      .leftJoin("physical_units as pu", (join) =>
        join
          .onRef("pu.room_category_id", "=", "rc.id")
          .onRef("pu.property_id", "=", "rc.property_id")
          .onRef("pu.organization_id", "=", "rc.organization_id")
          .on("pu.status", "=", "ACTIVE")
      )
      .select([
        "rc.id as id",
        "rc.code as code",
        "rc.name as name",
        sql<number>`count(pu.id)::int`.as("capacity")
      ])
      .where("rc.organization_id", "=", organizationId)
      .where("rc.property_id", "=", propertyId)
      .where("rc.id", "=", roomCategoryId)
      .where("rc.status", "=", "ACTIVE")
      .groupBy(["rc.id", "rc.code", "rc.name"])
      .executeTakeFirst();
  }

  async findPhysicalUnit(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    physicalUnitId: string
  ): Promise<PhysicalUnitReference | undefined> {
    return db
      .selectFrom("physical_units")
      .select(["id", "room_category_id", "status"])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", physicalUnitId)
      .executeTakeFirst();
  }

  async upsertBuckets(db: DbExecutor, seeds: BucketSeed[]): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    const chunkSize = 1000;
    for (let offset = 0; offset < seeds.length; offset += chunkSize) {
      const chunk = seeds.slice(offset, offset + chunkSize);
      await db
        .insertInto("inventory_daily_buckets")
        .values(
          chunk.map((seed) => ({
            id: randomUUID(),
            organization_id: seed.organizationId,
            property_id: seed.propertyId,
            bucket_type: seed.bucketType,
            room_category_id: seed.roomCategoryId,
            stay_date: seed.stayDate,
            capacity: seed.capacity
          }))
        )
        .onConflict((conflict) =>
          conflict
            .columns(["property_id", "bucket_type", "room_category_id", "stay_date"])
            .doUpdateSet({
              capacity: (eb) => eb.ref("excluded.capacity"),
              version: sql<number>`inventory_daily_buckets.version + 1`,
              updated_at: sql<Date>`now()`
            })
            .where(
              sql<boolean>`inventory_daily_buckets.capacity is distinct from excluded.capacity`
            )
        )
        .execute();
    }
  }

  async listBuckets(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<InventoryBucketRecord[]> {
    return db
      .selectFrom("inventory_daily_buckets")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("stay_date")
      .orderBy("bucket_type")
      .execute();
  }

  async updateControls(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY",
    roomCategoryId: string | null,
    startDate: string,
    endDate: string,
    stopSell: boolean | null,
    overbookingLimit: number | null
  ): Promise<number> {
    let query = db
      .updateTable("inventory_daily_buckets")
      .set((eb) => ({
        stop_sell: stopSell === null ? eb.ref("stop_sell") : stopSell,
        overbooking_limit:
          overbookingLimit === null ? eb.ref("overbooking_limit") : overbookingLimit,
        version: sql<number>`inventory_daily_buckets.version + 1`,
        updated_at: sql<Date>`now()`
      }))
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("bucket_type", "=", bucketType)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate);

    query =
      roomCategoryId === null
        ? query.where("room_category_id", "is", null)
        : query.where("room_category_id", "=", roomCategoryId);

    const rows = await query.returning("id").execute();
    return rows.length;
  }

  async listBlocks(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    includeReleased = false
  ): Promise<InventoryBlockRecord[]> {
    return db
      .selectFrom("inventory_blocks")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("start_date", "<", endDate)
      .where("end_date", ">", startDate)
      .$if(!includeReleased, (query) => query.where("status", "=", "ACTIVE"))
      .orderBy("start_date")
      .orderBy("created_at")
      .execute();
  }

  async findBlock(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    blockId: string
  ): Promise<InventoryBlockRecord | undefined> {
    return db
      .selectFrom("inventory_blocks")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", blockId)
      .executeTakeFirst();
  }

  async createBlock(
    db: DbExecutor,
    actorUserId: string,
    input: CreateInventoryBlockInput
  ): Promise<InventoryBlockRecord> {
    return db
      .insertInto("inventory_blocks")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        scope_type: input.scopeType,
        room_category_id: input.roomCategoryId,
        physical_unit_id: input.physicalUnitId,
        block_type: input.blockType,
        start_date: input.startDate,
        end_date: input.endDate,
        quantity: input.quantity,
        reason: input.reason,
        created_by_user_id: actorUserId,
        released_by_user_id: null,
        released_at: null,
        release_reason: null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async releaseBlock(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    blockId: string,
    actorUserId: string,
    releaseReason: string
  ): Promise<InventoryBlockRecord | undefined> {
    return db
      .updateTable("inventory_blocks")
      .set({
        status: "RELEASED",
        released_by_user_id: actorUserId,
        released_at: sql<Date>`now()`,
        release_reason: releaseReason,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", blockId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirst();
  }

  async recordEvent(
    db: DbExecutor,
    input: {
      organizationId: string;
      propertyId: string;
      roomCategoryId?: string | null;
      physicalUnitId?: string | null;
      stayDate?: string | null;
      eventType: "CONTROL_CHANGED" | "BLOCK_CREATED" | "BLOCK_RELEASED" | "CAPACITY_REFRESHED";
      quantityDelta?: number;
      details: JsonObject;
      actorUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<string> {
    const id = randomUUID();
    await db
      .insertInto("inventory_events")
      .values({
        id,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        room_category_id: input.roomCategoryId ?? null,
        physical_unit_id: input.physicalUnitId ?? null,
        stay_date: input.stayDate ?? null,
        event_type: input.eventType,
        quantity_delta: input.quantityDelta ?? 0,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .executeTakeFirst();
    return id;
  }
}

export function blockScope(record: InventoryBlockRecord): InventoryBlockScope {
  return record.scope_type as InventoryBlockScope;
}

export function blockType(record: InventoryBlockRecord): InventoryBlockType {
  return record.block_type as InventoryBlockType;
}
