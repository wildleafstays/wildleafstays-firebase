import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";

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

async function createPropertyFixture(): Promise<{
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
}> {
  const authSubject = `phase2b-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 2B Owner",
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
        legalName: `Phase 2B ${randomUUID()}`,
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
        name: `Property ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      requestMetadata()
    )
  );

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id
  };
}

describe("physical property structure foundation", () => {
  it("creates building, floor, category and room as one coherent hierarchy", async () => {
    const fixture = await createPropertyFixture();
    const service = new PropertySetupService();

    const structure = await db.transaction().execute((trx) =>
      service.createStructure(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "MAIN",
          name: "Main Building",
          structureType: "BUILDING",
          sortOrder: 1,
          hasLift: true,
          wheelchairAccessible: true
        },
        requestMetadata()
      )
    );

    const floor = await db.transaction().execute((trx) =>
      service.createFloor(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          structureId: structure.structure.id,
          code: "F1",
          name: "First Floor",
          floorNumber: 1,
          sortOrder: 1,
          liftAccessible: true,
          wheelchairAccessible: true
        },
        requestMetadata()
      )
    );

    const category = await db.transaction().execute((trx) =>
      service.createRoomCategory(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "DLX",
          name: "Deluxe Room",
          accommodationType: "ROOM",
          description: "Deluxe room category",
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

    const unit = await db.transaction().execute((trx) =>
      service.createPhysicalUnit(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: structure.structure.id,
          floorId: floor.floor.id,
          unitCode: "101",
          displayName: "Room 101",
          hasView: true,
          viewLabel: "Valley View",
          wheelchairAccessible: true,
          stepFreeAccessible: true,
          liftAccessible: true,
          smokingPolicy: "NON_SMOKING",
          internalNotes: null,
          sortOrder: 1
        },
        requestMetadata()
      )
    );

    const layout = await service.getLayout(
      db,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId
    );

    expect(layout.structures).toHaveLength(1);
    expect(layout.floors).toHaveLength(1);
    expect(layout.roomCategories).toHaveLength(1);
    expect(layout.physicalUnits).toHaveLength(1);
    expect(layout.physicalUnits[0]?.id).toBe(unit.physicalUnit.id);
  });

  it("supports a standalone named cottage without a building or floor", async () => {
    const fixture = await createPropertyFixture();
    const service = new PropertySetupService();

    const category = await db.transaction().execute((trx) =>
      service.createRoomCategory(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "PCOTT",
          name: "Premium Cottage",
          accommodationType: "COTTAGE",
          description: null,
          baseOccupancy: 2,
          maxAdults: 3,
          maxChildren: 2,
          maxOccupancy: 4,
          sizeSqm: 35,
          bedConfiguration: "1 King Bed",
          extraBedAllowed: true,
          defaultViewLabel: "Garden View",
          sortOrder: 1
        },
        requestMetadata()
      )
    );

    const unit = await db.transaction().execute((trx) =>
      service.createPhysicalUnit(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: "ELLIE-NEST",
          displayName: "Ellie's Nest",
          hasView: true,
          viewLabel: "Garden View",
          wheelchairAccessible: false,
          stepFreeAccessible: false,
          liftAccessible: false,
          smokingPolicy: "NON_SMOKING",
          internalNotes: null,
          sortOrder: 1
        },
        requestMetadata()
      )
    );

    expect(unit.physicalUnit.structureId).toBeNull();
    expect(unit.physicalUnit.floorId).toBeNull();
    expect(unit.physicalUnit.displayName).toBe("Ellie's Nest");
  });

  it("prevents a room category from another property being attached", async () => {
    const fixtureA = await createPropertyFixture();
    const fixtureB = await createPropertyFixture();
    const service = new PropertySetupService();

    const categoryB = await db.transaction().execute((trx) =>
      service.createRoomCategory(
        trx,
        fixtureB.actor,
        {
          organizationId: fixtureB.organizationId,
          propertyId: fixtureB.propertyId,
          code: "OTHER",
          name: "Other Property Room",
          accommodationType: "ROOM",
          description: null,
          baseOccupancy: 2,
          maxAdults: 2,
          maxChildren: 0,
          maxOccupancy: 2,
          sizeSqm: null,
          bedConfiguration: null,
          extraBedAllowed: false,
          defaultViewLabel: null,
          sortOrder: 0
        },
        requestMetadata()
      )
    );

    await expect(
      db.transaction().execute((trx) =>
        service.createPhysicalUnit(
          trx,
          fixtureA.actor,
          {
            organizationId: fixtureA.organizationId,
            propertyId: fixtureA.propertyId,
            roomCategoryId: categoryB.roomCategory.id,
            structureId: null,
            floorId: null,
            unitCode: "BAD-UNIT",
            displayName: null,
            hasView: false,
            viewLabel: null,
            wheelchairAccessible: false,
            stepFreeAccessible: false,
            liftAccessible: false,
            smokingPolicy: "NON_SMOKING",
            internalNotes: null,
            sortOrder: 0
          },
          requestMetadata()
        )
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("locks physical setup after property submission", async () => {
    const fixture = await createPropertyFixture();
    const service = new PropertySetupService();

    await db
      .updateTable("properties")
      .set({ status: "SUBMITTED" })
      .where("id", "=", fixture.propertyId)
      .execute();

    await expect(
      db.transaction().execute((trx) =>
        service.createStructure(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            code: null,
            name: "Late Building",
            structureType: "BUILDING",
            sortOrder: 0,
            hasLift: false,
            wheelchairAccessible: false
          },
          requestMetadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("writes audit and outbox events for a physical unit", async () => {
    const fixture = await createPropertyFixture();
    const service = new PropertySetupService();

    const category = await db.transaction().execute((trx) =>
      service.createRoomCategory(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "HUT",
          name: "Garden Hut",
          accommodationType: "HUT",
          description: null,
          baseOccupancy: 2,
          maxAdults: 2,
          maxChildren: 1,
          maxOccupancy: 3,
          sizeSqm: 25,
          bedConfiguration: "1 Queen Bed",
          extraBedAllowed: false,
          defaultViewLabel: "Garden",
          sortOrder: 0
        },
        requestMetadata()
      )
    );

    const unit = await db.transaction().execute((trx) =>
      service.createPhysicalUnit(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: "HUT-01",
          displayName: "Garden Hut 01",
          hasView: true,
          viewLabel: "Garden",
          wheelchairAccessible: false,
          stepFreeAccessible: true,
          liftAccessible: false,
          smokingPolicy: "NON_SMOKING",
          internalNotes: null,
          sortOrder: 0
        },
        requestMetadata()
      )
    );

    const [audit, outbox] = await Promise.all([
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("entity_type", "=", "physical_unit")
        .where("entity_id", "=", unit.physicalUnit.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("event_type", "=", "property.physical_unit.created.v1")
        .where("aggregate_id", "=", fixture.propertyId)
        .orderBy("occurred_at", "desc")
        .executeTakeFirstOrThrow()
    ]);

    expect(audit.action).toBe("property.physical_unit.created");
    expect(outbox.aggregate_id).toBe(fixture.propertyId);
  });
});
