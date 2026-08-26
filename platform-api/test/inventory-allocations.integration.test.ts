import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { InventoryAllocationService } from "../src/modules/inventory/application/inventory-allocation-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { InventoryService } from "../src/modules/inventory/application/inventory-service.js";
import { OwnerReportService } from "../src/modules/reports/application/owner-report-service.js";
import type { InventoryHoldItemInput } from "../src/modules/inventory/domain/inventory-hold.js";
import type { SaleMode } from "../src/modules/inventory/domain/inventory.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";

const config = loadConfig();
const db = createDatabase(config);

afterAll(async () => {
  await db.destroy();
});

function metadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "integration-test",
    ipAddress: null,
    userAgent: null
  };
}

interface Fixture {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  roomCategoryIds: string[];
}

async function createFixture(saleMode: SaleMode, capacities: number[]): Promise<Fixture> {
  const authSubject = `phase3c-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 3C Owner",
      email_verified: true,
      status: "ACTIVE"
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const baseActor: ActorContext = {
    userId: user.id,
    email: user.email,
    platformRoles: [],
    organizationMemberships: [],
    propertyGrants: []
  };

  const organization = await db.transaction().execute((trx) =>
    new CreateOrganizationService().execute(
      trx,
      baseActor,
      {
        legalName: `Phase 3C ${randomUUID()}`,
        tradingName: null,
        organizationType: "PRIVATE_LIMITED",
        countryCode: "IN",
        currencyCode: "INR"
      },
      metadata()
    )
  );

  const actor: ActorContext = {
    ...baseActor,
    organizationMemberships: [
      {
        membershipId: organization.membershipId,
        organizationId: organization.organizationId,
        role: "OWNER"
      }
    ]
  };

  const property = await db.transaction().execute((trx) =>
    new CreatePropertyDraftService().execute(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        name: `Allocation Property ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  await db
    .updateTable("properties")
    .set({
      property_type: saleMode === "ROOMS_ONLY" ? "HOTEL" : "VILLA",
      sale_mode: saleMode
    })
    .where("id", "=", property.property.id)
    .execute();

  const setup = new PropertySetupService();
  const roomCategoryIds: string[] = [];

  for (let categoryIndex = 0; categoryIndex < capacities.length; categoryIndex++) {
    const category = await db.transaction().execute((trx) =>
      setup.createRoomCategory(
        trx,
        actor,
        {
          organizationId: organization.organizationId,
          propertyId: property.property.id,
          code: `CAT-${categoryIndex + 1}`,
          name: `Category ${categoryIndex + 1}`,
          accommodationType: "ROOM",
          description: null,
          baseOccupancy: 2,
          maxAdults: 3,
          maxChildren: 2,
          maxOccupancy: 4,
          sizeSqm: 28,
          bedConfiguration: "1 King Bed",
          extraBedAllowed: true,
          defaultViewLabel: "Valley View",
          sortOrder: categoryIndex + 1
        },
        metadata()
      )
    );

    roomCategoryIds.push(category.roomCategory.id);

    for (let unitIndex = 0; unitIndex < (capacities[categoryIndex] ?? 0); unitIndex++) {
      await db.transaction().execute((trx) =>
        setup.createPhysicalUnit(
          trx,
          actor,
          {
            organizationId: organization.organizationId,
            propertyId: property.property.id,
            roomCategoryId: category.roomCategory.id,
            structureId: null,
            floorId: null,
            unitCode: `C${categoryIndex + 1}-R${unitIndex + 1}`,
            displayName: `Room ${categoryIndex + 1}-${unitIndex + 1}`,
            hasView: true,
            viewLabel: "Valley View",
            wheelchairAccessible: false,
            stepFreeAccessible: false,
            liftAccessible: false,
            smokingPolicy: "NON_SMOKING",
            internalNotes: null,
            sortOrder: unitIndex + 1
          },
          metadata()
        )
      );
    }
  }

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    roomCategoryIds
  };
}

function roomItem(roomCategoryId: string, quantity = 1): InventoryHoldItemInput {
  return {
    bucketType: "ROOM_CATEGORY",
    roomCategoryId,
    quantity
  };
}

const fullPropertyItem: InventoryHoldItemInput = {
  bucketType: "FULL_PROPERTY",
  roomCategoryId: null,
  quantity: 1
};

