import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { InventoryService } from "../src/modules/inventory/application/inventory-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { QuoteService } from "../src/modules/quotes/application/quote-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";

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
  roomCategoryId: string | null;
  ratePlanId: string;
  rateProductId: string;
}

async function createFixture(
  saleMode: "ROOMS_ONLY" | "FULL_PROPERTY_ONLY" | "BOTH",
  roomCapacity = 2,
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY" = "ROOM_CATEGORY"
): Promise<Fixture> {
  const authSubject = `phase4a-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 4A Owner",
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
        legalName: `Quote Org ${randomUUID()}`,
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
        name: `Quote Property ${randomUUID()}`,
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

  let roomCategoryId: string | null = null;
  const setup = new PropertySetupService();

  if (saleMode !== "FULL_PROPERTY_ONLY") {
    const category = await db.transaction().execute((trx) =>
      setup.createRoomCategory(
        trx,
        actor,
        {
          organizationId: organization.organizationId,
          propertyId: property.property.id,
          code: "DELUXE",
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
        metadata()
      )
    );
    const categoryId = category.roomCategory.id;
    roomCategoryId = categoryId;

    for (let unitIndex = 0; unitIndex < roomCapacity; unitIndex++) {
      await db.transaction().execute((trx) =>
        setup.createPhysicalUnit(
          trx,
          actor,
          {
            organizationId: organization.organizationId,
            propertyId: property.property.id,
            roomCategoryId: categoryId,
            structureId: null,
            floorId: null,
            unitCode: `Q-R${unitIndex + 1}`,
            displayName: `Quote Room ${unitIndex + 1}`,
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

  const plan = await db.transaction().execute((trx) =>
    new RateService().createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: "EP-FLEX",
        name: "Flexible Room Only",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const product = await db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        ratePlanId: plan.ratePlan.id,
        productType,
        roomCategoryId: productType === "ROOM_CATEGORY" ? roomCategoryId : null,
        baseRateMinor: 500_000,
        floorRateMinor: 300_000,
        ceilingRateMinor: 900_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: productType === "ROOM_CATEGORY" ? 3 : 8,
        maxChildren: productType === "ROOM_CATEGORY" ? 2 : 4,
        maxOccupancy: productType === "ROOM_CATEGORY" ? 4 : 10,
        extraAdultMinor: 100_000,
        extraChildMinor: 50_000,
        expectedVersion: null
      },
      metadata()
    )
  );

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    roomCategoryId,
    ratePlanId: plan.ratePlan.id,
    rateProductId: product.rateProduct.id
  };
}

async function createQuote(
  fixture: Fixture,
  overrides: Partial<{
    arrivalDate: string;
    departureDate: string;
    ttlSeconds: number;
    units: { adults: number; childAges: number[] }[];
  }> = {}
) {
  return db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        rateProductId: fixture.rateProductId,
        arrivalDate: overrides.arrivalDate ?? "2034-01-10",
        departureDate: overrides.departureDate ?? "2034-01-12",
        ttlSeconds: overrides.ttlSeconds ?? 900,
        units: overrides.units ?? [{ adults: 2, childAges: [] }]
      },
      metadata()
    )
  );
}

describe("Phase 4A immutable quote engine foundation", () => {
  it("creates an immutable pre-tax room quote with occupancy pricing", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 2);
    const result = await createQuote(fixture, {
      units: [{ adults: 3, childAges: [8] }]
    });

    expect(result.quote).toMatchObject({
      ratePlanId: fixture.ratePlanId,
      rateProductId: fixture.rateProductId,
      productType: "ROOM_CATEGORY",
      quantity: 1,
      currencyCode: "INR",
      accommodationMinor: 1_000_000,
      extraGuestMinor: 300_000,
      taxMinor: 0,
      feeMinor: 0,
      totalMinor: 1_300_000,
      commercialStatus: "PRE_TAX_ONLY",
      holdEligible: false,
      expired: false
    });
    expect(result.quote.nights).toHaveLength(2);
    expect(result.quote.units[0]).toMatchObject({
      adults: 3,
      childAges: [8],
      extraAdults: 1,
      extraChildren: 1
    });
  });

  it("does not reserve inventory merely by creating a quote", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 1);

    const before = await db
      .transaction()
      .execute((trx) =>
        new InventoryService().getAvailability(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          "2034-02-01",
          "2034-02-02"
        )
      );

    await createQuote(fixture, {
      arrivalDate: "2034-02-01",
      departureDate: "2034-02-02"
    });

    const after = await db
      .transaction()
      .execute((trx) =>
        new InventoryService().getAvailability(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          "2034-02-01",
          "2034-02-02"
        )
      );

    expect(before.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
    expect(after.days[0]?.roomCategories[0]?.sellableQuantity).toBe(1);
  });

  it("rejects a quote when requested room quantity exceeds canonical inventory", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 1);

    await expect(
      createQuote(fixture, {
        units: [
          { adults: 2, childAges: [] },
          { adults: 2, childAges: [] }
        ]
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("enforces rate stop-sell before writing a quote", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 2);

    await db.transaction().execute((trx) =>
      new RateService().setCalendarDays(
        trx,
        fixture.actor,
        fixture.organizationId,
        fixture.propertyId,
        fixture.rateProductId,
        [
          {
            stayDate: "2034-03-10",
            rateMinor: 500_000,
            extraAdultMinor: null,
            extraChildMinor: null,
            minimumStay: 1,
            maximumStay: null,
            closedToArrival: false,
            closedToDeparture: false,
            stopSell: true,
            source: "MANUAL",
            expectedVersion: null
          }
        ],
        metadata()
      )
    );

    await expect(
      createQuote(fixture, {
        arrivalDate: "2034-03-10",
        departureDate: "2034-03-12"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("enforces minimum stay and arrival restrictions", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 2);

    await db.transaction().execute((trx) =>
      new RateService().setCalendarDays(
        trx,
        fixture.actor,
        fixture.organizationId,
        fixture.propertyId,
        fixture.rateProductId,
        [
          {
            stayDate: "2034-04-10",
            rateMinor: 500_000,
            extraAdultMinor: null,
            extraChildMinor: null,
            minimumStay: 3,
            maximumStay: null,
            closedToArrival: false,
            closedToDeparture: false,
            stopSell: false,
            source: "MANUAL",
            expectedVersion: null
          }
        ],
        metadata()
      )
    );

    await expect(
      createQuote(fixture, {
        arrivalDate: "2034-04-10",
        departureDate: "2034-04-12"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("rejects full-property quotes without active physical-room category sources", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", 0, "FULL_PROPERTY");

    await expect(
      createQuote(fixture, {
        arrivalDate: "2034-05-01",
        departureDate: "2034-05-03",
        units: [{ adults: 4, childAges: [7, 10] }]
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("writes quote event, audit and outbox while protecting the snapshot", async () => {
    const fixture = await createFixture("ROOMS_ONLY", 2);
    const result = await createQuote(fixture);

    const [event, audit, outbox] = await Promise.all([
      db
        .selectFrom("quote_events")
        .selectAll()
        .where("quote_id", "=", result.quote.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("entity_type", "=", "quote")
        .where("entity_id", "=", result.quote.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_type", "=", "quote")
        .where("aggregate_id", "=", result.quote.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(event.event_type).toBe("QUOTE_CREATED");
    expect(audit.action).toBe("quote.created");
    expect(outbox.event_type).toBe("quote.created.v1");

    await expect(
      db
        .updateTable("quotes")
        .set({ total_minor: result.quote.totalMinor + 1 })
        .where("id", "=", result.quote.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("enforces tenant authorization when reading a quote", async () => {
    const first = await createFixture("ROOMS_ONLY", 2);
    const second = await createFixture("ROOMS_ONLY", 2);
    const result = await createQuote(first);

    await expect(
      db
        .transaction()
        .execute((trx) =>
          new QuoteService().getQuote(
            trx,
            second.actor,
            first.organizationId,
            first.propertyId,
            result.quote.id
          )
        )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });
});
