import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  InventoryAllocationStatuses,
  type InventoryAllocationItemView,
  type InventoryAllocationResult,
  type InventoryAllocationView
} from "../domain/inventory-allocation.js";
import {
  InventoryAllocationRepository,
  type InventoryAllocationItemRecord,
  type InventoryAllocationRecord
} from "../infrastructure/inventory-allocation-repository.js";
import {
  InventoryHoldRepository,
  type InventoryHoldItemRecord,
  type InventoryHoldRecord
} from "../infrastructure/inventory-hold-repository.js";
import { InventoryRepository } from "../infrastructure/inventory-repository.js";

function allocationItemView(item: InventoryAllocationItemRecord): InventoryAllocationItemView {
  return {
    id: item.id,
    bucketType: item.bucket_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
    roomCategoryId: item.room_category_id,
    quantity: item.quantity
  };
}

function allocationView(
  allocation: InventoryAllocationRecord,
  items: InventoryAllocationItemRecord[]
): InventoryAllocationView {
  return {
    id: allocation.id,
    propertyId: allocation.property_id,
    holdId: allocation.hold_id,
    confirmationReference: allocation.confirmation_reference,
    startDate: allocation.start_date,
    endDate: allocation.end_date,
    status: allocation.status as "CONFIRMED" | "RELEASED",
    items: items.map(allocationItemView),
    confirmedAt: allocation.confirmed_at.toISOString(),
    releasedAt: allocation.released_at?.toISOString() ?? null,
    releaseReason: allocation.release_reason
  };
}

