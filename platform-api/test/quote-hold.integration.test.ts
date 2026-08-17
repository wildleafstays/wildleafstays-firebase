import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
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

describe("Phase 4C quote to inventory hold", () => {
  it("atomically converts a final room quote into one linked active inventory hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);

    const result = await createQuoteHold(fixture, quoted.quote.id);

    expect(result.created).toBe(true);
    expect(result.quoteHold.quoteId).toBe(quoted.quote.id);
    expect(result.quoteHold.quoteReference).toBe(quoted.quote.quoteReference);
    expect(result.quoteHold.hold).toMatchObject({
      status: "ACTIVE",
      startDate: quoted.quote.arrivalDate,
      endDate: quoted.quote.departureDate,
      clientReference: quoted.quote.quoteReference
    });
    expect(result.quoteHold.hold.items).toEqual([
      expect.objectContaining({
        bucketType: "ROOM_CATEGORY",
        roomCategoryId: fixture.roomCategoryId,
        quantity: 1
      })
    ]);
    expect(new Date(result.quoteHold.hold.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(quoted.quote.expiresAt).getTime()
    );

    const linkCount = await db
      .selectFrom("quote_inventory_holds")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("quote_id", "=", quoted.quote.id)
      .executeTakeFirstOrThrow();
    expect(Number(linkCount.count)).toBe(1);

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "quote_inventory_hold")
      .where("entity_id", "=", result.quoteHold.id)
      .executeTakeFirst();
    expect(audit?.action).toBe("quote.hold.created");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "quote")
      .where("aggregate_id", "=", quoted.quote.id)
      .where("event_type", "=", "quote.hold.created.v1")
      .executeTakeFirst();
    expect(outbox?.event_type).toBe("quote.hold.created.v1");
  });

  it("returns the same active hold on a repeated quote-hold command without double holding", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);

    const first = await createQuoteHold(fixture, quoted.quote.id);
    const second = await createQuoteHold(fixture, quoted.quote.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.quoteHold.inventoryHoldId).toBe(first.quoteHold.inventoryHoldId);

    const holds = await db
      .selectFrom("inventory_holds")
      .select("id")
      .where("client_reference", "=", quoted.quote.quoteReference)
      .execute();
    expect(holds).toHaveLength(1);
  });

  it("lets a FRONT_DESK reservation manager create the quote-linked hold without inventory-manage permission", async () => {
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
    const result = await createQuoteHold(fixture, quoted.quote.id, frontDeskActor);

    expect(result.quoteHold.hold.status).toBe("ACTIVE");
    expect(result.created).toBe(true);
  });

  it("rejects a quote whose commercial promotion layer is not fully evaluated", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    const quoted = await createFinalQuote(fixture);

    expect(quoted.quote.holdEligible).toBe(false);
    expect(quoted.quote.promotionStatus).toBe("NOT_EVALUATED");

    await expect(createQuoteHold(fixture, quoted.quote.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("rejects a quote with less than one safe minute remaining", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);

    const future = new Date(new Date(quoted.quote.expiresAt).getTime() - 30_000);
    const service = new QuoteHoldService(() => future);

    await expect(
      createQuoteHold(fixture, quoted.quote.id, fixture.actor, service)
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("revalidates live inventory and refuses a quote after its inventory has been consumed", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);

    await db.transaction().execute((trx) =>
      new InventoryHoldService().createHold(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          startDate: quoted.quote.arrivalDate,
          endDate: quoted.quote.departureDate,
          ttlSeconds: 900,
          clientReference: `consume-${randomUUID()}`,
          items: [
            {
              bucketType: "ROOM_CATEGORY",
              roomCategoryId: fixture.roomCategoryId,
              quantity: 2
            }
          ]
        },
        metadata()
      )
    );

    await expect(createQuoteHold(fixture, quoted.quote.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const link = await db
      .selectFrom("quote_inventory_holds")
      .select("id")
      .where("quote_id", "=", quoted.quote.id)
      .executeTakeFirst();
    expect(link).toBeUndefined();
  });

  it("maps a final full-property quote to the canonical FULL_PROPERTY inventory bucket", async () => {
    const fixture = await createFixture();
    const fullProductId = await createFullPropertyRateProduct(fixture);
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture, { rateProductId: fullProductId });

    expect(quoted.quote.productType).toBe("FULL_PROPERTY");
    const result = await createQuoteHold(fixture, quoted.quote.id);

    expect(result.quoteHold.hold.items).toEqual([
      expect.objectContaining({
        bucketType: "FULL_PROPERTY",
        roomCategoryId: null,
        quantity: 1
      })
    ]);
  });

  it("keeps the quote-to-hold linkage immutable", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const result = await createQuoteHold(fixture, quoted.quote.id);

    await expect(
      db
        .updateTable("quote_inventory_holds")
        .set({ request_id: randomUUID() })
        .where("id", "=", result.quoteHold.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("quote_inventory_holds").where("id", "=", result.quoteHold.id).execute()
    ).rejects.toThrow(/immutable/i);
  });
});
