import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { InventoryService } from "../src/modules/inventory/application/inventory-service.js";
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
  const authSubject = `phase3b-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 3B Owner",
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
        legalName: `Phase 3B ${randomUUID()}`,
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
        name: `Hold Property ${randomUUID()}`,
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
  dates = { startDate: "2031-01-01", endDate: "2031-01-02" }
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

describe("Phase 3B atomic inventory holds", () => {
  it("protects the last room from a second hold", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";

    const first = await createHold(fixture, [roomItem(categoryId)]);
    expect(first.hold.status).toBe("ACTIVE");

    await expect(createHold(fixture, [roomItem(categoryId)])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("serializes concurrent last-room attempts so only one wins", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";

    const results = await Promise.allSettled([
      createHold(fixture, [roomItem(categoryId)]),
      createHold(fixture, [roomItem(categoryId)])
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("fails closed when a full-property hold has no active physical rooms", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", []);

    await expect(createHold(fixture, [fullPropertyItem])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("derives a full-property hold from every active physical-room category capacity", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", [2, 1]);
    const firstCategoryId = fixture.roomCategoryIds[0] ?? "";
    const secondCategoryId = fixture.roomCategoryIds[1] ?? "";

    const hold = await createHold(fixture, [fullPropertyItem]);

    expect(hold.hold.status).toBe("ACTIVE");
    expect(hold.hold.items).toHaveLength(2);
    expect(hold.hold.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: firstCategoryId,
          quantity: 2
        }),
        expect.objectContaining({
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: secondCategoryId,
          quantity: 1
        })
      ])
    );
    expect(hold.hold.items.some((item) => item.bucketType === "FULL_PROPERTY")).toBe(false);
  });

  it("prevents a full-property hold after an underlying room is held in BOTH mode", async () => {
    const fixture = await createFixture("BOTH", [2]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";

    await createHold(fixture, [roomItem(categoryId)]);

    await expect(createHold(fixture, [fullPropertyItem])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("prevents a room hold after the full property is held in BOTH mode", async () => {
    const fixture = await createFixture("BOTH", [2]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";

    await createHold(fixture, [fullPropertyItem]);

    await expect(createHold(fixture, [roomItem(categoryId)])).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("releases held quantity and restores availability", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    await db
      .transaction()
      .execute((trx) =>
        new InventoryHoldService().releaseHold(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          hold.hold.id,
          "Customer abandoned checkout",
          metadata()
        )
      );

    const availability = await db
      .transaction()
      .execute((trx) =>
        new InventoryService().getAvailability(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          "2031-01-01",
          "2031-01-02"
        )
      );

    expect(availability.days[0]?.roomCategories[0]?.heldQuantity).toBe(0);
    expect(availability.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
  });

  it("expires overdue holds and returns inventory to sale", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    await db
      .updateTable("inventory_holds")
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where("id", "=", hold.hold.id)
      .execute();

    const expired = await db
      .transaction()
      .execute((trx) =>
        new InventoryHoldService().expireDueForProperty(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          metadata()
        )
      );
    expect(expired).toBe(1);

    const row = await db
      .selectFrom("inventory_holds")
      .select(["status", "release_reason"])
      .where("id", "=", hold.hold.id)
      .executeTakeFirstOrThrow();

    const bucket = await db
      .selectFrom("inventory_daily_buckets")
      .select("held_quantity")
      .where("property_id", "=", fixture.propertyId)
      .where("room_category_id", "=", categoryId)
      .where("stay_date", "=", "2031-01-01")
      .executeTakeFirstOrThrow();

    expect(row.status).toBe("EXPIRED");
    expect(row.release_reason).toBe("TTL_EXPIRED");
    expect(bucket.held_quantity).toBe(0);
  });

  it("rolls back a multi-category hold completely when one category is unavailable", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1, 1]);
    const firstCategory = fixture.roomCategoryIds[0] ?? "";
    const secondCategory = fixture.roomCategoryIds[1] ?? "";

    await createHold(fixture, [roomItem(secondCategory)]);

    await expect(
      createHold(fixture, [roomItem(firstCategory), roomItem(secondCategory)])
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const firstBucket = await db
      .selectFrom("inventory_daily_buckets")
      .select("held_quantity")
      .where("property_id", "=", fixture.propertyId)
      .where("room_category_id", "=", firstCategory)
      .where("stay_date", "=", "2031-01-01")
      .executeTakeFirstOrThrow();

    expect(firstBucket.held_quantity).toBe(0);
  });

  it("writes hold lifecycle events, audit history and outbox messages", async () => {
    const fixture = await createFixture("ROOMS_ONLY", [1]);
    const categoryId = fixture.roomCategoryIds[0] ?? "";
    const hold = await createHold(fixture, [roomItem(categoryId)]);

    const [event, audit, outbox] = await Promise.all([
      db
        .selectFrom("inventory_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("event_type", "=", "HOLD_CREATED")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("action", "=", "inventory.hold.created")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_id", "=", hold.hold.id)
        .where("event_type", "=", "inventory.hold.created.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(event.quantity_delta).toBe(1);
    expect(audit.entity_id).toBe(hold.hold.id);
    expect(outbox.aggregate_type).toBe("inventory_hold");
  });
});
