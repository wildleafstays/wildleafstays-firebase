import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type {
  InventoryAllocationItemsTable,
  InventoryAllocationNightsTable,
  InventoryAllocationsTable
} from "./inventory-allocation-database-types.js";

export type InventoryAllocationRecord = Selectable<InventoryAllocationsTable>;
export type InventoryAllocationItemRecord = Selectable<InventoryAllocationItemsTable>;
export type InventoryAllocationNightRecord = Selectable<InventoryAllocationNightsTable>;

export class InventoryAllocationRepository {
  async findByHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    holdId: string
  ): Promise<InventoryAllocationRecord | undefined> {
    return trx
      .selectFrom("inventory_allocations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("hold_id", "=", holdId)
      .executeTakeFirst();
  }

  async findByConfirmationReference(
    trx: Transaction<Database>,
    propertyId: string,
    confirmationReference: string
  ): Promise<InventoryAllocationRecord | undefined> {
    return trx
      .selectFrom("inventory_allocations")
      .selectAll()
      .where("property_id", "=", propertyId)
      .where("confirmation_reference", "=", confirmationReference)
      .executeTakeFirst();
  }

  async findForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    allocationId: string
  ): Promise<InventoryAllocationRecord | undefined> {
    return trx
      .selectFrom("inventory_allocations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", allocationId)
      .forUpdate()
      .executeTakeFirst();
  }

  async createAllocation(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      holdId: string;
      confirmationReference: string;
      startDate: string;
      endDate: string;
      confirmedByUserId: string | null;
    }
  ): Promise<InventoryAllocationRecord | undefined> {
    return trx
      .insertInto("inventory_allocations")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        hold_id: input.holdId,
        confirmation_reference: input.confirmationReference,
        start_date: input.startDate,
        end_date: input.endDate,
        confirmed_by_user_id: input.confirmedByUserId,
        released_by_user_id: null,
        released_at: null,
        release_reason: null
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createItem(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      allocationId: string;
      sourceHoldItemId: string;
      bucketType: "ROOM_CATEGORY" | "FULL_PROPERTY";
      roomCategoryId: string | null;
      quantity: number;
    }
  ): Promise<InventoryAllocationItemRecord> {
    return trx
      .insertInto("inventory_allocation_items")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        allocation_id: input.allocationId,
        source_hold_item_id: input.sourceHoldItemId,
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
      allocationId: string;
      allocationItemId: string;
      sourceHoldNightId: string;
      bucketId: string;
      stayDate: string;
      quantity: number;
    }
  ): Promise<void> {
    await trx
      .insertInto("inventory_allocation_nights")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        allocation_id: input.allocationId,
        allocation_item_id: input.allocationItemId,
        source_hold_night_id: input.sourceHoldNightId,
        bucket_id: input.bucketId,
        stay_date: input.stayDate,
        quantity: input.quantity
      })
      .execute();
  }

  async listItems(
    trx: Transaction<Database>,
    allocationId: string
  ): Promise<InventoryAllocationItemRecord[]> {
    return trx
      .selectFrom("inventory_allocation_items")
      .selectAll()
      .where("allocation_id", "=", allocationId)
      .orderBy("created_at")
      .execute();
  }

  async listNights(
    trx: Transaction<Database>,
    allocationId: string
  ): Promise<InventoryAllocationNightRecord[]> {
    return trx
      .selectFrom("inventory_allocation_nights")
      .selectAll()
      .where("allocation_id", "=", allocationId)
      .orderBy("stay_date")
      .orderBy("allocation_item_id")
      .execute();
  }

  async transferHeldToConfirmed(
    trx: Transaction<Database>,
    bucketId: string,
    quantity: number
  ): Promise<void> {
    const row = await trx
      .updateTable("inventory_daily_buckets")
      .set({
        held_quantity: sql<number>`held_quantity - ${quantity}`,
        confirmed_quantity: sql<number>`confirmed_quantity + ${quantity}`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", bucketId)
      .where("held_quantity", ">=", quantity)
      .returning("id")
      .executeTakeFirst();

    if (!row) {
      throw new ConflictError("Held inventory could not be converted to confirmed inventory");
    }
  }

  async decreaseConfirmedQuantity(
    trx: Transaction<Database>,
    bucketId: string,
    quantity: number
  ): Promise<void> {
    const row = await trx
      .updateTable("inventory_daily_buckets")
      .set({
        confirmed_quantity: sql<number>`confirmed_quantity - ${quantity}`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", bucketId)
      .where("confirmed_quantity", ">=", quantity)
      .returning("id")
      .executeTakeFirst();

    if (!row) {
      throw new ConflictError("Confirmed inventory counter invariant failed");
    }
  }

  async releaseAllocation(
    trx: Transaction<Database>,
    allocationId: string,
    releasedByUserId: string | null,
    releaseReason: string
  ): Promise<InventoryAllocationRecord> {
    return trx
      .updateTable("inventory_allocations")
      .set({
        status: "RELEASED",
        released_by_user_id: releasedByUserId,
        released_at: sql<Date>`now()`,
        release_reason: releaseReason,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", allocationId)
      .where("status", "=", "CONFIRMED")
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
      eventType: "ALLOCATION_CONFIRMED" | "ALLOCATION_RELEASED";
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
        quantity_delta: 0,
        details_json: input.details,
        actor_user_id: input.actorUserId,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .execute();
  }
}
