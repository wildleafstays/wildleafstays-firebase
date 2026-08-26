import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { calculateInventoryAvailability } from "./inventory-availability-calculator.js";
import {
  InventoryBlockScopes,
  InventoryBucketTypes,
  type CreateInventoryBlockInput,
  type InventoryAvailabilityResult,
  type InventoryBlockResult,
  type InventoryBlockView,
  type InventoryControlResult,
  type SaleMode,
  type SetInventoryControlsInput
} from "../domain/inventory.js";
import {
  blockScope,
  blockType,
  InventoryRepository,
  type BucketSeed,
  type InventoryBlockRecord,
  type PropertyInventoryRecord,
  type RoomCategoryCapacity
} from "../infrastructure/inventory-repository.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("Dates must use YYYY-MM-DD format");
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError("Invalid calendar date", { value });
  }
  return parsed;
}

function formatDate(value: Date): string {
  return [
    value.getFullYear().toString().padStart(4, "0"),
    (value.getMonth() + 1).toString().padStart(2, "0"),
    value.getDate().toString().padStart(2, "0")
  ].join("-");
}

function dateRange(startDate: string, endDate: string, maxDays: number): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days <= 0) {
    throw new ValidationError("endDate must be later than startDate");
  }
  if (days > maxDays) {
    throw new ValidationError(`Date range cannot exceed ${maxDays} days`);
  }

  return Array.from({ length: days }, (_, index) =>
    formatDate(new Date(start.getTime() + index * DAY_MS))
  );
}

function asSaleMode(value: string | null): SaleMode {
  if (value === "ROOMS_ONLY" || value === "FULL_PROPERTY_ONLY" || value === "BOTH") {
    return value;
  }
  throw new ConflictError("Property sale mode must be configured before inventory can be used");
}

function includesRooms(mode: SaleMode): boolean {
  return mode === "ROOMS_ONLY" || mode === "BOTH";
}

function includesFullProperty(mode: SaleMode): boolean {
  return mode === "FULL_PROPERTY_ONLY" || mode === "BOTH";
}

function normalizeDatabaseDate(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return normalized;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear().toString().padStart(4, "0"),
      (value.getMonth() + 1).toString().padStart(2, "0"),
      value.getDate().toString().padStart(2, "0")
    ].join("-");
  }

  throw new ConflictError("Unexpected database date representation");
}
function blockView(record: InventoryBlockRecord): InventoryBlockView {
  return {
    id: record.id,
    propertyId: record.property_id,
    scopeType: blockScope(record),
    roomCategoryId: record.room_category_id,
    physicalUnitId: record.physical_unit_id,
    blockType: blockType(record),
    startDate: normalizeDatabaseDate(record.start_date),
    endDate: normalizeDatabaseDate(record.end_date),
    quantity: record.quantity,
    reason: record.reason,
    status: record.status as "ACTIVE" | "RELEASED",
    releaseReason: record.release_reason,
    releasedAt: record.released_at?.toISOString() ?? null
  };
}

export class InventoryService {
  constructor(
    private readonly repository = new InventoryRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async propertyContext(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<{ record: PropertyInventoryRecord; saleMode: SaleMode }> {
    const record = await this.repository.findProperty(db, organizationId, propertyId);
    if (!record) {
      throw new NotFoundError("Property not found");
    }
    if (record.status === "ARCHIVED") {
      throw new ConflictError("Inventory cannot be managed for an archived property");
    }

    return { record, saleMode: asSaleMode(record.sale_mode) };
  }

  private async property(
    db: DbExecutor,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.INVENTORY_READ | typeof Permissions.INVENTORY_MANAGE
  ): Promise<{ record: PropertyInventoryRecord; saleMode: SaleMode }> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });

