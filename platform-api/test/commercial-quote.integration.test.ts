import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
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
  const authSubject = `phase4b2-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 4B2 Owner",
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
        legalName: `Commercial Quote Org ${randomUUID()}`,
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
        name: `Commercial Quote Property ${randomUUID()}`,
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
          unitCode: `CQ-${index}`,
          displayName: `Commercial Quote Room ${index}`,
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
        code: "EP-FLEX",
        name: "Flexible Room Only",
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
  options: {
    taxMode?: "NO_TAX" | "POLICIES";
    feeMode?: "NO_FEES" | "POLICIES";
    infantMaxAge?: number | null;
    childMaxAge?: number;
    infantsCountTowardsOccupancy?: boolean;
    infantsCountTowardsChildLimit?: boolean;
    infantsChargeAsChildren?: boolean;
  } = {}
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
        taxMode: options.taxMode ?? "NO_TAX",
        feeMode: options.feeMode ?? "NO_FEES",
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
        infantMaxAge: options.infantMaxAge ?? 4,
        childMaxAge: options.childMaxAge ?? 12,
        infantsCountTowardsOccupancy: options.infantsCountTowardsOccupancy ?? false,
        infantsCountTowardsChildLimit: options.infantsCountTowardsChildLimit ?? false,
        infantsChargeAsChildren: options.infantsChargeAsChildren ?? false,
        expectedVersion: 0
      },
      metadata()
    )
  );

  const policy = await db.transaction().execute((trx) =>
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
        cancellationPolicyId: policy.policy.id,
        effectiveFrom,
        arrivalLocalTime: "14:00",
        policyText: "Cancel before arrival subject to the configured tier.",
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
        cancellationPolicyId: policy.policy.id,
        effectiveFrom
      },
      metadata()
    )
  );
}

async function createTaxPolicy(
  fixture: Fixture,
  input: {
    priceMode: "EXCLUSIVE" | "INCLUSIVE";
    appliesToAccommodation?: boolean;
    appliesToExtraGuest?: boolean;
    appliesToFee?: boolean;
    assignmentEnabled?: boolean;
  }
) {
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
        priceMode: input.priceMode,
        selectionBasis: "ALWAYS",
        minimumBasisMinor: null,
        maximumBasisMinor: null,
        appliesToAccommodation: input.appliesToAccommodation ?? true,
        appliesToExtraGuest: input.appliesToExtraGuest ?? true,
        appliesToFee: input.appliesToFee ?? false,
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
        enabled: input.assignmentEnabled ?? true
      },
      metadata()
    )
  );

  return policy.policy.id;
}

async function createFeePolicy(
  fixture: Fixture,
  input: {
    amountMinor: number;
    priceMode: "EXCLUSIVE" | "INCLUSIVE";
    taxable: boolean;
    taxPolicyId: string | null;
  }
) {
  const service = new CommercialRuleService();
  const policy = await db.transaction().execute((trx) =>
    service.createFeePolicy(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: `FEE-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: "Service Fee",
        description: null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createFeePolicyVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        feePolicyId: policy.policy.id,
        effectiveFrom: "2034-01-01",
        calculationType: "FIXED",
        applicationBasis: "PER_STAY",
        amountMinor: input.amountMinor,
        rateBasisPoints: null,
        priceMode: input.priceMode,
        taxable: input.taxable,
        taxPolicyId: input.taxPolicyId,
        expectedCurrentVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createFeeAssignment(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        feePolicyId: policy.policy.id,
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

async function quote(
  fixture: Fixture,
  units: { adults: number; childAges: number[] }[] = [{ adults: 2, childAges: [] }]
) {
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
        units
      },
      metadata()
    )
  );
}

