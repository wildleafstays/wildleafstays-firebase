import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { InventoryService } from "../src/modules/inventory/application/inventory-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import type { SaleMode } from "../src/modules/inventory/domain/inventory.js";

const config = loadConfig();
const db = createDatabase(config);

afterAll(async () => {
  await db.destroy();
});

function requestMetadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "integration-test",
    ipAddress: null,
    userAgent: null
  };
}

interface InventoryFixture {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  roomCategoryId: string | null;
  physicalUnitIds: string[];
}

async function createInventoryFixture(
  saleMode: SaleMode,
  roomCount: number
): Promise<InventoryFixture> {
  const authSubject = `phase3a-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 3A Owner",
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
        legalName: `Phase 3A ${randomUUID()}`,
        tradingName: null,
        organizationType: "PRIVATE_LIMITED",
        countryCode: "IN",
        currencyCode: "INR"
      },
      requestMetadata()
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
        name: `Inventory Property ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      requestMetadata()
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

  if (saleMode === "FULL_PROPERTY_ONLY") {
    return {
      actor,
      organizationId: organization.organizationId,
      propertyId: property.property.id,
      roomCategoryId: null,
      physicalUnitIds: []
    };
  }

  const setup = new PropertySetupService();
  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: "DLX",
        name: "Deluxe Room",
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
        sortOrder: 1
      },
      requestMetadata()
    )
  );

  const physicalUnitIds: string[] = [];
  for (let index = 0; index < roomCount; index++) {
    const unit = await db.transaction().execute((trx) =>
      setup.createPhysicalUnit(
        trx,
        actor,
        {
          organizationId: organization.organizationId,
          propertyId: property.property.id,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `ROOM-${index + 1}`,
          displayName: `Room ${index + 1}`,
          hasView: true,
          viewLabel: "Valley View",
          wheelchairAccessible: false,
          stepFreeAccessible: false,
          liftAccessible: false,
          smokingPolicy: "NON_SMOKING",
          internalNotes: null,
          sortOrder: index + 1
        },
        requestMetadata()
      )
    );
    physicalUnitIds.push(unit.physicalUnit.id);
  }

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    roomCategoryId: category.roomCategory.id,
    physicalUnitIds
  };
}