    return this.propertyContext(db, organizationId, propertyId);
  }
  private async materialize(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    saleMode: SaleMode,
    dates: string[]
  ): Promise<RoomCategoryCapacity[]> {
    const categories =
      includesRooms(saleMode) || includesFullProperty(saleMode)
        ? await this.repository.listRoomCategoryCapacities(db, organizationId, propertyId)
        : [];

    const seeds: BucketSeed[] = [];

    for (const date of dates) {
      for (const category of categories) {
        seeds.push({
          organizationId,
          propertyId,
          bucketType: InventoryBucketTypes.ROOM_CATEGORY,
          roomCategoryId: category.id,
          stayDate: date,
          capacity: category.capacity
        });
      }
    }

    await this.repository.upsertBuckets(db, seeds);
    return categories;
  }

  private async getAvailabilityCore(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    dates: string[],
    saleMode: SaleMode
  ): Promise<InventoryAvailabilityResult> {
    const categories = await this.materialize(trx, organizationId, propertyId, saleMode, dates);
    const [buckets, blocks] = await Promise.all([
      this.repository.listBuckets(trx, organizationId, propertyId, startDate, endDate),
      this.repository.listBlocks(trx, organizationId, propertyId, startDate, endDate)
    ]);

    return calculateInventoryAvailability({
      propertyId,
      saleMode,
      startDate,
      endDate,
      dates,
      categories: categories.map((category) => ({
        id: category.id,
        code: category.code,
        name: category.name,
        capacity: category.capacity
      })),
      buckets: buckets.map((bucket) => ({
        bucketType: bucket.bucket_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
        roomCategoryId: bucket.room_category_id,
        stayDate: normalizeDatabaseDate(bucket.stay_date),
        heldQuantity: bucket.held_quantity,
        confirmedQuantity: bucket.confirmed_quantity,
        capacityOverride: bucket.capacity_override,
        overbookingLimit: bucket.overbooking_limit,
        stopSell: bucket.stop_sell
      })),
      blocks: blocks.map((block) => ({
        scopeType: block.scope_type as "PROPERTY" | "ROOM_CATEGORY" | "PHYSICAL_UNIT",
        roomCategoryId: block.room_category_id,
        physicalUnitId: block.physical_unit_id,
        startDate: normalizeDatabaseDate(block.start_date),
        endDate: normalizeDatabaseDate(block.end_date),
        quantity: block.quantity
      })),
      missingBucketMode: "ERROR"
    });
  }

  async getAvailability(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<InventoryAvailabilityResult> {
    const dates = dateRange(startDate, endDate, 366);
    const { saleMode } = await this.property(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.INVENTORY_READ
    );

    return this.getAvailabilityCore(
      trx,
      organizationId,
      propertyId,
      startDate,
      endDate,
      dates,
      saleMode
    );
  }

  async getAvailabilitySystem(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string
  ): Promise<InventoryAvailabilityResult> {
    const dates = dateRange(startDate, endDate, 366);
    const { saleMode } = await this.propertyContext(trx, organizationId, propertyId);

    return this.getAvailabilityCore(
      trx,
      organizationId,
      propertyId,
      startDate,
      endDate,
      dates,
      saleMode
    );
  }
  async setControls(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: SetInventoryControlsInput,
    request: RequestMetadata
  ): Promise<InventoryControlResult> {
    const dates = dateRange(input.startDate, input.endDate, 366);
    const capacityOverride = input.capacityOverride ?? null;
    if (input.stopSell === null && input.overbookingLimit === null && capacityOverride === null) {
      throw new ValidationError("At least one inventory control must be supplied");
    }
    if (input.overbookingLimit !== null && input.overbookingLimit < 0) {
      throw new ValidationError("Overbooking limit cannot be negative");
    }
    if (capacityOverride !== null && (capacityOverride < 0 || capacityOverride > 1000)) {
      throw new ValidationError("Inventory capacity must be between 0 and 1000");
    }

    const { saleMode } = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.INVENTORY_MANAGE
    );

    let roomCategory: RoomCategoryCapacity | undefined;
    if (input.bucketType === InventoryBucketTypes.ROOM_CATEGORY) {
      if (!input.roomCategoryId) {
        throw new ValidationError("roomCategoryId is required for room-category controls");
      }
      roomCategory = await this.repository.findRoomCategoryCapacity(
        trx,
        input.organizationId,
        input.propertyId,
        input.roomCategoryId
      );
      if (!roomCategory) {
        throw new NotFoundError("Room category not found");
      }
    } else {
      throw new ValidationError(
        "Full-property inventory is derived from room-category inventory and cannot be controlled separately"
      );
    }

    await this.materialize(trx, input.organizationId, input.propertyId, saleMode, dates);

    const affectedDays = await this.repository.updateControls(
      trx,
      input.organizationId,
      input.propertyId,
      input.bucketType,
      input.roomCategoryId,
      input.startDate,
      input.endDate,
      input.stopSell,
      input.overbookingLimit,
      capacityOverride
    );

    if (affectedDays !== dates.length) {
      throw new ConflictError(
        "Inventory cannot be set below rooms that are already held or confirmed"
      );
    }

    const result: InventoryControlResult = {
      propertyId: input.propertyId,
      bucketType: input.bucketType,
      roomCategoryId: input.roomCategoryId,
      startDate: input.startDate,
      endDate: input.endDate,
      stopSell: input.stopSell,
      overbookingLimit: input.overbookingLimit,
      capacityOverride,
      affectedDays
    };

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "inventory.controls.changed",
      entityType: "inventory_control_range",
      entityId: `${input.bucketType}:${input.roomCategoryId ?? "FULL"}:${input.startDate}:${input.endDate}`,
      after: result,
      request
    });

    await this.repository.recordEvent(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      roomCategoryId: roomCategory?.id ?? null,
      eventType: "CONTROL_CHANGED",
      details: result,
      actorUserId: actor.userId,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "inventory.controls.changed.v1",
      payload: result
    });

    return result;
  }

  async createBlock(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateInventoryBlockInput,
    request: RequestMetadata
  ): Promise<InventoryBlockResult> {
    dateRange(input.startDate, input.endDate, 3650);
    if (!input.reason.trim()) {
      throw new ValidationError("Block reason is required");
    }

    const { saleMode } = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.INVENTORY_MANAGE
    );

    let normalized: CreateInventoryBlockInput = {
      ...input,
      reason: input.reason.trim()
    };

    if (input.scopeType === InventoryBlockScopes.PROPERTY) {
      normalized = {
        ...normalized,
        roomCategoryId: null,
        physicalUnitId: null,
        quantity: 1
      };
    } else {
      if (!includesRooms(saleMode)) {
        throw new ValidationError(
          "Room/category blocks are not valid for a full-property-only listing"
        );
      }

      if (input.scopeType === InventoryBlockScopes.ROOM_CATEGORY) {
        if (!input.roomCategoryId || input.physicalUnitId) {
          throw new ValidationError(
            "Room-category blocks require roomCategoryId and no physicalUnitId"
          );
        }
        const category = await this.repository.findRoomCategoryCapacity(
          trx,
          input.organizationId,
          input.propertyId,
          input.roomCategoryId
        );
        if (!category) {
          throw new NotFoundError("Room category not found");
        }
        if (input.quantity <= 0 || input.quantity > category.capacity) {
          throw new ValidationError(
            "Block quantity must be between 1 and the active physical capacity",
            { activeCapacity: category.capacity }
          );
        }
      } else {
        if (!input.physicalUnitId) {
          throw new ValidationError("physicalUnitId is required for a physical-unit block");
        }
        const unit = await this.repository.findPhysicalUnit(
          trx,
          input.organizationId,
          input.propertyId,
          input.physicalUnitId
        );
        if (!unit) {
          throw new NotFoundError("Physical unit not found");
        }
        if (unit.status !== "ACTIVE") {
          throw new ConflictError("Only an active physical unit can receive a dated block", {
            physicalUnitId: unit.id,
            status: unit.status
          });
        }
        if (input.roomCategoryId && input.roomCategoryId !== unit.room_category_id) {
          throw new ValidationError("Physical unit does not belong to the supplied room category");
        }

        const overlaps = await this.repository.listBlocks(
          trx,
          input.organizationId,
          input.propertyId,
          input.startDate,
          input.endDate
        );
        if (
          overlaps.some(
            (block) =>
              block.scope_type === InventoryBlockScopes.PHYSICAL_UNIT &&
              block.physical_unit_id === unit.id
          )
        ) {
          throw new ConflictError("Physical unit already has an overlapping active block");
        }

        normalized = {
          ...normalized,
          roomCategoryId: unit.room_category_id,
          quantity: 1
        };
      }
    }

    const block = await this.repository.createBlock(trx, actor.userId, normalized);
    const view = blockView(block);

    await new AuditService(trx).record({
      actor,
      organizationId: normalized.organizationId,
      propertyId: normalized.propertyId,
      action: "inventory.block.created",
      entityType: "inventory_block",
      entityId: block.id,
      before: null,
      after: view,
      reason: view.reason,
      request
    });

    await this.repository.recordEvent(trx, {
      organizationId: normalized.organizationId,
      propertyId: normalized.propertyId,
      roomCategoryId: normalized.roomCategoryId,
      physicalUnitId: normalized.physicalUnitId,
      eventType: "BLOCK_CREATED",
      quantityDelta: -normalized.quantity,
      details: view,
      actorUserId: actor.userId,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: normalized.propertyId,
      eventType: "inventory.block.created.v1",
      payload: { block: view }
    });

    return { block: view };
  }

  async releaseBlock(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    blockId: string,
    releaseReason: string,
    request: RequestMetadata
  ): Promise<InventoryBlockResult> {
    if (!releaseReason.trim()) {
      throw new ValidationError("Release reason is required");
    }

    await this.property(trx, actor, organizationId, propertyId, Permissions.INVENTORY_MANAGE);

    const before = await this.repository.findBlock(trx, organizationId, propertyId, blockId);
    if (!before) {
      throw new NotFoundError("Inventory block not found");
    }
    if (before.status === "RELEASED") {
      return { block: blockView(before) };
    }

    const released = await this.repository.releaseBlock(
      trx,
      organizationId,
      propertyId,
      blockId,
      actor.userId,
      releaseReason.trim()
    );
    if (!released) {
      throw new ConflictError("Inventory block changed while it was being released");
    }
    const view = blockView(released);

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "inventory.block.released",
      entityType: "inventory_block",
      entityId: blockId,
      before: blockView(before),
      after: view,
      reason: releaseReason.trim(),
      request
    });

    await this.repository.recordEvent(trx, {
      organizationId,
      propertyId,
      roomCategoryId: released.room_category_id,
      physicalUnitId: released.physical_unit_id,
      eventType: "BLOCK_RELEASED",
      quantityDelta: released.quantity,
      details: view,
      actorUserId: actor.userId,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "inventory.block.released.v1",
      payload: { block: view }
    });

    return { block: view };
  }

  async listBlocks(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    startDate: string,
    endDate: string,
    includeReleased: boolean
  ): Promise<JsonObject> {
    dateRange(startDate, endDate, 3650);
    await this.property(db, actor, organizationId, propertyId, Permissions.INVENTORY_READ);

    const blocks = await this.repository.listBlocks(
      db,
      organizationId,
      propertyId,
      startDate,
      endDate,
      includeReleased
    );

    return {
      propertyId,
      startDate,
      endDate,
      blocks: blocks.map(blockView)
    };
  }
}