describe("Phase 4B2 commercial quote calculation", () => {
  it("creates a commercial snapshot for explicit NO_TAX and NO_FEES configuration", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);

    const result = await quote(fixture);

    expect(result.quote).toMatchObject({
      commercialStatus: "COMMERCIAL_RULES_APPLIED",
      promotionStatus: "NOT_EVALUATED",
      holdEligible: false,
      accommodationMinor: 1_000_000,
      extraGuestMinor: 0,
      feeMinor: 0,
      taxMinor: 0,
      totalMinor: 1_000_000
    });
    expect(result.quote.commercial?.settingsDays).toHaveLength(2);
    expect(result.quote.commercial?.cancellationPolicy.policyCode).toBe("FLEX");
  });

  it("adds exclusive tax using immutable component snapshots", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, { taxMode: "POLICIES" });
    await createTaxPolicy(fixture, { priceMode: "EXCLUSIVE" });

    const result = await quote(fixture);

    expect(result.quote.taxMinor).toBe(180_000);
    expect(result.quote.exclusiveTaxMinor).toBe(180_000);
    expect(result.quote.inclusiveTaxMinor).toBe(0);
    expect(result.quote.totalMinor).toBe(1_180_000);
    expect(result.quote.commercial?.taxLines).toHaveLength(4);
    expect(result.quote.commercial?.taxLines.reduce((sum, line) => sum + line.taxMinor, 0)).toBe(
      180_000
    );
  });

  it("extracts inclusive tax without increasing the guest total", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, { taxMode: "POLICIES" });
    await createTaxPolicy(fixture, { priceMode: "INCLUSIVE" });

    const result = await quote(fixture);

    expect(result.quote.inclusiveTaxMinor).toBe(152_542);
    expect(result.quote.exclusiveTaxMinor).toBe(0);
    expect(result.quote.taxMinor).toBe(152_542);
    expect(result.quote.totalMinor).toBe(1_000_000);
  });

  it("adds an exclusive taxable fee and its configured fee tax", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, {
      taxMode: "POLICIES",
      feeMode: "POLICIES"
    });
    const taxPolicyId = await createTaxPolicy(fixture, {
      priceMode: "EXCLUSIVE",
      appliesToAccommodation: false,
      appliesToExtraGuest: false,
      appliesToFee: true,
      assignmentEnabled: false
    });
    await createFeePolicy(fixture, {
      amountMinor: 10_000,
      priceMode: "EXCLUSIVE",
      taxable: true,
      taxPolicyId
    });

    const result = await quote(fixture);

    expect(result.quote.feeMinor).toBe(10_000);
    expect(result.quote.exclusiveFeeMinor).toBe(10_000);
    expect(result.quote.taxMinor).toBe(1_800);
    expect(result.quote.totalMinor).toBe(1_011_800);
    expect(result.quote.commercial?.feeLines).toHaveLength(1);
    expect(
      result.quote.commercial?.taxLines.filter((line) => line.chargeType === "FEE")
    ).toHaveLength(2);
  });

  it("does not add an inclusive fee to the guest total", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, { feeMode: "POLICIES" });

    const service = new CommercialRuleService();
    const policy = await db.transaction().execute((trx) =>
      service.createFeePolicy(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "INCLUSIVE-FEE",
          name: "Included Service Fee",
          description: null
        },
        metadata()
      )
    );
    await db.transaction().execute((trx) =>
      service.createFeePolicyVersion(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          feePolicyId: policy.policy.id,
          effectiveFrom: "2034-01-01",
          calculationType: "FIXED",
          applicationBasis: "PER_STAY",
          amountMinor: 20_000,
          rateBasisPoints: null,
          priceMode: "INCLUSIVE",
          taxable: false,
          taxPolicyId: null,
          expectedCurrentVersion: 0
        },
        metadata()
      )
    );
    await db.transaction().execute((trx) =>
      service.createFeeAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          feePolicyId: policy.policy.id,
          effectiveFrom: "2034-01-01",
          scopeType: "PROPERTY",
          ratePlanId: null,
          rateProductId: null,
          enabled: true
        },
        metadata()
      )
    );

    const result = await quote(fixture);

    expect(result.quote.feeMinor).toBe(20_000);
    expect(result.quote.inclusiveFeeMinor).toBe(20_000);
    expect(result.quote.exclusiveFeeMinor).toBe(0);
    expect(result.quote.totalMinor).toBe(1_000_000);
  });

  it("uses the guest age policy for infant occupancy and extra-child pricing", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, {
      infantMaxAge: 4,
      childMaxAge: 12,
      infantsCountTowardsOccupancy: false,
      infantsCountTowardsChildLimit: false,
      infantsChargeAsChildren: false
    });

    const result = await quote(fixture, [{ adults: 2, childAges: [3, 8] }]);

    expect(result.quote.extraGuestMinor).toBe(100_000);
    expect(result.quote.totalMinor).toBe(1_100_000);
    expect(result.quote.units[0]).toMatchObject({
      children: 1,
      infants: 1,
      occupancyCount: 3,
      childLimitCount: 1,
      chargeableChildren: 1,
      extraChildren: 1
    });
  });

  it("uses RATE_PRODUCT assignment state ahead of PROPERTY state", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, { taxMode: "POLICIES" });
    const taxPolicyId = await createTaxPolicy(fixture, { priceMode: "EXCLUSIVE" });

    await db.transaction().execute((trx) =>
      new CommercialRuleService().createTaxAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          taxPolicyId,
          effectiveFrom: "2034-01-01",
          scopeType: "RATE_PRODUCT",
          ratePlanId: null,
          rateProductId: fixture.rateProductId,
          enabled: false
        },
        metadata()
      )
    );

    const result = await quote(fixture);

    expect(result.quote.taxMinor).toBe(0);
    expect(result.quote.totalMinor).toBe(1_000_000);
    expect(result.quote.commercial?.taxLines).toHaveLength(0);
  });

  it("keeps the Phase 4A parent quote immutable and stores commercial economics as an immutable extension", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture, { taxMode: "POLICIES" });
    await createTaxPolicy(fixture, { priceMode: "EXCLUSIVE" });

    const result = await quote(fixture);

    const parent = await db
      .selectFrom("quotes")
      .select(["commercial_status", "tax_minor", "fee_minor", "total_minor"])
      .where("id", "=", result.quote.id)
      .executeTakeFirstOrThrow();

    expect(parent).toEqual({
      commercial_status: "PRE_TAX_ONLY",
      tax_minor: 0,
      fee_minor: 0,
      total_minor: 1_000_000
    });
    expect(result.quote.totalMinor).toBe(1_180_000);

    await expect(
      db
        .updateTable("quote_commercial_snapshots")
        .set({ total_minor: result.quote.totalMinor + 1 })
        .where("quote_id", "=", result.quote.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });
});
