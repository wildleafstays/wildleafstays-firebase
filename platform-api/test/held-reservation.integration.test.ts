import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
import { HeldReservationService } from "../src/modules/reservations/application/held-reservation-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
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
  ratePlanId: string;
  rateProductId: string;
  roomCategoryId: string;
}

async function createFixture(): Promise<Fixture> {
  const subject = `phase4b3b-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: "Phase 4B3b Owner",
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
        legalName: `Promotion Quote Org ${randomUUID()}`,
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
        name: `Promotion Quote Property ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  await db
    .updateTable("properties")
    .set({ property_type: "HOTEL", sale_mode: "ROOMS_ONLY" })
    .where("id", "=", property.property.id)
    .execute();

  const setup = new PropertySetupService();
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

  for (let index = 1; index <= 2; index++) {
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
          unitCode: `PQ-${index}`,
          displayName: `Promotion Quote Room ${index}`,
          hasView: true,
          viewLabel: "Valley View",
          wheelchairAccessible: false,
          stepFreeAccessible: false,
          liftAccessible: false,
          smokingPolicy: "NON_SMOKING",
          internalNotes: null,
          sortOrder: index
        },
        metadata()
      )
    );
  }

  const ratePlan = await db.transaction().execute((trx) =>
    new RateService().createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: "EP-PROMO",
        name: "Promotion Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const rateProduct = await db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        ratePlanId: ratePlan.ratePlan.id,
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

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    ratePlanId: ratePlan.ratePlan.id,
    rateProductId: rateProduct.rateProduct.id,
    roomCategoryId: category.roomCategory.id
  };
}

async function configureCommercialCore(
  fixture: Fixture,
  taxMode: "NO_TAX" | "POLICIES" = "NO_TAX"
) {
  const service = new CommercialRuleService();
  const effectiveFrom = "2034-01-01";

  await db.transaction().execute((trx) =>
    service.setPropertyCommercialSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom,
        taxMode,
        feeMode: "NO_FEES",
        expectedVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.setGuestAgePolicy(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom,
        infantMaxAge: 4,
        childMaxAge: 12,
        infantsCountTowardsOccupancy: false,
        infantsCountTowardsChildLimit: false,
        infantsChargeAsChildren: false,
        expectedVersion: 0
      },
      metadata()
    )
  );

  const cancellation = await db.transaction().execute((trx) =>
    service.createCancellationPolicy(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: "FLEX",
        name: "Flexible Cancellation",
        description: null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createCancellationPolicyVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        cancellationPolicyId: cancellation.policy.id,
        effectiveFrom,
        arrivalLocalTime: "14:00",
        policyText: "Flexible cancellation snapshot.",
        tiers: [
          {
            triggerType: "CANCELLATION",
            minimumMinutesBeforeArrival: 0,
            penaltyType: "PERCENTAGE_OF_STAY",
            penaltyValue: 10000
          },
          {
            triggerType: "NO_SHOW",
            minimumMinutesBeforeArrival: null,
            penaltyType: "PERCENTAGE_OF_STAY",
            penaltyValue: 10000
          }
        ],
        expectedCurrentVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createCancellationAssignment(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        ratePlanId: fixture.ratePlanId,
        cancellationPolicyId: cancellation.policy.id,
        effectiveFrom
      },
      metadata()
    )
  );
}

async function setPromotionMode(fixture: Fixture, promotionMode: "NO_PROMOTIONS" | "POLICIES") {
  await db.transaction().execute((trx) =>
    new PromotionRuleService().setSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom: "2000-01-01",
        promotionMode,
        expectedVersion: 0
      },
      metadata()
    )
  );
}

async function createFinalQuote(
  fixture: Fixture,
  options: {
    actor?: ActorContext;
    rateProductId?: string;
    ttlSeconds?: number;
    units?: { adults: number; childAges: number[] }[];
  } = {}
) {
  return db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      options.actor ?? fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        rateProductId: options.rateProductId ?? fixture.rateProductId,
        arrivalDate: "2034-02-10",
        departureDate: "2034-02-12",
        ttlSeconds: options.ttlSeconds ?? 900,
        promotionCode: null,
        units: options.units ?? [{ adults: 2, childAges: [] }]
      },
      metadata()
    )
  );
}

