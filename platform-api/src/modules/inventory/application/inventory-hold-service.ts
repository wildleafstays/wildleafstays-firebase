import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { InventoryBlockScopes, InventoryBucketTypes, type SaleMode } from "../domain/inventory.js";
import {
  InventoryHoldStatuses,
  type CreateInventoryHoldInput,
  type InventoryHoldItemInput,
  type InventoryHoldItemView,
  type InventoryHoldResult,
  type InventoryHoldView
} from "../domain/inventory-hold.js";
import {
  InventoryHoldRepository,
  type InventoryHoldItemRecord,
  type InventoryHoldRecord
} from "../infrastructure/inventory-hold-repository.js";
import {
  InventoryRepository,
  type BucketSeed,
  type InventoryBlockRecord,
  type RoomCategoryCapacity
} from "../infrastructure/inventory-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_HOLD_NIGHTS = 365;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 30 * 60;
const EXPIRY_BATCH_SIZE = 250;

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

function formatUtcDate(value: Date): string {
  return [
    value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0")
  ].join("-");
}

function dateRange(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);

  if (days <= 0) {
    throw new ValidationError("endDate must be later than startDate");
  }
  if (days > MAX_HOLD_NIGHTS) {
    throw new ValidationError(`A hold cannot exceed ${MAX_HOLD_NIGHTS} nights`);
  }

  return Array.from({ length: days }, (_, index) =>
    formatUtcDate(new Date(start.getTime() + index * DAY_MS))
  );
}

function saleMode(value: string | null): SaleMode {
  if (value === "ROOMS_ONLY" || value === "FULL_PROPERTY_ONLY" || value === "BOTH") {
    return value;
  }
  throw new ConflictError("Property sale mode must be configured before inventory can be held");
}

function includesRooms(mode: SaleMode): boolean {
  return mode === "ROOMS_ONLY" || mode === "BOTH";
}

function includesFullProperty(mode: SaleMode): boolean {
  return mode === "FULL_PROPERTY_ONLY" || mode === "BOTH";
}

function bucketKey(bucketType: string, roomCategoryId: string | null, stayDate: string): string {
  return `${bucketType}:${roomCategoryId ?? "PROPERTY"}:${stayDate}`;
}

function blockAppliesOn(block: InventoryBlockRecord, stayDate: string): boolean {
  return block.start_date <= stayDate && block.end_date > stayDate;
}

function validateItems(items: InventoryHoldItemInput[], mode: SaleMode): void {
  if (items.length === 0) {
    throw new ValidationError("At least one hold item is required");
  }
  if (items.length > 10) {
    throw new ValidationError("A hold cannot contain more than 10 inventory items");
  }

  const hasFullProperty = items.some(
    (item) => item.bucketType === InventoryBucketTypes.FULL_PROPERTY
  );
  const hasRooms = items.some((item) => item.bucketType === InventoryBucketTypes.ROOM_CATEGORY);

  if (hasFullProperty && hasRooms) {
    throw new ValidationError(
      "A hold cannot mix full-property inventory with individual room inventory"
    );
  }

  if (hasRooms && !includesRooms(mode)) {
    throw new ValidationError("This property is not configured for individual room sales");
  }
  if (hasFullProperty && !includesFullProperty(mode)) {
    throw new ValidationError("This property is not configured for full-property sales");
  }
  if (hasFullProperty && items.length !== 1) {
    throw new ValidationError("A full-property hold must contain exactly one item");
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1000) {
      throw new ValidationError("Hold item quantity must be an integer between 1 and 1000");
    }

    if (item.bucketType === InventoryBucketTypes.FULL_PROPERTY) {
      if (item.roomCategoryId !== null) {
        throw new ValidationError("roomCategoryId is not valid for a full-property hold");
      }
      if (item.quantity !== 1) {
        throw new ValidationError("Full-property hold quantity must be 1");
      }
    } else if (!item.roomCategoryId) {
      throw new ValidationError("roomCategoryId is required for a room-category hold");
    }

    const key = `${item.bucketType}:${item.roomCategoryId ?? "PROPERTY"}`;
    if (seen.has(key)) {
      throw new ValidationError("Duplicate hold item");
    }
    seen.add(key);
  }
}

function holdItemView(item: InventoryHoldItemRecord): InventoryHoldItemView {
  return {
    id: item.id,
    bucketType: item.bucket_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
    roomCategoryId: item.room_category_id,
    quantity: item.quantity
  };
}

