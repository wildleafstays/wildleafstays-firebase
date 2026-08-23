import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import {
  InventoryAllocationRepository,
  type InventoryAllocationRecord
} from "../../inventory/infrastructure/inventory-allocation-repository.js";
import { InventoryHoldRepository } from "../../inventory/infrastructure/inventory-hold-repository.js";

export const GuestCancellationInventoryReleaseReason = "BOOKING_CANCELLED" as const;

export interface GuestCancellationInventoryReleaseInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  reservationInventoryHoldId: string;
  inventoryAllocationId: string;
  actorUserId: string | null;
  request: RequestMetadata;
}

export interface GuestCancellationInventoryReleaseResult {
  released: boolean;
  allocation: InventoryAllocationRecord;
}

export class GuestCancellationInventoryService {
  constructor(
    private readonly allocations = new InventoryAllocationRepository(),
    private readonly holds = new InventoryHoldRepository()
  ) {}

  async releaseConfirmedAllocation(
    trx: Transaction<Database>,
    input: GuestCancellationInventoryReleaseInput
  ): Promise<GuestCancellationInventoryReleaseResult> {
    let allocation = await this.allocations.findForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.inventoryAllocationId
    );

    if (!allocation) {
      throw new ConflictError("Canonical reservation inventory allocation is missing");
    }

    if (allocation.hold_id !== input.reservationInventoryHoldId) {
      throw new ConflictError(
        "Canonical inventory allocation does not belong to the reservation hold",
        {
          reservationId: input.reservationId,
          inventoryAllocationId: allocation.id
        }
      );
    }

    const owner = await this.allocations.findReservationOwnerByHold(
      trx,
      input.organizationId,
      input.propertyId,
      allocation.hold_id
    );

    if (!owner || owner.id !== input.reservationId) {
      throw new ConflictError("Reservation-owned inventory allocation identity is inconsistent", {
        reservationId: input.reservationId,
        inventoryAllocationId: allocation.id
      });
    }

    if (allocation.status === "RELEASED") {
      if (allocation.release_reason !== GuestCancellationInventoryReleaseReason) {
        throw new ConflictError(
          "Inventory allocation was already released for a different reason",
          {
            reservationId: input.reservationId,
            inventoryAllocationId: allocation.id,
            releaseReason: allocation.release_reason
          }
        );
      }

      return {
        released: false,
        allocation
      };
    }

    if (allocation.status !== "CONFIRMED") {
      throw new ConflictError("Guest cancellation requires confirmed reservation inventory", {
        reservationId: input.reservationId,
        inventoryAllocationId: allocation.id,
        allocationStatus: allocation.status
      });
    }

    if (owner.status !== "CONFIRMED") {
      throw new ConflictError(
        "Reservation-owned inventory can be released only from CONFIRMED cancellation state",
        {
          reservationId: input.reservationId,
          reservationStatus: owner.status
        }
      );
    }

    const [items, nights] = await Promise.all([
      this.allocations.listItems(trx, allocation.id),
      this.allocations.listNights(trx, allocation.id)
    ]);

    if (items.length === 0 || nights.length === 0) {
      throw new ConflictError("Confirmed reservation allocation detail is incomplete");
    }

    const itemById = new Map(items.map((item) => [item.id, item]));

    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))].sort();

    const lockedBuckets = await this.holds.lockBucketsByIds(trx, bucketIds);

    const lockedBucketIds = new Set(lockedBuckets.map((bucket) => bucket.id));

    if (
      lockedBucketIds.size !== bucketIds.length ||
      bucketIds.some((id) => !lockedBucketIds.has(id))
    ) {
      throw new ConflictError("Confirmed inventory bucket relationship is incomplete");
    }

    for (const night of nights) {
      if (!Number.isSafeInteger(night.quantity) || night.quantity <= 0) {
        throw new ConflictError("Confirmed allocation night quantity is invalid");
      }

      const item = itemById.get(night.allocation_item_id);

      if (!item) {
        throw new ConflictError("Confirmed allocation item relationship is incomplete");
      }

      await this.allocations.decreaseConfirmedQuantity(trx, night.bucket_id, night.quantity);

      await this.allocations.recordEvent(trx, {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        roomCategoryId: item.room_category_id,
        stayDate: night.stay_date,
        eventType: "ALLOCATION_RELEASED",
        details: {
          reservationId: input.reservationId,
          allocationId: allocation.id,
          confirmationReference: allocation.confirmation_reference,
          bucketType: item.bucket_type,
          confirmedDelta: -night.quantity,
          releaseReason: GuestCancellationInventoryReleaseReason
        },
        actorUserId: input.actorUserId,
        request: input.request
      });
    }

    allocation = await this.allocations.releaseAllocation(
      trx,
      allocation.id,
      input.actorUserId,
      GuestCancellationInventoryReleaseReason
    );

    return {
      released: true,
      allocation
    };
  }
}
