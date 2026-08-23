import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
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
    rateProductId: rateProduct.rateProduct.id
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

async function createExclusiveTax(fixture: Fixture) {
  const service = new CommercialRuleService();
  const policy = await db.transaction().execute((trx) =>
    service.createTaxPolicy(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: `GST-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: "Configured Tax",
        description: null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createTaxPolicyVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        taxPolicyId: policy.policy.id,
        effectiveFrom: "2034-01-01",
        priceMode: "EXCLUSIVE",
        selectionBasis: "ALWAYS",
        minimumBasisMinor: null,
        maximumBasisMinor: null,
        appliesToAccommodation: true,
        appliesToExtraGuest: true,
        appliesToFee: false,
        components: [
          { code: "CGST", name: "Central component", rateBasisPoints: 900, sortOrder: 1 },
          { code: "SGST", name: "State component", rateBasisPoints: 900, sortOrder: 2 }
        ],
        expectedCurrentVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createTaxAssignment(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        taxPolicyId: policy.policy.id,
        effectiveFrom: "2034-01-01",
        scopeType: "PROPERTY",
        ratePlanId: null,
        rateProductId: null,
        enabled: true
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

async function createPromotion(
  fixture: Fixture,
  input: {
    kind?: "AUTOMATIC" | "PROMO_CODE";
    publicCode?: string | null;
    discountType?: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue?: number;
    priority?: number;
    stackingMode?: "EXCLUSIVE" | "STACKABLE";
    stackGroup?: string | null;
    propertyEnabled?: boolean;
    rateProductEnabled?: boolean | null;
  } = {}
) {
  const service = new PromotionRuleService();
  const campaign = await db.transaction().execute((trx) =>
    service.createCampaign(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: `PROMO-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: "Quote Promotion",
        description: null,
        promotionKind: input.kind ?? "AUTOMATIC",
        publicCode: input.kind === "PROMO_CODE" ? (input.publicCode ?? "SAVE10") : null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createCampaignVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        promotionCampaignId: campaign.campaign.id,
        effectiveFrom: "2000-01-01",
        bookingWindowStart: null,
        bookingWindowEnd: null,
        arrivalWindowStart: null,
        arrivalWindowEnd: null,
        minimumStayNights: 1,
        minimumSpendMinor: null,
        discountType: input.discountType ?? "PERCENTAGE",
        discountValue: input.discountValue ?? 1000,
        maximumDiscountMinor: null,
        appliesTo: "ACCOMMODATION_AND_EXTRA_GUEST",
        priority: input.priority ?? 10,
        stackingMode: input.stackingMode ?? "EXCLUSIVE",
        stackGroup: input.stackGroup ?? null,
        expectedCurrentVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createAssignment(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        promotionCampaignId: campaign.campaign.id,
        effectiveFrom: "2000-01-01",
        scopeType: "PROPERTY",
        ratePlanId: null,
        rateProductId: null,
        enabled: input.propertyEnabled ?? true
      },
      metadata()
    )
  );

  if (input.rateProductEnabled !== null && input.rateProductEnabled !== undefined) {
    await db.transaction().execute((trx) =>
      service.createAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          promotionCampaignId: campaign.campaign.id,
          effectiveFrom: "2001-01-01",
          scopeType: "RATE_PRODUCT",
          ratePlanId: null,
          rateProductId: fixture.rateProductId,
          enabled: input.rateProductEnabled!
        },
        metadata()
      )
    );
  }

  return campaign.campaign;
}

async function quote(fixture: Fixture, promotionCode: string | null = null) {
  return db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        rateProductId: fixture.rateProductId,
        arrivalDate: "2034-02-10",
        departureDate: "2034-02-12",
        ttlSeconds: 900,
        promotionCode,
        units: [{ adults: 2, childAges: [] }]
      },
      metadata()
    )
  );
}