async function availability(fixture: InventoryFixture, startDate: string, endDate: string) {
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

describe("Phase 3A inventory foundation", () => {
  it("derives ROOMS_ONLY capacity from active physical units", async () => {
    const fixture = await createInventoryFixture("ROOMS_ONLY", 3);
    const result = await availability(fixture, "2030-01-01", "2030-01-02");

    expect(result.saleMode).toBe("ROOMS_ONLY");
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.fullProperty).toBeNull();
    expect(result.days[0]?.roomCategories).toHaveLength(1);
    expect(result.days[0]?.roomCategories[0]?.physicalCapacity).toBe(3);
    expect(result.days[0]?.roomCategories[0]?.sellableQuantity).toBe(3);
  });

  it("supports FULL_PROPERTY_ONLY without forcing room inventory", async () => {
    const fixture = await createInventoryFixture("FULL_PROPERTY_ONLY", 0);
    const result = await availability(fixture, "2030-02-01", "2030-02-03");

    expect(result.saleMode).toBe("FULL_PROPERTY_ONLY");
    expect(result.days).toHaveLength(2);
    expect(result.days[0]?.roomCategories).toHaveLength(0);
    expect(result.days[0]?.fullProperty?.capacity).toBe(1);
    expect(result.days[0]?.fullProperty?.sellableQuantity).toBe(1);
  });

  it("makes the full property unavailable when one underlying room is blocked in BOTH mode", async () => {
    const fixture = await createInventoryFixture("BOTH", 2);
    const service = new InventoryService();

    const block = await db.transaction().execute((trx) =>
      service.createBlock(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          scopeType: "PHYSICAL_UNIT",
          roomCategoryId: fixture.roomCategoryId,
          physicalUnitId: fixture.physicalUnitIds[0] ?? null,
          blockType: "MAINTENANCE",
          startDate: "2030-03-01",
          endDate: "2030-03-02",
          quantity: 1,
          reason: "Bathroom maintenance"
        },
        requestMetadata()
      )
    );

    const blocked = await availability(fixture, "2030-03-01", "2030-03-02");
    expect(blocked.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
    expect(blocked.days[0]?.fullProperty?.roomInventoryConflict).toBe(true);
    expect(blocked.days[0]?.fullProperty?.sellableQuantity).toBe(0);

    await db
      .transaction()
      .execute((trx) =>
        service.releaseBlock(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          block.block.id,
          "Maintenance completed",
          requestMetadata()
        )
      );

    const released = await availability(fixture, "2030-03-01", "2030-03-02");
    expect(released.days[0]?.roomCategories[0]?.sellableQuantity).toBe(2);
    expect(released.days[0]?.fullProperty?.sellableQuantity).toBe(1);
  });

  it("uses a property-level block to close both room and full-property sales", async () => {
    const fixture = await createInventoryFixture("BOTH", 2);
    const service = new InventoryService();

    await db.transaction().execute((trx) =>
      service.createBlock(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          scopeType: "PROPERTY",
          roomCategoryId: null,
          physicalUnitId: null,
          blockType: "OWNER_USE",
          startDate: "2030-04-01",
          endDate: "2030-04-03",
          quantity: 1,
          reason: "Owner family stay"
        },
        requestMetadata()
      )
    );

    const result = await availability(fixture, "2030-04-01", "2030-04-02");
    expect(result.days[0]?.propertyClosed).toBe(true);
    expect(result.days[0]?.roomCategories[0]?.sellableQuantity).toBe(0);
    expect(result.days[0]?.fullProperty?.sellableQuantity).toBe(0);
  });

  it("supports room-category overbooking controls but stop-sell always wins", async () => {
    const fixture = await createInventoryFixture("ROOMS_ONLY", 2);
    const service = new InventoryService();

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: fixture.roomCategoryId,
          startDate: "2030-05-01",
          endDate: "2030-05-02",
          stopSell: false,
          overbookingLimit: 1
        },
        requestMetadata()
      )
    );

    const open = await availability(fixture, "2030-05-01", "2030-05-02");
    expect(open.days[0]?.roomCategories[0]?.sellableQuantity).toBe(3);

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: fixture.roomCategoryId,
          startDate: "2030-05-01",
          endDate: "2030-05-02",
          stopSell: true,
          overbookingLimit: null
        },
        requestMetadata()
      )
    );

    const stopped = await availability(fixture, "2030-05-01", "2030-05-02");
    expect(stopped.days[0]?.roomCategories[0]?.sellableQuantity).toBe(0);
  });

  it("keeps room and full-property stop-sell controls commercially independent in BOTH mode", async () => {
    const fixture = await createInventoryFixture("BOTH", 2);
    const service = new InventoryService();

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: fixture.roomCategoryId,
          startDate: "2030-05-10",
          endDate: "2030-05-11",
          stopSell: true,
          overbookingLimit: null
        },
        requestMetadata()
      )
    );

    const roomsStopped = await availability(fixture, "2030-05-10", "2030-05-11");
    expect(roomsStopped.days[0]?.roomCategories[0]?.sellableQuantity).toBe(0);
    expect(roomsStopped.days[0]?.fullProperty?.sellableQuantity).toBe(1);

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: fixture.roomCategoryId,
          startDate: "2030-05-10",
          endDate: "2030-05-11",
          stopSell: false,
          overbookingLimit: null
        },
        requestMetadata()
      )
    );

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "FULL_PROPERTY",
          roomCategoryId: null,
          startDate: "2030-05-10",
          endDate: "2030-05-11",
          stopSell: true,
          overbookingLimit: null
        },
        requestMetadata()
      )
    );

    const villaStopped = await availability(fixture, "2030-05-10", "2030-05-11");
    expect(villaStopped.days[0]?.roomCategories[0]?.sellableQuantity).toBe(2);
    expect(villaStopped.days[0]?.fullProperty?.sellableQuantity).toBe(0);
  });

  it("never allows overbooking on a full-property product", async () => {
    const fixture = await createInventoryFixture("FULL_PROPERTY_ONLY", 0);

    await expect(
      db.transaction().execute((trx) =>
        new InventoryService().setControls(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            bucketType: "FULL_PROPERTY",
            roomCategoryId: null,
            startDate: "2030-06-01",
            endDate: "2030-06-02",
            stopSell: false,
            overbookingLimit: 1
          },
          requestMetadata()
        )
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("rejects overlapping physical-unit blocks", async () => {
    const fixture = await createInventoryFixture("ROOMS_ONLY", 1);
    const service = new InventoryService();
    const unitId = fixture.physicalUnitIds[0] ?? null;

    await db.transaction().execute((trx) =>
      service.createBlock(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          scopeType: "PHYSICAL_UNIT",
          roomCategoryId: fixture.roomCategoryId,
          physicalUnitId: unitId,
          blockType: "MAINTENANCE",
          startDate: "2030-07-01",
          endDate: "2030-07-05",
          quantity: 1,
          reason: "Maintenance"
        },
        requestMetadata()
      )
    );

    await expect(
      db.transaction().execute((trx) =>
        service.createBlock(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            scopeType: "PHYSICAL_UNIT",
            roomCategoryId: fixture.roomCategoryId,
            physicalUnitId: unitId,
            blockType: "RENOVATION",
            startDate: "2030-07-04",
            endDate: "2030-07-06",
            quantity: 1,
            reason: "Renovation"
          },
          requestMetadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("records control changes in audit, inventory-event and outbox streams", async () => {
    const fixture = await createInventoryFixture("ROOMS_ONLY", 2);
    const service = new InventoryService();

    await db.transaction().execute((trx) =>
      service.setControls(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          bucketType: "ROOM_CATEGORY",
          roomCategoryId: fixture.roomCategoryId,
          startDate: "2030-08-01",
          endDate: "2030-08-03",
          stopSell: false,
          overbookingLimit: 1
        },
        requestMetadata()
      )
    );

    const [audit, event, outbox] = await Promise.all([
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("action", "=", "inventory.controls.changed")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("inventory_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("event_type", "=", "CONTROL_CHANGED")
        .orderBy("created_at", "desc")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_id", "=", fixture.propertyId)
        .where("event_type", "=", "inventory.controls.changed.v1")
        .orderBy("occurred_at", "desc")
        .executeTakeFirstOrThrow()
    ]);

    expect(audit.entity_type).toBe("inventory_control_range");
    expect(event.room_category_id).toBe(fixture.roomCategoryId);
    expect(outbox.aggregate_type).toBe("property");

    await expect(
      db
        .updateTable("inventory_events")
        .set({ quantity_delta: 99 })
        .where("id", "=", event.id)
        .execute()
    ).rejects.toThrow(/append-only/i);
  });
});