async function createHold(
  fixture: Fixture,
  items: InventoryHoldItemInput[],
  dates = { startDate: "2032-01-01", endDate: "2032-01-02" }
) {
  return db.transaction().execute((trx) =>
    new InventoryHoldService().createHold(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        startDate: dates.startDate,
        endDate: dates.endDate,
        ttlSeconds: 900,
        clientReference: randomUUID(),
        items
      },
      metadata()
    )
  );
}

async function confirmHold(
  fixture: Fixture,
  holdId: string,
  confirmationReference = `RES-${randomUUID()}`
) {
  return db
    .transaction()
    .execute((trx) =>
      new InventoryAllocationService().confirmHold(
        trx,
        fixture.actor,
        fixture.organizationId,
        fixture.propertyId,
        holdId,
        confirmationReference,
        metadata()
      )
    );
}

async function availability(fixture: Fixture, startDate = "2032-01-01", endDate = "2032-01-02") {
  return db
    .transaction()
    .execute((trx) =>
      new InventoryService().getAvailability(
        trx,
        fixture.actor,
        fixture.organizationId,
        fixture.propertyId,
        startDate,
        endDate
      )
    );
}

describe("Phase 3C confirmed inventory allocations", () => {
  it("atomically converts held room inventory into confirmed inventory", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    const allocation = await confirmHold(fixture, hold.hold.id, "RES-ROOM-1");

    expect(allocation.allocation.status).toBe("CONFIRMED");
    expect(allocation.allocation.confirmationReference).toBe("RES-ROOM-1");

    const bucket = await db
      .selectFrom("inventory_daily_buckets")
      .select(["held_quantity", "confirmed_quantity"])
      .where("property_id", "=", fixture.propertyId)
      .where("room_category_id", "=", categoryId)
      .where("stay_date", "=", "2032-01-01")
      .executeTakeFirstOrThrow();

    expect(bucket.held_quantity).toBe(0);
    expect(bucket.confirmed_quantity).toBe(1);
  });

  it("returns the same allocation for a repeated confirmation of the same hold and reference", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    const first = await confirmHold(fixture, hold.hold.id, "RES-IDEMPOTENT");
    const second = await confirmHold(fixture, hold.hold.id, "RES-IDEMPOTENT");

    expect(second.allocation.id).toBe(first.allocation.id);

    const count = await db
      .selectFrom("inventory_allocations")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("hold_id", "=", hold.hold.id)
      .executeTakeFirstOrThrow();

    expect(Number(count.count)).toBe(1);
  });

  it("serializes concurrent confirmation attempts for one hold", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    const [first, second] = await Promise.all([
      confirmHold(fixture, hold.hold.id, "RES-CONCURRENT"),
      confirmHold(fixture, hold.hold.id, "RES-CONCURRENT")
    ]);

    expect(first.allocation.id).toBe(second.allocation.id);
  });

  it("rejects a different confirmation reference after a hold is already confirmed", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    await confirmHold(fixture, hold.hold.id, "RES-ORIGINAL");

    await expect(confirmHold(fixture, hold.hold.id, "RES-DIFFERENT")).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("confirmed room inventory blocks full-property sale in BOTH mode", async () => {
    const fixture = await createFixture("BOTH", [2]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    await confirmHold(fixture, hold.hold.id);

    const result = await availability(fixture);
    expect(result.days[0]?.roomCategories[0]?.confirmedQuantity).toBe(1);
    expect(result.days[0]?.fullProperty?.roomInventoryConflict).toBe(true);
    expect(result.days[0]?.fullProperty?.sellableQuantity).toBe(0);

    await expect(createHold(fixture, [fullPropertyItem])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("confirmed full-property inventory blocks room sale in BOTH mode", async () => {
    const fixture = await createFixture("BOTH", [2]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [fullPropertyItem]);

    await confirmHold(fixture, hold.hold.id);

    const result = await availability(fixture);
    expect(result.days[0]?.roomCategories[0]?.confirmedQuantity).toBe(2);
    expect(result.days[0]?.fullProperty?.roomInventoryConflict).toBe(true);
    expect(result.days[0]?.roomCategories[0]?.sellableQuantity).toBe(0);

    await expect(createHold(fixture, [roomItem(categoryId)])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("Phase 7E1A reports confirmed full-property inventory as full occupancy", async () => {
    const fixture = await createFixture("BOTH", [2]);
    const hold = await createHold(fixture, [fullPropertyItem]);

    await confirmHold(fixture, hold.hold.id, "RES-7E1A-FULL");

    const report = await new OwnerReportService().occupancy(db, fixture.actor, {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      startDate: "2032-01-01",
      endDate: "2032-01-02"
    });

    expect(report).toMatchObject({
      propertyId: fixture.propertyId,
      startDate: "2032-01-01",
      endDate: "2032-01-02",
      nights: 1,
      capacityBasis: "CURRENT_ACTIVE_PHYSICAL_UNITS",
      confirmedReservationCount: 0,
      capacityRoomNights: 2,
      confirmedRoomNights: 2,
      confirmedOccupancyBps: 10000
    });

    expect(report.days).toEqual([
      {
        date: "2032-01-01",
        capacityRooms: 2,
        confirmedRooms: 2,
        confirmedOccupancyBps: 10000
      }
    ]);
  });
  it("refuses full-property confirmation when no physical-room inventory exists", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", []);

    await expect(createHold(fixture, [fullPropertyItem])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("releases confirmed allocation exactly once and restores sellable inventory", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);
    const allocation = await confirmHold(fixture, hold.hold.id);

    const service = new InventoryAllocationService();
    const firstRelease = await db
      .transaction()
      .execute((trx) =>
        service.releaseAllocation(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          allocation.allocation.id,
          "Reservation cancelled",
          metadata()
        )
      );
    const secondRelease = await db
      .transaction()
      .execute((trx) =>
        service.releaseAllocation(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          allocation.allocation.id,
          "Reservation cancelled",
          metadata()
        )
      );

    expect(firstRelease.allocation.status).toBe("RELEASED");
    expect(secondRelease.allocation.status).toBe("RELEASED");

    const result = await availability(fixture);
    expect(result.days[0]?.roomCategories[0]?.confirmedQuantity).toBe(0);
    expect(result.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
  });

  it("preserves multi-category and multi-night allocation detail atomically", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [2, 2]);
    const firstCategory = fixture.roomCategoryIds[0] ?? "";
    const secondCategory = fixture.roomCategoryIds[1] ?? "";
    const hold = await createHold(
      fixture,
      [roomItem(firstCategory, 1), roomItem(secondCategory, 2)],
      { startDate: "2032-02-01", endDate: "2032-02-04" }
    );

    const allocation = await confirmHold(fixture, hold.hold.id, "RES-MULTI-NIGHT");

    const nights = await db
      .selectFrom("inventory_allocation_nights")
      .selectAll()
      .where("allocation_id", "=", allocation.allocation.id)
      .execute();

    expect(allocation.allocation.items).toHaveLength(2);
    expect(nights).toHaveLength(6);

    const buckets = await db
      .selectFrom("inventory_daily_buckets")
      .select(["room_category_id", "stay_date", "held_quantity", "confirmed_quantity"])
      .where("property_id", "=", fixture.propertyId)
      .where("stay_date", ">=", "2032-02-01")
      .where("stay_date", "<", "2032-02-04")
      .execute();

    expect(buckets.every((bucket) => bucket.held_quantity === 0)).toBe(true);
    expect(
      buckets
        .filter((bucket) => bucket.room_category_id === firstCategory)
        .every((bucket) => bucket.confirmed_quantity === 1)
    ).toBe(true);
    expect(
      buckets
        .filter((bucket) => bucket.room_category_id === secondCategory)
        .every((bucket) => bucket.confirmed_quantity === 2)
    ).toBe(true);
  });

  it("rejects confirmation after the hold TTL has passed", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    await db
      .updateTable("inventory_holds")
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where("id", "=", hold.hold.id)
      .execute();

    await expect(confirmHold(fixture, hold.hold.id, "RES-TOO-LATE")).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("writes allocation events, audit/outbox records and protects detail history", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);
    const allocation = await confirmHold(fixture, hold.hold.id, "RES-AUDITABLE");

    const [event, audit, outbox, detail] = await Promise.all([
      db
        .selectFrom("inventory_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("event_type", "=", "ALLOCATION_CONFIRMED")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("action", "=", "inventory.allocation.confirmed")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_id", "=", allocation.allocation.id)
        .where("event_type", "=", "inventory.allocation.confirmed.v1")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("inventory_allocation_nights")
        .selectAll()
        .where("allocation_id", "=", allocation.allocation.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(event.details_json["confirmedDelta"]).toBe(1);
    expect(audit.entity_id).toBe(allocation.allocation.id);
    expect(outbox.aggregate_type).toBe("inventory_allocation");

    await expect(
      db
        .updateTable("inventory_allocation_nights")
        .set({ quantity: 99 })
        .where("id", "=", detail.id)
        .execute()
    ).rejects.toThrow(/append-only/i);
  });
});