export class InventoryAllocationService {
  constructor(
    private readonly allocations = new InventoryAllocationRepository(),
    private readonly holds = new InventoryHoldRepository(),
    private readonly inventory = new InventoryRepository(),
    private readonly authorization = new AuthorizationService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  private async property(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.INVENTORY_READ | typeof Permissions.INVENTORY_MANAGE
  ): Promise<void> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });

    const property = await this.inventory.findProperty(trx, organizationId, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Inventory cannot be confirmed for an archived property");
    }
  }

  private normalizedReference(confirmationReference: string): string {
    const normalizedReference = confirmationReference.trim();
    if (normalizedReference.length < 3 || normalizedReference.length > 200) {
      throw new ValidationError("confirmationReference must contain between 3 and 200 characters");
    }
    return normalizedReference;
  }

  private async assertNotReservationOwnedHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    holdId: string
  ): Promise<void> {
    const reservation = await this.allocations.findReservationOwnerByHold(
      trx,
      organizationId,
      propertyId,
      holdId
    );
    if (reservation) {
      throw new ConflictError(
        "Reservation-linked inventory cannot be managed through generic inventory allocation commands",
        {
          reservationId: reservation.id,
          reservationStatus: reservation.status,
          inventoryHoldId: holdId
        }
      );
    }
  }

  private async existingAllocationResult(
    trx: Transaction<Database>,
    allocation: InventoryAllocationRecord,
    confirmationReference: string
  ): Promise<InventoryAllocationResult> {
    if (allocation.confirmation_reference !== confirmationReference) {
      throw new ConflictError(
        "This hold has already been confirmed with a different confirmation reference",
        {
          allocationId: allocation.id,
          existingConfirmationReference: allocation.confirmation_reference
        }
      );
    }

    const items = await this.allocations.listItems(trx, allocation.id);
    return { allocation: allocationView(allocation, items) };
  }

  private async confirmLockedHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    hold: InventoryHoldRecord,
    normalizedReference: string,
    actor: ActorContext | null,
    actorType: "USER" | "PROVIDER",
    request: RequestMetadata
  ): Promise<InventoryAllocationResult> {
    const existingForHold = await this.allocations.findByHold(
      trx,
      organizationId,
      propertyId,
      hold.id
    );
    if (existingForHold) {
      return this.existingAllocationResult(trx, existingForHold, normalizedReference);
    }

    const existingForReference = await this.allocations.findByConfirmationReference(
      trx,
      propertyId,
      normalizedReference
    );
    if (existingForReference) {
      throw new ConflictError(
        "confirmationReference is already attached to another inventory allocation",
        { allocationId: existingForReference.id }
      );
    }

    if (hold.status !== "ACTIVE") {
      throw new ConflictError("Only an active inventory hold can be confirmed", {
        holdStatus: hold.status
      });
    }
    if (hold.expires_at <= this.now()) {
      throw new ConflictError("Inventory hold has expired and cannot be confirmed", {
        expiresAt: hold.expires_at.toISOString()
      });
    }

    const [holdItems, holdNights] = await Promise.all([
      this.holds.listItems(trx, hold.id),
      this.holds.listNights(trx, hold.id)
    ]);

    if (holdItems.length === 0 || holdNights.length === 0) {
      throw new ConflictError("Inventory hold has no allocation detail rows");
    }

    const holdItemMap = new Map(holdItems.map((item) => [item.id, item]));
    const bucketIds = [...new Set(holdNights.map((night) => night.bucket_id))];
    await this.holds.lockBucketsByIds(trx, bucketIds);

    const allocation = await this.allocations.createAllocation(trx, {
      organizationId,
      propertyId,
      holdId: hold.id,
      confirmationReference: normalizedReference,
      startDate: hold.start_date,
      endDate: hold.end_date,
      confirmedByUserId: actor?.userId ?? null
    });

    if (!allocation) {
      const racedForHold = await this.allocations.findByHold(
        trx,
        organizationId,
        propertyId,
        hold.id
      );
      if (racedForHold) {
        return this.existingAllocationResult(trx, racedForHold, normalizedReference);
      }

      const racedForReference = await this.allocations.findByConfirmationReference(
        trx,
        propertyId,
        normalizedReference
      );
      if (racedForReference) {
        throw new ConflictError(
          "confirmationReference was claimed by another inventory allocation",
          { allocationId: racedForReference.id }
        );
      }

      throw new ConflictError("Inventory allocation could not be created");
    }

    const allocationItems: InventoryAllocationItemRecord[] = [];
    const allocationItemByHoldItem = new Map<string, InventoryAllocationItemRecord>();

    for (const holdItem of holdItems) {
      const allocationItem = await this.allocations.createItem(trx, {
        organizationId,
        propertyId,
        allocationId: allocation.id,
        sourceHoldItemId: holdItem.id,
        bucketType: holdItem.bucket_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
        roomCategoryId: holdItem.room_category_id,
        quantity: holdItem.quantity
      });
      allocationItems.push(allocationItem);
      allocationItemByHoldItem.set(holdItem.id, allocationItem);
    }

    for (const holdNight of holdNights) {
      const allocationItem = allocationItemByHoldItem.get(holdNight.hold_item_id);
      const holdItem: InventoryHoldItemRecord | undefined = holdItemMap.get(holdNight.hold_item_id);

      if (!allocationItem || !holdItem) {
        throw new ConflictError("Inventory hold detail relationship is incomplete");
      }

      await this.allocations.transferHeldToConfirmed(trx, holdNight.bucket_id, holdNight.quantity);

      await this.allocations.createNight(trx, {
        organizationId,
        propertyId,
        allocationId: allocation.id,
        allocationItemId: allocationItem.id,
        sourceHoldNightId: holdNight.id,
        bucketId: holdNight.bucket_id,
        stayDate: holdNight.stay_date,
        quantity: holdNight.quantity
      });

      await this.allocations.recordEvent(trx, {
        organizationId,
        propertyId,
        roomCategoryId: holdItem.room_category_id,
        stayDate: holdNight.stay_date,
        eventType: "ALLOCATION_CONFIRMED",
        details: {
          allocationId: allocation.id,
          holdId: hold.id,
          confirmationReference: normalizedReference,
          bucketType: holdItem.bucket_type,
          heldDelta: -holdNight.quantity,
          confirmedDelta: holdNight.quantity
        },
        actorUserId: actor?.userId ?? null,
        request
      });
    }

    await this.holds.closeHold(
      trx,
      hold.id,
      "RELEASED",
      actor?.userId ?? null,
      `CONVERTED_TO_CONFIRMED_ALLOCATION:${allocation.id}`
    );

    const view = allocationView(allocation, allocationItems);

    await new AuditService(trx).record({
      actor,
      actorType,
      organizationId,
      propertyId,
      action: "inventory.allocation.confirmed",
      entityType: "inventory_allocation",
      entityId: allocation.id,
      after: view,
      reason: normalizedReference,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "inventory_allocation",
      aggregateId: allocation.id,
      eventType: "inventory.allocation.confirmed.v1",
      payload: view
    });

    return { allocation: view };
  }

  async confirmHold(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    holdId: string,
    confirmationReference: string,
    request: RequestMetadata
  ): Promise<InventoryAllocationResult> {
    const normalizedReference = this.normalizedReference(confirmationReference);

    await this.property(trx, actor, organizationId, propertyId, Permissions.INVENTORY_MANAGE);

    const hold = await this.holds.findHoldForUpdate(trx, organizationId, propertyId, holdId);
    if (!hold) {
      throw new NotFoundError("Inventory hold not found");
    }

    await this.assertNotReservationOwnedHold(trx, organizationId, propertyId, holdId);

    return this.confirmLockedHold(
      trx,
      organizationId,
      propertyId,
      hold,
      normalizedReference,
      actor,
      "USER",
      request
    );
  }

  async confirmReservationHold(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    holdId: string,
    confirmationReference: string,
    request: RequestMetadata
  ): Promise<InventoryAllocationResult> {
    const normalizedReference = this.normalizedReference(confirmationReference);
    const hold = await this.holds.findHoldForUpdate(trx, organizationId, propertyId, holdId);
    if (!hold) {
      throw new NotFoundError("Inventory hold not found");
    }

    const owner = await this.allocations.findReservationOwnerByHold(
      trx,
      organizationId,
      propertyId,
      holdId
    );
    if (!owner || owner.id !== reservationId) {
      throw new ConflictError("Inventory hold is not owned by the expected reservation", {
        reservationId,
        inventoryHoldId: holdId,
        actualReservationId: owner?.id ?? null
      });
    }

    if (owner.status === "CONFIRMED") {
      const existing = await this.allocations.findByHold(trx, organizationId, propertyId, holdId);
      if (!existing) {
        throw new ConflictError("Confirmed reservation has no confirmed inventory allocation", {
          reservationId,
          inventoryHoldId: holdId
        });
      }
      return this.existingAllocationResult(trx, existing, normalizedReference);
    }

    if (owner.status !== "PAYMENT_PENDING") {
      throw new ConflictError(
        "Reservation-owned inventory can be confirmed only from PAYMENT_PENDING",
        {
          reservationId,
          reservationStatus: owner.status,
          inventoryHoldId: holdId
        }
      );
    }

    return this.confirmLockedHold(
      trx,
      organizationId,
      propertyId,
      hold,
      normalizedReference,
      null,
      "PROVIDER",
      request
    );
  }

  async getAllocation(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    allocationId: string
  ): Promise<InventoryAllocationResult> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.INVENTORY_READ);

    const allocation = await this.allocations.findForUpdate(
      trx,
      organizationId,
      propertyId,
      allocationId
    );
    if (!allocation) {
      throw new NotFoundError("Inventory allocation not found");
    }

    const items = await this.allocations.listItems(trx, allocation.id);
    return { allocation: allocationView(allocation, items) };
  }

  async releaseAllocation(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    allocationId: string,
    releaseReason: string,
    request: RequestMetadata
  ): Promise<InventoryAllocationResult> {
    const normalizedReason = releaseReason.trim();
    if (normalizedReason.length === 0 || normalizedReason.length > 1000) {
      throw new ValidationError("releaseReason must contain between 1 and 1000 characters");
    }

    await this.property(trx, actor, organizationId, propertyId, Permissions.INVENTORY_MANAGE);

    let allocation = await this.allocations.findForUpdate(
      trx,
      organizationId,
      propertyId,
      allocationId
    );
    if (!allocation) {
      throw new NotFoundError("Inventory allocation not found");
    }

    await this.assertNotReservationOwnedHold(trx, organizationId, propertyId, allocation.hold_id);

    const items = await this.allocations.listItems(trx, allocation.id);
    if (allocation.status === InventoryAllocationStatuses.RELEASED) {
      return { allocation: allocationView(allocation, items) };
    }

    const itemMap = new Map(items.map((item) => [item.id, item]));
    const nights = await this.allocations.listNights(trx, allocation.id);
    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))];
    await this.holds.lockBucketsByIds(trx, bucketIds);

    for (const night of nights) {
      const item = itemMap.get(night.allocation_item_id);
      if (!item) {
        throw new ConflictError("Inventory allocation detail relationship is incomplete");
      }

      await this.allocations.decreaseConfirmedQuantity(trx, night.bucket_id, night.quantity);

      await this.allocations.recordEvent(trx, {
        organizationId,
        propertyId,
        roomCategoryId: item.room_category_id,
        stayDate: night.stay_date,
        eventType: "ALLOCATION_RELEASED",
        details: {
          allocationId,
          confirmationReference: allocation.confirmation_reference,
          bucketType: item.bucket_type,
          confirmedDelta: -night.quantity,
          releaseReason: normalizedReason
        },
        actorUserId: actor.userId,
        request
      });
    }

    allocation = await this.allocations.releaseAllocation(
      trx,
      allocation.id,
      actor.userId,
      normalizedReason
    );

    const view = allocationView(allocation, items);

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "inventory.allocation.released",
      entityType: "inventory_allocation",
      entityId: allocation.id,
      after: view,
      reason: normalizedReason,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "inventory_allocation",
      aggregateId: allocation.id,
      eventType: "inventory.allocation.released.v1",
      payload: view
    });

    return { allocation: view };
  }
}