describe("Phase 4B3b promotion calculation inside quotes", () => {
  it("makes an explicit NO_PROMOTIONS quote fully evaluated and hold-eligible", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");

    const result = await quote(fixture);

    expect(result.quote).toMatchObject({
      promotionStatus: "EVALUATED",
      holdEligible: true,
      discountMinor: 0,
      totalMinor: 1_000_000
    });
    expect(result.quote.promotion?.promotionMode).toBe("NO_PROMOTIONS");
    expect(result.quote.promotion?.lines).toHaveLength(0);
  });

  it("applies an automatic percentage promotion to the final quote", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture);

    const result = await quote(fixture);

    expect(result.quote.discountMinor).toBe(100_000);
    expect(result.quote.discountedAccommodationMinor).toBe(900_000);
    expect(result.quote.totalMinor).toBe(900_000);
    expect(result.quote.promotion?.lines).toHaveLength(1);
  });

  it("recalculates exclusive tax on the post-promotion taxable amount", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, "POLICIES");
    await createExclusiveTax(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture);

    const result = await quote(fixture);

    expect(result.quote.discountMinor).toBe(100_000);
    expect(result.quote.taxMinor).toBe(162_000);
    expect(result.quote.totalMinor).toBe(1_062_000);
    expect(
      result.quote.promotion?.finalTaxLines.reduce((sum, line) => sum + line.taxMinor, 0)
    ).toBe(162_000);
  });

  it("normalizes and applies a requested public promotion code", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture, {
      kind: "PROMO_CODE",
      publicCode: "SAVE100",
      discountType: "FIXED_AMOUNT",
      discountValue: 100_000
    });

    const result = await quote(fixture, " save100 ");

    expect(result.quote.discountMinor).toBe(100_000);
    expect(result.quote.promotion?.requestedPromotionCode).toBe("SAVE100");
    expect(result.quote.promotion?.lines[0]?.publicCode).toBe("SAVE100");
  });

  it("rejects an invalid requested promotion code instead of silently ignoring it", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture);

    await expect(quote(fixture, "NOTREAL")).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("uses only the highest-priority campaign within the same stack group", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture, {
      priority: 20,
      stackingMode: "STACKABLE",
      stackGroup: "MEMBER"
    });
    await createPromotion(fixture, {
      priority: 10,
      stackingMode: "STACKABLE",
      stackGroup: "MEMBER"
    });

    const result = await quote(fixture);

    expect(result.quote.discountMinor).toBe(100_000);
    expect(result.quote.promotion?.lines).toHaveLength(1);
    expect(result.quote.promotion?.lines[0]?.priority).toBe(20);
  });

  it("lets RATE_PRODUCT disabled state override an enabled PROPERTY assignment", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture, { rateProductEnabled: false });

    const result = await quote(fixture);

    expect(result.quote.promotionStatus).toBe("EVALUATED");
    expect(result.quote.holdEligible).toBe(true);
    expect(result.quote.discountMinor).toBe(0);
    expect(result.quote.promotion?.lines).toHaveLength(0);
  });

  it("keeps the Phase 4B2 commercial snapshot immutable and stores final economics separately", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "POLICIES");
    await createPromotion(fixture);

    const result = await quote(fixture);
    const commercial = await db
      .selectFrom("quote_commercial_snapshots")
      .selectAll()
      .where("quote_id", "=", result.quote.id)
      .executeTakeFirstOrThrow();
    const promotion = await db
      .selectFrom("quote_promotion_snapshots")
      .selectAll()
      .where("quote_id", "=", result.quote.id)
      .executeTakeFirstOrThrow();

    expect(commercial.total_minor).toBe(1_000_000);
    expect(commercial.promotion_status).toBe("NOT_EVALUATED");
    expect(commercial.hold_eligible).toBe(false);
    expect(promotion.total_minor).toBe(900_000);
    expect(promotion.hold_eligible).toBe(true);

    await expect(
      db
        .updateTable("quote_promotion_snapshots")
        .set({ total_minor: 1 })
        .where("id", "=", promotion.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });
});