async function createFullPropertyRateProduct(fixture: Fixture): Promise<string> {
  await db
    .updateTable("properties")
    .set({ sale_mode: "BOTH" })
    .where("id", "=", fixture.propertyId)
    .execute();

  const result = await db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        ratePlanId: fixture.ratePlanId,
        productType: "FULL_PROPERTY",
        roomCategoryId: null,
        baseRateMinor: 1_500_000,
        floorRateMinor: 1_000_000,
        ceilingRateMinor: 3_000_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 20,
        maxChildren: 20,
        maxOccupancy: 30,
        extraAdultMinor: 100_000,
        extraChildMinor: 50_000,
        expectedVersion: null
      },
      metadata()
    )
  );

  return result.rateProduct.id;
}

async function createQuoteHold(
  fixture: Fixture,
  quoteId: string,
  actor: ActorContext = fixture.actor,
  service = new QuoteHoldService()
) {
  return db.transaction().execute((trx) =>
    service.createFromQuote(
      trx,
      actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId
      },
      metadata()
    )
  );
}

async function createHeldReservation(
  fixture: Fixture,
  quoteId: string,
  options: {
    actor?: ActorContext;
    name?: string;
    email?: string | null;
    phone?: string | null;
  } = {}
) {
  return db.transaction().execute((trx) =>
    new HeldReservationService().createFromQuoteHold(
      trx,
      options.actor ?? fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId,
        leadGuest: {
          name: options.name ?? "Vishal Test Guest",
          email: options.email === undefined ? "guest@example.invalid" : options.email,
          phone: options.phone === undefined ? "+919876543210" : options.phone
        }
      },
      metadata()
    )
  );
}

