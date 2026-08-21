import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import type { RateProductType } from "../src/modules/rates/domain/rates.js";

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
}

async function createFixture(
  saleMode: "ROOMS_ONLY" | "FULL_PROPERTY_ONLY" | "BOTH",
  withRoomCategory = true
): Promise<Fixture> {
  const authSubject = `phase3d-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 3D Owner",
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
        legalName: `Rate Org ${randomUUID()}`,
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
        name: `Rate Property ${randomUUID()}`,
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

  if (withRoomCategory) {
    const category = await db.transaction().execute((trx) =>
      new PropertySetupService().createRoomCategory(
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
    roomCategoryId = category.roomCategory.id;
  }

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    roomCategoryId
  };
}

async function createPlan(fixture: Fixture, code = `EP-${randomUUID().slice(0, 6)}`) {
  return db.transaction().execute((trx) =>
    new RateService().createRatePlan(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code,
        name: "Flexible Room Only",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );
}

async function configureProduct(
  fixture: Fixture,
  ratePlanId: string,
  productType: RateProductType,
  overrides: Partial<{
    roomCategoryId: string | null;
    baseRateMinor: number;
    floorRateMinor: number;
    ceilingRateMinor: number;
    includedAdults: number;
    includedChildren: number;
    maxAdults: number;
    maxChildren: number;
    maxOccupancy: number;
    extraAdultMinor: number;
    extraChildMinor: number;
    expectedVersion: number | null;
  }> = {}
) {
  return db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        ratePlanId,
        productType,
        roomCategoryId:
          overrides.roomCategoryId ??
          (productType === "ROOM_CATEGORY" ? fixture.roomCategoryId : null),
        baseRateMinor: overrides.baseRateMinor ?? 500_000,
        floorRateMinor: overrides.floorRateMinor ?? 300_000,
        ceilingRateMinor: overrides.ceilingRateMinor ?? 900_000,
        includedAdults: overrides.includedAdults ?? 2,
        includedChildren: overrides.includedChildren ?? 0,
        maxAdults: overrides.maxAdults ?? (productType === "ROOM_CATEGORY" ? 3 : 8),
        maxChildren: overrides.maxChildren ?? (productType === "ROOM_CATEGORY" ? 2 : 4),
        maxOccupancy: overrides.maxOccupancy ?? (productType === "ROOM_CATEGORY" ? 4 : 10),
        extraAdultMinor: overrides.extraAdultMinor ?? 100_000,
        extraChildMinor: overrides.extraChildMinor ?? 50_000,
        expectedVersion: overrides.expectedVersion ?? null
      },
      metadata()
    )
  );
}

describe("Phase 3D rate plan and nightly rate foundation", () => {
  it("creates a rate plan in the organization currency", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const result = await createPlan(fixture, "EP-FLEX");

    expect(result.ratePlan.code).toBe("EP-FLEX");
    expect(result.ratePlan.currencyCode).toBe("INR");
    expect(result.ratePlan.mealPlanCode).toBe("EP");
  });

  it("configures room-category pricing with occupancy guardrails", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);

    const result = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    expect(result.rateProduct.roomCategoryId).toBe(fixture.roomCategoryId);
    expect(result.rateProduct.baseRateMinor).toBe(500_000);
    expect(result.rateProduct.version).toBe(1);

    const listed = await db
      .transaction()
      .execute((trx) =>
        new RateService().listRateProducts(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId
        )
      );
    expect(listed.rateProducts).toEqual([result.rateProduct]);
  });

  it("supports full-property-only rates without room categories", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", false);
    const plan = await createPlan(fixture);

    const result = await configureProduct(fixture, plan.ratePlan.id, "FULL_PROPERTY");

    expect(result.rateProduct.productType).toBe("FULL_PROPERTY");
    expect(result.rateProduct.roomCategoryId).toBeNull();
  });

  it("rejects product types that contradict the property sale mode", async () => {
    const fixture = await createFixture("FULL_PROPERTY_ONLY", false);
    const plan = await createPlan(fixture);

    await expect(
      configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY", {
        roomCategoryId: randomUUID()
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("returns base pricing for dates with no explicit override", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    const calendar = await db
      .transaction()
      .execute((trx) =>
        new RateService().getCalendar(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          product.rateProduct.id,
          "2033-01-01",
          "2033-01-04"
        )
      );

    expect(calendar.days).toHaveLength(3);
    expect(calendar.days.every((day) => day.source === "BASE")).toBe(true);
    expect(calendar.days.every((day) => day.rateMinor === 500_000)).toBe(true);
  });

  it("applies dated rate and restriction overrides", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    await db.transaction().execute((trx) =>
      new RateService().setCalendarDays(
        trx,
        fixture.actor,
        fixture.organizationId,
        fixture.propertyId,
        product.rateProduct.id,
        [
          {
            stayDate: "2033-02-10",
            rateMinor: 650_000,
            extraAdultMinor: 120_000,
            extraChildMinor: null,
            minimumStay: 2,
            maximumStay: 5,
            closedToArrival: false,
            closedToDeparture: true,
            stopSell: false,
            source: "REVENUE",
            expectedVersion: null
          }
        ],
        metadata()
      )
    );

    const calendar = await db
      .transaction()
      .execute((trx) =>
        new RateService().getCalendar(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          product.rateProduct.id,
          "2033-02-10",
          "2033-02-11"
        )
      );

    expect(calendar.days[0]).toMatchObject({
      rateMinor: 650_000,
      extraAdultMinor: 120_000,
      extraChildMinor: 50_000,
      minimumStay: 2,
      maximumStay: 5,
      closedToDeparture: true,
      source: "REVENUE",
      overrideVersion: 1
    });
  });

  it("enforces floor and ceiling guardrails", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    await expect(
      db.transaction().execute((trx) =>
        new RateService().setCalendarDays(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          product.rateProduct.id,
          [
            {
              stayDate: "2033-03-01",
              rateMinor: 950_000,
              extraAdultMinor: null,
              extraChildMinor: null,
              minimumStay: 1,
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
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("prevents stale rate-product updates with optimistic version checks", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    const updated = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY", {
      baseRateMinor: 550_000,
      expectedVersion: product.rateProduct.version
    });
    expect(updated.rateProduct.version).toBe(2);

    await expect(
      configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY", {
        baseRateMinor: 575_000,
        expectedVersion: product.rateProduct.version
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("rolls back an entire calendar batch when one day is invalid", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    await expect(
      db.transaction().execute((trx) =>
        new RateService().setCalendarDays(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          product.rateProduct.id,
          [
            {
              stayDate: "2033-04-01",
              rateMinor: 600_000,
              extraAdultMinor: null,
              extraChildMinor: null,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false,
              source: "MANUAL",
              expectedVersion: null
            },
            {
              stayDate: "2033-04-02",
              rateMinor: 1_500_000,
              extraAdultMinor: null,
              extraChildMinor: null,
              minimumStay: 1,
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
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const count = await db
      .selectFrom("rate_calendar_days")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("rate_product_id", "=", product.rateProduct.id)
      .executeTakeFirstOrThrow();

    expect(Number(count.count)).toBe(0);
  });

  it("writes auditable rate events and protects event history", async () => {
    const fixture = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(fixture);
    const product = await configureProduct(fixture, plan.ratePlan.id, "ROOM_CATEGORY");

    const event = await db
      .selectFrom("rate_events")
      .selectAll()
      .where("rate_product_id", "=", product.rateProduct.id)
      .where("event_type", "=", "RATE_PRODUCT_CREATED")
      .executeTakeFirstOrThrow();

    const audit = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("entity_type", "=", "rate_product")
      .where("entity_id", "=", product.rateProduct.id)
      .executeTakeFirstOrThrow();

    const outbox = await db
      .selectFrom("outbox_events")
      .selectAll()
      .where("aggregate_type", "=", "rate_product")
      .where("aggregate_id", "=", product.rateProduct.id)
      .executeTakeFirstOrThrow();

    expect(audit.action).toBe("rates.product.created");
    expect(outbox.event_type).toBe("rates.product.created.v1");

    await expect(
      db
        .updateTable("rate_events")
        .set({ event_type: "RATE_PRODUCT_UPDATED" })
        .where("id", "=", event.id)
        .execute()
    ).rejects.toThrow(/append-only/i);
  });

  it("enforces tenant authorization on rate reads", async () => {
    const first = await createFixture("ROOMS_ONLY");
    const second = await createFixture("ROOMS_ONLY");
    const plan = await createPlan(first);
    const product = await configureProduct(first, plan.ratePlan.id, "ROOM_CATEGORY");

    await expect(
      db
        .transaction()
        .execute((trx) =>
          new RateService().getCalendar(
            trx,
            second.actor,
            first.organizationId,
            first.propertyId,
            product.rateProduct.id,
            "2033-05-01",
            "2033-05-02"
          )
        )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });
});
