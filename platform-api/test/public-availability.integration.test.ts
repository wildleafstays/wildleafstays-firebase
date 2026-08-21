import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { registerPublicCatalogRoutes } from "../src/modules/public-booking/transport/public-catalog-routes.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import { registerErrorHandler } from "../src/shared/http/error-handler.js";

const config = loadConfig();
const db = createDatabase(config);

interface Fixture {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  publicSlug: string;
  roomCategoryId: string;
  roomProductId: string;
  fullProductId: string;
}

let app: FastifyInstance;
let fixture: Fixture;

function metadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "integration-test",
    ipAddress: null,
    userAgent: null
  };
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const authSubject = `phase6b-${suffix}`;

  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 6B Owner",
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
        legalName: `Phase 6B Organization ${suffix}`,
        tradingName: "Wildleaf Public Availability",
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
        name: `Phase 6B Property ${suffix}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  const propertyId = property.property.id;
  const publicSlug = `phase-6b-${suffix}`;

  await db
    .updateTable("properties")
    .set({
      property_type: "VILLA",
      sale_mode: "BOTH",
      locality: "Public Hills",
      city: "Public Test City",
      state_region: "Himachal Pradesh",
      country_code: "IN"
    })
    .where("id", "=", propertyId)
    .execute();

  const setup = new PropertySetupService();
  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        code: "PUBLIC-DLX",
        name: "Public Deluxe",
        accommodationType: "ROOM",
        description: "Phase 6B public room",
        baseOccupancy: 2,
        maxAdults: 3,
        maxChildren: 2,
        maxOccupancy: 4,
        sizeSqm: 30,
        bedConfiguration: "1 King Bed",
        extraBedAllowed: true,
        defaultViewLabel: "Valley View",
        sortOrder: 1
      },
      metadata()
    )
  );

  for (let index = 0; index < 2; index++) {
    await db.transaction().execute((trx) =>
      setup.createPhysicalUnit(
        trx,
        actor,
        {
          organizationId: organization.organizationId,
          propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `PUBLIC-${index + 1}-${suffix}`,
          displayName: `Public Room ${index + 1}`,
          hasView: true,
          viewLabel: "Valley View",
          wheelchairAccessible: false,
          stepFreeAccessible: false,
          liftAccessible: false,
          smokingPolicy: "NON_SMOKING",
          internalNotes: "Private test note",
          sortOrder: index + 1
        },
        metadata()
      )
    );
  }

  const rates = new RateService();
  const plan = await db.transaction().execute((trx) =>
    rates.createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        code: "PUBLIC-EP",
        name: "Public Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const roomProduct = await db.transaction().execute((trx) =>
    rates.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        ratePlanId: plan.ratePlan.id,
        productType: "ROOM_CATEGORY",
        roomCategoryId: category.roomCategory.id,
        baseRateMinor: 500_000,
        floorRateMinor: 300_000,
        ceilingRateMinor: 900_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 3,
        maxChildren: 2,
        maxOccupancy: 4,
        extraAdultMinor: 100_000,
        extraChildMinor: 50_000,
        expectedVersion: null
      },
      metadata()
    )
  );

  const fullProduct = await db.transaction().execute((trx) =>
    rates.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        ratePlanId: plan.ratePlan.id,
        productType: "FULL_PROPERTY",
        roomCategoryId: null,
        baseRateMinor: 1_200_000,
        floorRateMinor: 1_000_000,
        ceilingRateMinor: 2_000_000,
        includedAdults: 4,
        includedChildren: 2,
        maxAdults: 8,
        maxChildren: 4,
        maxOccupancy: 10,
        extraAdultMinor: 100_000,
        extraChildMinor: 50_000,
        expectedVersion: null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    rates.setCalendarDays(
      trx,
      actor,
      organization.organizationId,
      propertyId,
      roomProduct.rateProduct.id,
      [
        {
          stayDate: "2032-01-10",
          rateMinor: 550_000,
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
          stayDate: "2032-01-20",
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
        },
        {
          stayDate: "2032-01-25",
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

  await db
    .updateTable("properties")
    .set({
      status: "LIVE",
      public_slug: publicSlug,
      live_at: new Date()
    })
    .where("id", "=", propertyId)
    .execute();

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId,
    publicSlug,
    roomCategoryId: category.roomCategory.id,
    roomProductId: roomProduct.rateProduct.id,
    fullProductId: fullProduct.rateProduct.id
  };
}

async function postAvailability(
  arrivalDate: string,
  departureDate: string,
  units: Array<{ adults: number; children: number }>
) {
  return app.inject({
    method: "POST",
    url: `/v1/public/properties/${fixture.publicSlug}/availability`,
    payload: {
      arrivalDate,
      departureDate,
      units
    }
  });
}

async function createRoomHold(
  startDate: string,
  endDate: string,
  expiry: "PAST" | "FUTURE"
): Promise<string> {
  const result = await db.transaction().execute((trx) =>
    new InventoryHoldService().createHold(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        startDate,
        endDate,
        ttlSeconds: 300,
        clientReference: `phase6b-${randomUUID()}`,
        items: [
          {
            bucketType: "ROOM_CATEGORY",
            roomCategoryId: fixture.roomCategoryId,
            quantity: 1
          }
        ]
      },
      metadata()
    )
  );

  const expiresAt =
    expiry === "PAST" ? new Date(Date.now() - 60_000) : new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .updateTable("inventory_holds")
    .set({ expires_at: expiresAt })
    .where("id", "=", result.hold.id)
    .execute();

  return result.hold.id;
}

async function sideEffectState(startDate: string, endDate: string, holdId?: string) {
  const [buckets, audit, inventoryEvents, property, hold] = await Promise.all([
    db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "stay_date", "held_quantity", "confirmed_quantity", "version", "updated_at"])
      .where("property_id", "=", fixture.propertyId)
      .where("stay_date", ">=", startDate)
      .where("stay_date", "<", endDate)
      .orderBy("stay_date")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("audit_events")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", fixture.propertyId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("inventory_events")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", fixture.propertyId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("properties")
      .select(["version", "updated_at"])
      .where("id", "=", fixture.propertyId)
      .executeTakeFirstOrThrow(),
    holdId
      ? db
          .selectFrom("inventory_holds")
          .select(["status", "expires_at", "released_at", "release_reason", "updated_at"])
          .where("id", "=", holdId)
          .executeTakeFirstOrThrow()
      : Promise.resolve(null)
  ]);

  return {
    buckets: buckets.map((row) => ({
      ...row,
      updated_at: row.updated_at.toISOString()
    })),
    audit: Number(audit.count),
    inventoryEvents: Number(inventoryEvents.count),
    propertyVersion: property.version,
    propertyUpdatedAt: property.updated_at.toISOString(),
    hold:
      hold === null
        ? null
        : {
            status: hold.status,
            expiresAt: hold.expires_at.toISOString(),
            releasedAt: hold.released_at?.toISOString() ?? null,
            releaseReason: hold.release_reason,
            updatedAt: hold.updated_at.toISOString()
          }
  };
}

beforeAll(async () => {
  fixture = await createFixture();
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerPublicCatalogRoutes(app, { db });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Phase 6B public availability and rate preview", () => {
  it("reads virtual inventory without materializing buckets and returns base rate previews", async () => {
    const startDate = "2032-01-10";
    const endDate = "2032-01-12";
    const before = await sideEffectState(startDate, endDate);

    expect(before.buckets).toHaveLength(0);

    const response = await postAvailability(startDate, endDate, [{ adults: 2, children: 1 }]);

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.json() as {
      property: { publicSlug: string; saleMode: string };
      search: { nights: number };
      pricingScope: string;
      exactCommercialPriceIncluded: boolean;
      options: Array<{
        rateProductId: string;
        productType: string;
        available: boolean;
        unavailableReasons: string[];
        nightlyFromMinor: number;
        accommodationMinor: number;
        extraGuestMinor: number;
        estimatedTotalMinor: number;
      }>;
    };

    expect(body.property).toEqual(
      expect.objectContaining({
        publicSlug: fixture.publicSlug,
        saleMode: "BOTH"
      })
    );
    expect(body.search.nights).toBe(2);
    expect(body.pricingScope).toBe("BASE_RATE_AND_EXTRA_GUEST_ONLY");
    expect(body.exactCommercialPriceIncluded).toBe(false);

    const room = body.options.find((option) => option.rateProductId === fixture.roomProductId);
    expect(room).toMatchObject({
      productType: "ROOM_CATEGORY",
      available: true,
      unavailableReasons: [],
      nightlyFromMinor: 500_000,
      accommodationMinor: 1_050_000,
      extraGuestMinor: 100_000,
      estimatedTotalMinor: 1_150_000
    });

    const full = body.options.find((option) => option.rateProductId === fixture.fullProductId);
    expect(full).toMatchObject({
      productType: "FULL_PROPERTY",
      available: true,
      unavailableReasons: [],
      accommodationMinor: 2_400_000,
      extraGuestMinor: 0,
      estimatedTotalMinor: 2_400_000
    });

    const after = await sideEffectState(startDate, endDate);
    expect(after).toEqual(before);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.propertyId);
    expect(serialized).not.toContain("heldQuantity");
    expect(serialized).not.toContain("confirmedQuantity");
    expect(serialized).not.toContain("overbookingLimit");
    expect(serialized).not.toContain("physicalCapacity");
  });

  it("enforces public rate restrictions and occupancy without creating a quote or hold", async () => {
    const minimumStay = await postAvailability("2032-01-20", "2032-01-22", [
      { adults: 2, children: 0 }
    ]);
    expect(minimumStay.statusCode).toBe(200);

    const minimumBody = minimumStay.json() as {
      options: Array<{
        rateProductId: string;
        available: boolean;
        unavailableReasons: string[];
      }>;
    };

    expect(
      minimumBody.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining(["MINIMUM_STAY"])
    });

    const stopSell = await postAvailability("2032-01-25", "2032-01-27", [
      { adults: 2, children: 0 }
    ]);
    expect(stopSell.statusCode).toBe(200);

    const stopBody = stopSell.json() as typeof minimumBody;
    expect(
      stopBody.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining(["RATE_STOP_SELL"])
    });

    const occupancy = await postAvailability("2032-01-10", "2032-01-12", [
      { adults: 4, children: 0 }
    ]);
    expect(occupancy.statusCode).toBe(200);

    const occupancyBody = occupancy.json() as typeof minimumBody;
    expect(
      occupancyBody.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining(["OCCUPANCY_EXCEEDED"])
    });
    expect(
      occupancyBody.options.find((option) => option.rateProductId === fixture.fullProductId)
    ).toMatchObject({
      available: true,
      unavailableReasons: []
    });
  });

  it("ignores an expired active hold in memory without expiring or mutating it", async () => {
    const startDate = "2032-02-01";
    const endDate = "2032-02-03";
    const holdId = await createRoomHold(startDate, endDate, "PAST");
    const before = await sideEffectState(startDate, endDate, holdId);

    expect(before.buckets).toHaveLength(4);
    expect(before.buckets.filter((row) => row.held_quantity === 1)).toHaveLength(2);
    expect(before.hold?.status).toBe("ACTIVE");

    const response = await postAvailability(startDate, endDate, [
      { adults: 1, children: 0 },
      { adults: 1, children: 0 }
    ]);

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      options: Array<{
        rateProductId: string;
        available: boolean;
        unavailableReasons: string[];
        requestedUnits: number;
      }>;
    };

    expect(
      body.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      requestedUnits: 2,
      available: true,
      unavailableReasons: []
    });

    const after = await sideEffectState(startDate, endDate, holdId);
    expect(after).toEqual(before);
    expect(after.hold?.status).toBe("ACTIVE");
  });

  it("counts a live hold against room inventory and full-property compatibility", async () => {
    const startDate = "2032-02-10";
    const endDate = "2032-02-12";
    const holdId = await createRoomHold(startDate, endDate, "FUTURE");
    const before = await sideEffectState(startDate, endDate, holdId);

    const twoRooms = await postAvailability(startDate, endDate, [
      { adults: 1, children: 0 },
      { adults: 1, children: 0 }
    ]);
    expect(twoRooms.statusCode).toBe(200);

    const twoBody = twoRooms.json() as {
      options: Array<{
        rateProductId: string;
        available: boolean;
        unavailableReasons: string[];
      }>;
    };

    expect(
      twoBody.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining(["INVENTORY_UNAVAILABLE"])
    });

    const oneRoom = await postAvailability(startDate, endDate, [{ adults: 2, children: 0 }]);
    expect(oneRoom.statusCode).toBe(200);

    const oneBody = oneRoom.json() as typeof twoBody;
    expect(
      oneBody.options.find((option) => option.rateProductId === fixture.roomProductId)
    ).toMatchObject({
      available: true,
      unavailableReasons: []
    });
    expect(
      oneBody.options.find((option) => option.rateProductId === fixture.fullProductId)
    ).toMatchObject({
      available: false,
      unavailableReasons: expect.arrayContaining(["INVENTORY_UNAVAILABLE"])
    });

    const after = await sideEffectState(startDate, endDate, holdId);
    expect(after).toEqual(before);
  });

  it("returns 404 for a non-live public property slug", async () => {
    const draftId = randomUUID();
    const draftSlug = `phase-6b-draft-${randomUUID().replaceAll("-", "").slice(0, 8)}`;

    await db
      .insertInto("properties")
      .values({
        id: draftId,
        organization_id: fixture.organizationId,
        public_slug: draftSlug,
        name: "Phase 6B Draft",
        status: "DRAFT",
        timezone: "Asia/Kolkata",
        property_type: "HOTEL",
        sale_mode: "ROOMS_ONLY",
        country_code: "IN"
      })
      .execute();

    const response = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${draftSlug}/availability`,
      payload: {
        arrivalDate: "2032-01-10",
        departureDate: "2032-01-12",
        units: [{ adults: 2, children: 0 }]
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Public property not found"
      }
    });
  });
});