describe("Phase 4D canonical HELD reservation", () => {
  it("creates one canonical HELD reservation from a final quote and active quote-linked hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);

    const result = await createHeldReservation(fixture, quoted.quote.id);

    expect(result.created).toBe(true);
    expect(result.reservation).toMatchObject({
      quoteId: quoted.quote.id,
      inventoryHoldId: quoteHold.quoteHold.inventoryHoldId,
      status: "HELD",
      arrivalDate: quoted.quote.arrivalDate,
      departureDate: quoted.quote.departureDate,
      productType: "ROOM_CATEGORY",
      roomCategoryId: fixture.roomCategoryId,
      quantity: 1,
      currencyCode: quoted.quote.currencyCode,
      totalMinor: quoted.quote.totalMinor,
      leadGuest: {
        name: "Vishal Test Guest",
        email: "guest@example.invalid",
        phone: "+919876543210"
      }
    });
    expect(result.reservation.reservationReference).toMatch(/^R-[A-F0-9]{16}$/);
    expect(result.reservation.financial.totalMinor).toBe(quoted.quote.totalMinor);
    expect(result.reservation.financial.discountMinor).toBe(quoted.quote.discountMinor);

    const hold = await db
      .selectFrom("inventory_holds")
      .select("inventory_holds.status")
      .innerJoin("inventory_hold_nights", "inventory_hold_nights.hold_id", "inventory_holds.id")
      .innerJoin(
        "inventory_daily_buckets",
        "inventory_daily_buckets.id",
        "inventory_hold_nights.bucket_id"
      )
      .where("inventory_holds.id", "=", quoteHold.quoteHold.inventoryHoldId)
      .select("inventory_daily_buckets.held_quantity")
      .executeTakeFirstOrThrow();
    expect(hold.status).toBe("ACTIVE");
    expect(hold.held_quantity).toBeGreaterThan(0);

    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("id")
      .where("hold_id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirst();
    expect(allocation).toBeUndefined();

    const history = await db
      .selectFrom("reservation_status_history")
      .select(["sequence_number", "from_status", "to_status", "reason"])
      .where("reservation_id", "=", result.reservation.id)
      .executeTakeFirstOrThrow();
    expect(history).toEqual({
      sequence_number: 1,
      from_status: null,
      to_status: "HELD",
      reason: "QUOTE_HOLD_ACCEPTED"
    });

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "reservation")
      .where("entity_id", "=", result.reservation.id)
      .executeTakeFirst();
    expect(audit?.action).toBe("reservation.held.created");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "reservation")
      .where("aggregate_id", "=", result.reservation.id)
      .executeTakeFirst();
    expect(outbox?.event_type).toBe("reservation.held.created.v1");
  });

  it("returns the same reservation for an exact retry and never duplicates the quote or hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);

    const first = await createHeldReservation(fixture, quoted.quote.id);
    const second = await createHeldReservation(fixture, quoted.quote.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reservation.id).toBe(first.reservation.id);

    const rows = await db
      .selectFrom("reservations")
      .select("id")
      .where("quote_id", "=", quoted.quote.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("rejects a retry that tries to change the immutable lead guest snapshot", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    await createHeldReservation(fixture, quoted.quote.id);

    await expect(
      createHeldReservation(fixture, quoted.quote.id, {
        name: "Different Guest",
        email: "different@example.invalid"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("refuses to create a reservation before the quote has an inventory hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);

    await expect(createHeldReservation(fixture, quoted.quote.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("refuses a reservation after its quote-linked inventory hold has been released", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);

    await db
      .transaction()
      .execute((trx) =>
        new InventoryHoldService().releaseHold(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          quoteHold.quoteHold.inventoryHoldId,
          "TEST_RELEASE",
          metadata()
        )
      );

    await expect(createHeldReservation(fixture, quoted.quote.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("lets a FRONT_DESK reservation manager create the canonical HELD reservation", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");

    const frontDeskActor: ActorContext = {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "FRONT_DESK"
        }
      ]
    };

    const quoted = await createFinalQuote(fixture, { actor: frontDeskActor });
    await createQuoteHold(fixture, quoted.quote.id, frontDeskActor);
    const result = await createHeldReservation(fixture, quoted.quote.id, {
      actor: frontDeskActor
    });

    expect(result.reservation.status).toBe("HELD");
    expect(result.created).toBe(true);
  });

  it("stores accepted economics separately and protects reservation snapshots from mutation", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const result = await createHeldReservation(fixture, quoted.quote.id);

    const financial = await db
      .selectFrom("reservation_financial_snapshots")
      .selectAll()
      .where("reservation_id", "=", result.reservation.id)
      .executeTakeFirstOrThrow();

    expect(financial.quote_id).toBe(quoted.quote.id);
    expect(financial.total_minor).toBe(quoted.quote.totalMinor);
    expect(financial.discounted_accommodation_minor).toBe(
      quoted.quote.discountedAccommodationMinor
    );
    expect(financial.exclusive_tax_minor).toBe(quoted.quote.exclusiveTaxMinor);

    await expect(
      db
        .updateTable("reservation_financial_snapshots")
        .set({ total_minor: financial.total_minor + 1 })
        .where("id", "=", financial.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .updateTable("reservations")
        .set({ total_minor: result.reservation.totalMinor + 1 })
        .where("id", "=", result.reservation.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("creates the same HELD reservation model for a FULL_PROPERTY quote without prematurely confirming inventory", async () => {
    const fixture = await createFixture();
    const fullProductId = await createFullPropertyRateProduct(fixture);
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture, { rateProductId: fullProductId });
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);

    const result = await createHeldReservation(fixture, quoted.quote.id);

    expect(result.reservation).toMatchObject({
      status: "HELD",
      productType: "FULL_PROPERTY",
      roomCategoryId: null,
      quantity: 1,
      inventoryHoldId: quoteHold.quoteHold.inventoryHoldId
    });

    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("id")
      .where("hold_id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirst();
    expect(allocation).toBeUndefined();
  });
});