function holdView(hold: InventoryHoldRecord, items: InventoryHoldItemRecord[]): InventoryHoldView {
  return {
    id: hold.id,
    propertyId: hold.property_id,
    status: hold.status as "ACTIVE" | "RELEASED" | "EXPIRED",
    startDate: hold.start_date,
    endDate: hold.end_date,
    expiresAt: hold.expires_at.toISOString(),
    clientReference: hold.client_reference,
    items: items.map(holdItemView),
    releasedAt: hold.released_at?.toISOString() ?? null,
    releaseReason: hold.release_reason,
    createdAt: hold.created_at.toISOString()
  };
}

export class InventoryHoldService {
  constructor(
    private readonly holds = new InventoryHoldRepository(),
    private readonly inventory = new InventoryRepository(),
    private readonly authorization = new AuthorizationService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  private async propertyContext(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ): Promise<SaleMode> {
    const property = await this.inventory.findProperty(trx, organizationId, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Inventory cannot be held for an archived property");
    }

    return saleMode(property.sale_mode);
  }

  private async property(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission:
      | typeof Permissions.INVENTORY_READ
      | typeof Permissions.INVENTORY_MANAGE
      | typeof Permissions.RESERVATION_MANAGE
  ): Promise<SaleMode> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });

    return this.propertyContext(trx, organizationId, propertyId);
  }
  private async materialize(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    mode: SaleMode,
    dates: string[]
  ): Promise<RoomCategoryCapacity[]> {
    const categories =
      includesRooms(mode) || includesFullProperty(mode)
        ? await this.inventory.listRoomCategoryCapacities(trx, organizationId, propertyId)
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

    await this.inventory.upsertBuckets(trx, seeds);
    return categories;
  }

  private async expireLockedHold(
    trx: Transaction<Database>,
    hold: InventoryHoldRecord,
    request: RequestMetadata
  ): Promise<InventoryHoldRecord> {
    const [items, nights] = await Promise.all([
      this.holds.listItems(trx, hold.id),
      this.holds.listNights(trx, hold.id)
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))];
    await this.holds.lockBucketsByIds(trx, bucketIds);

    for (const night of nights) {
      await this.holds.decreaseHeldQuantity(trx, night.bucket_id, night.quantity);
      await this.holds.recordEvent(trx, {
        organizationId: hold.organization_id,
        propertyId: hold.property_id,
        roomCategoryId: itemMap.get(night.hold_item_id)?.room_category_id ?? null,
        stayDate: night.stay_date,
        eventType: "HOLD_EXPIRED",
        quantityDelta: -night.quantity,
        details: { holdId: hold.id },
        actorUserId: null,
        request
      });
    }

    const closed = await this.holds.closeHold(
      trx,
      hold.id,
      InventoryHoldStatuses.EXPIRED,
      null,
      "TTL_EXPIRED"
    );

    await new OutboxService(trx).enqueue({
      aggregateType: "inventory_hold",
      aggregateId: hold.id,
      eventType: "inventory.hold.expired.v1",
      payload: {
        holdId: hold.id,
        propertyId: hold.property_id,
        expiredAt: closed.released_at?.toISOString() ?? this.now().toISOString()
      }
    });

    return closed;
  }

  private async expireDueForPropertyCore(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    request: RequestMetadata
  ): Promise<number> {
    let expired = 0;
    while (true) {
      const due = await this.holds.listDueHoldsForUpdate(
        trx,
        organizationId,
        propertyId,
        this.now(),
        EXPIRY_BATCH_SIZE
      );

      if (due.length === 0) {
        return expired;
      }

      for (const hold of due) {
        await this.expireLockedHold(trx, hold, request);
        expired += 1;
      }

      if (due.length < EXPIRY_BATCH_SIZE) {
        return expired;
      }
    }
  }

  async expireDueForProperty(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    request: RequestMetadata,
    permission:
      | typeof Permissions.INVENTORY_READ
      | typeof Permissions.INVENTORY_MANAGE
      | typeof Permissions.RESERVATION_MANAGE = Permissions.INVENTORY_READ
  ): Promise<number> {
    await this.property(trx, actor, organizationId, propertyId, permission);
    return this.expireDueForPropertyCore(trx, organizationId, propertyId, request);
  }

  async expireDueForPropertySystem(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    request: RequestMetadata
  ): Promise<number> {
    if (request.source !== "public-api") {
      throw new ValidationError("System inventory expiry requires public-api request source");
    }

    await this.propertyContext(trx, organizationId, propertyId);
    return this.expireDueForPropertyCore(trx, organizationId, propertyId, request);
  }
  private async createHoldCore(
    trx: Transaction<Database>,
    actor: ActorContext | null,
    input: CreateInventoryHoldInput,
    request: RequestMetadata,
    permission: typeof Permissions.INVENTORY_MANAGE | typeof Permissions.RESERVATION_MANAGE | null,
    expiresAtCap: Date | null
  ): Promise<InventoryHoldResult> {
    const dates = dateRange(input.startDate, input.endDate);
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < MIN_TTL_SECONDS ||
      input.ttlSeconds > MAX_TTL_SECONDS
    ) {
      throw new ValidationError(
        `ttlSeconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`
      );
    }
    if (
      input.clientReference !== null &&
      (input.clientReference.trim().length === 0 || input.clientReference.length > 200)
    ) {
      throw new ValidationError("clientReference must contain 1 to 200 characters");
    }

    if (expiresAtCap !== null && Number.isNaN(expiresAtCap.getTime())) {
      throw new ValidationError("expiresAtCap must be a valid date");
    }

    const mode =
      actor !== null && permission !== null
        ? await this.property(trx, actor, input.organizationId, input.propertyId, permission)
        : await this.propertyContext(trx, input.organizationId, input.propertyId);
    validateItems(input.items, mode);

    await this.expireDueForPropertyCore(trx, input.organizationId, input.propertyId, request);

    const categories = await this.materialize(
      trx,
      input.organizationId,
      input.propertyId,
      mode,
      dates
    );
    const categoryMap = new Map(categories.map((category) => [category.id, category]));

    const fullPropertyRequested =
      input.items.length === 1 && input.items[0]?.bucketType === InventoryBucketTypes.FULL_PROPERTY;

    const activeRoomCategories = categories.filter((category) => category.capacity > 0);

    if (fullPropertyRequested && activeRoomCategories.length === 0) {
      throw new ConflictError(
        "The full property cannot be held until active physical-room inventory is configured"
      );
    }

    const effectiveItems: InventoryHoldItemInput[] = fullPropertyRequested
      ? activeRoomCategories.map((category) => ({
          bucketType: InventoryBucketTypes.ROOM_CATEGORY,
          roomCategoryId: category.id,
          quantity: category.capacity
        }))
      : input.items;

    for (const item of effectiveItems) {
      if (
        item.bucketType === InventoryBucketTypes.ROOM_CATEGORY &&
        (!item.roomCategoryId || !categoryMap.has(item.roomCategoryId))
      ) {
        throw new NotFoundError("Room category not found", {
          roomCategoryId: item.roomCategoryId
        });
      }
    }

    const buckets = await this.holds.lockPropertyBuckets(
      trx,
      input.organizationId,
      input.propertyId,
      input.startDate,
      input.endDate
    );
    const blocks = await this.inventory.listBlocks(
      trx,
      input.organizationId,
      input.propertyId,
      input.startDate,
      input.endDate
    );

    const bucketMap = new Map(
      buckets.map((bucket) => [
        bucketKey(bucket.bucket_type, bucket.room_category_id, bucket.stay_date),
        bucket
      ])
    );

    for (const date of dates) {
      const dayBlocks = blocks.filter((block) => blockAppliesOn(block, date));
      const propertyClosed = dayBlocks.some(
        (block) => block.scope_type === InventoryBlockScopes.PROPERTY
      );
      if (propertyClosed) {
        throw new ConflictError("Property is blocked for one or more requested nights", {
          date
        });
      }

      for (const item of effectiveItems) {
        if (item.bucketType === InventoryBucketTypes.ROOM_CATEGORY) {
          const bucket = bucketMap.get(
            bucketKey(InventoryBucketTypes.ROOM_CATEGORY, item.roomCategoryId, date)
          );
          if (!bucket) {
            throw new ConflictError("Room inventory bucket is missing", {
              roomCategoryId: item.roomCategoryId,
              date
            });
          }

          const fullBucket = bucketMap.get(
            bucketKey(InventoryBucketTypes.FULL_PROPERTY, null, date)
          );
          if (
            mode === "BOTH" &&
            fullBucket &&
            (fullBucket.held_quantity > 0 || fullBucket.confirmed_quantity > 0)
          ) {
            throw new ConflictError("The full property is already committed for this night", {
              date
            });
          }

          const categoryBlocks = dayBlocks
            .filter(
              (block) =>
                block.scope_type === InventoryBlockScopes.ROOM_CATEGORY &&
                block.room_category_id === item.roomCategoryId
            )
            .reduce((sum, block) => sum + block.quantity, 0);

          const unitBlocks = new Set(
            dayBlocks
              .filter(
                (block) =>
                  block.scope_type === InventoryBlockScopes.PHYSICAL_UNIT &&
                  block.room_category_id === item.roomCategoryId &&
                  block.physical_unit_id
              )
              .map((block) => block.physical_unit_id as string)
          ).size;

          const sellable =
            bucket.capacity +
            (fullPropertyRequested ? 0 : bucket.overbooking_limit) -
            bucket.held_quantity -
            bucket.confirmed_quantity -
            categoryBlocks -
            unitBlocks;

          if (bucket.stop_sell || sellable < item.quantity) {
            throw new ConflictError("Requested room inventory is no longer available", {
              roomCategoryId: item.roomCategoryId,
              date,
              requestedQuantity: item.quantity,
              sellableQuantity: Math.max(0, sellable)
            });
          }
        } else {
          const fullBucket = bucketMap.get(
            bucketKey(InventoryBucketTypes.FULL_PROPERTY, null, date)
          );
          if (!fullBucket) {
            throw new ConflictError("Full-property inventory bucket is missing", { date });
          }
          if (fullBucket.stop_sell) {
            throw new ConflictError("Full-property sales are stopped for this night", {
              date
            });
          }
          if (fullBucket.capacity - fullBucket.held_quantity - fullBucket.confirmed_quantity < 1) {
            throw new ConflictError("The full property is no longer available", { date });
          }

          if (mode === "BOTH") {
            for (const category of categories) {
              const roomBucket = bucketMap.get(
                bucketKey(InventoryBucketTypes.ROOM_CATEGORY, category.id, date)
              );
              if (!roomBucket || roomBucket.capacity <= 0) {
                throw new ConflictError(
                  "The full property cannot be held because room inventory is incomplete",
                  { roomCategoryId: category.id, date }
                );
              }

              const categoryBlocked = dayBlocks.some(
                (block) =>
                  (block.scope_type === InventoryBlockScopes.ROOM_CATEGORY ||
                    block.scope_type === InventoryBlockScopes.PHYSICAL_UNIT) &&
                  block.room_category_id === category.id
              );

              if (
                categoryBlocked ||
                roomBucket.held_quantity > 0 ||
                roomBucket.confirmed_quantity > 0
              ) {
                throw new ConflictError(
                  "The full property cannot be held because underlying room inventory is committed",
                  { roomCategoryId: category.id, date }
                );
              }
            }
          }
        }
      }
    }

    const holdNow = this.now();
    const requestedExpiresAt = new Date(holdNow.getTime() + input.ttlSeconds * 1000);
    const expiresAt =
      expiresAtCap !== null && expiresAtCap < requestedExpiresAt
        ? new Date(expiresAtCap.getTime())
        : requestedExpiresAt;
    if (expiresAt <= holdNow) {
      throw new ConflictError("Inventory hold expiry must be in the future");
    }

    const hold = await this.holds.createHold(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      expiresAt,
      clientReference: input.clientReference,
      createdByUserId: actor?.userId ?? null
    });

    const createdItems: InventoryHoldItemRecord[] = [];
    for (const item of effectiveItems) {
      const createdItem = await this.holds.createItem(trx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        holdId: hold.id,
        bucketType: item.bucketType,
        roomCategoryId: item.roomCategoryId,
        quantity: item.quantity
      });
      createdItems.push(createdItem);

      for (const date of dates) {
        const bucket = bucketMap.get(bucketKey(item.bucketType, item.roomCategoryId, date));
        if (!bucket) {
          throw new ConflictError("Inventory bucket disappeared during hold creation", {
            date
          });
        }

        await this.holds.increaseHeldQuantity(trx, bucket.id, item.quantity);
        await this.holds.createNight(trx, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          holdId: hold.id,
          holdItemId: createdItem.id,
          bucketId: bucket.id,
          stayDate: date,
          quantity: item.quantity
        });

        await this.holds.recordEvent(trx, {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          roomCategoryId: item.roomCategoryId,
          stayDate: date,
          eventType: "HOLD_CREATED",
          quantityDelta: item.quantity,
          details: {
            holdId: hold.id,
            holdItemId: createdItem.id,
            bucketType: item.bucketType,
            expiresAt: expiresAt.toISOString()
          },
          actorUserId: actor?.userId ?? null,
          request
        });
      }
    }

    const view = holdView(hold, createdItems);
    await new AuditService(trx).record({
      actor,
      actorType: actor ? "USER" : "SYSTEM",
      actorRole: actor ? null : "PUBLIC_BOOKING",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "inventory.hold.created",
      entityType: "inventory_hold",
      entityId: hold.id,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "inventory_hold",
      aggregateId: hold.id,
      eventType: "inventory.hold.created.v1",
      payload: view
    });

    return { hold: view };
  }

  async createHold(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateInventoryHoldInput,
    request: RequestMetadata,
    permission:
      | typeof Permissions.INVENTORY_MANAGE
      | typeof Permissions.RESERVATION_MANAGE = Permissions.INVENTORY_MANAGE,
    expiresAtCap: Date | null = null
  ): Promise<InventoryHoldResult> {
    return this.createHoldCore(trx, actor, input, request, permission, expiresAtCap);
  }

  async createHoldSystem(
    trx: Transaction<Database>,
    input: CreateInventoryHoldInput,
    request: RequestMetadata,
    expiresAtCap: Date | null = null
  ): Promise<InventoryHoldResult> {
    if (request.source !== "public-api") {
      throw new ValidationError(
        "System inventory hold creation requires public-api request source"
      );
    }

    return this.createHoldCore(trx, null, input, request, null, expiresAtCap);
  }

  private async getHoldCore(
    trx: Transaction<Database>,
    actor: ActorContext | null,
    organizationId: string,
    propertyId: string,
    holdId: string,
    request: RequestMetadata,
    permission: typeof Permissions.INVENTORY_READ | typeof Permissions.RESERVATION_MANAGE | null
  ): Promise<InventoryHoldResult> {
    if (actor !== null && permission !== null) {
      await this.property(trx, actor, organizationId, propertyId, permission);
    } else {
      await this.propertyContext(trx, organizationId, propertyId);
    }

    let hold = await this.holds.findHoldForUpdate(trx, organizationId, propertyId, holdId);
    if (!hold) {
      throw new NotFoundError("Inventory hold not found");
    }

    if (hold.status === InventoryHoldStatuses.ACTIVE && hold.expires_at <= this.now()) {
      hold = await this.expireLockedHold(trx, hold, request);
    }

    const items = await this.holds.listItems(trx, hold.id);
    return { hold: holdView(hold, items) };
  }

  async getHold(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    holdId: string,
    request: RequestMetadata,
    permission:
      | typeof Permissions.INVENTORY_READ
      | typeof Permissions.RESERVATION_MANAGE = Permissions.INVENTORY_READ
  ): Promise<InventoryHoldResult> {
    return this.getHoldCore(trx, actor, organizationId, propertyId, holdId, request, permission);
  }

  async getHoldSystem(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    holdId: string,
    request: RequestMetadata
  ): Promise<InventoryHoldResult> {
    if (request.source !== "public-api") {
      throw new ValidationError("System inventory hold read requires public-api request source");
    }

    return this.getHoldCore(trx, null, organizationId, propertyId, holdId, request, null);
  }
  async releaseHold(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    holdId: string,
    releaseReason: string,
    request: RequestMetadata
  ): Promise<InventoryHoldResult> {
    if (!releaseReason.trim()) {
      throw new ValidationError("releaseReason is required");
    }

    await this.property(trx, actor, organizationId, propertyId, Permissions.INVENTORY_MANAGE);

    let hold = await this.holds.findHoldForUpdate(trx, organizationId, propertyId, holdId);
    if (!hold) {
      throw new NotFoundError("Inventory hold not found");
    }

    if (hold.status !== InventoryHoldStatuses.ACTIVE) {
      const items = await this.holds.listItems(trx, hold.id);
      return { hold: holdView(hold, items) };
    }

    if (hold.expires_at <= this.now()) {
      hold = await this.expireLockedHold(trx, hold, request);
      const items = await this.holds.listItems(trx, hold.id);
      return { hold: holdView(hold, items) };
    }

    const [items, nights] = await Promise.all([
      this.holds.listItems(trx, hold.id),
      this.holds.listNights(trx, hold.id)
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))];
    await this.holds.lockBucketsByIds(trx, bucketIds);

    for (const night of nights) {
      await this.holds.decreaseHeldQuantity(trx, night.bucket_id, night.quantity);
      const item = itemMap.get(night.hold_item_id);
      await this.holds.recordEvent(trx, {
        organizationId,
        propertyId,
        roomCategoryId: item?.room_category_id ?? null,
        stayDate: night.stay_date,
        eventType: "HOLD_RELEASED",
        quantityDelta: -night.quantity,
        details: { holdId, releaseReason },
        actorUserId: actor.userId,
        request
      });
    }

    hold = await this.holds.closeHold(
      trx,
      hold.id,
      InventoryHoldStatuses.RELEASED,
      actor.userId,
      releaseReason
    );

    const view = holdView(hold, items);
    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "inventory.hold.released",
      entityType: "inventory_hold",
      entityId: hold.id,
      after: view,
      reason: releaseReason,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "inventory_hold",
      aggregateId: hold.id,
      eventType: "inventory.hold.released.v1",
      payload: view
    });

    return { hold: view };
  }
}
