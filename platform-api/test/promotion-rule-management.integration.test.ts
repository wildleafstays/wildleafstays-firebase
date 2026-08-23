import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
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

async function createFixture(label: string): Promise<Fixture> {
  const subject = `phase4b3a-${label}-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: `Phase 4B3a ${label}`,
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
        legalName: `Promotion Org ${label} ${randomUUID()}`,
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
        name: `Promotion Property ${label} ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  await db
    .updateTable("properties")
    .set({ property_type: "VILLA", sale_mode: "FULL_PROPERTY_ONLY" })
    .where("id", "=", property.property.id)
    .execute();

  const rateService = new RateService();
  const plan = await db.transaction().execute((trx) =>
    rateService.createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: `PROMO-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: "Promotion Test Plan",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const product = await db.transaction().execute((trx) =>
    rateService.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        ratePlanId: plan.ratePlan.id,
        productType: "FULL_PROPERTY",
        roomCategoryId: null,
        baseRateMinor: 500_000,
        floorRateMinor: 300_000,
        ceilingRateMinor: 900_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 10,
        maxChildren: 6,
        maxOccupancy: 12,
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
    ratePlanId: plan.ratePlan.id,
    rateProductId: product.rateProduct.id
  };
}

async function createAutomaticCampaign(
  fixture: Fixture,
  code = `AUTO-${randomUUID().slice(0, 6)}`
) {
  const service = new PromotionRuleService();
  const campaign = await db.transaction().execute((trx) =>
    service.createCampaign(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code,
        name: "Early booking offer",
        description: null,
        promotionKind: "AUTOMATIC",
        publicCode: null
      },
      metadata()
    )
  );

  const version = await db.transaction().execute((trx) =>
    service.createCampaignVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        promotionCampaignId: campaign.campaign.id,
        effectiveFrom: "2030-01-01",
        bookingWindowStart: "2030-01-01",
        bookingWindowEnd: "2030-12-31",
        arrivalWindowStart: "2030-03-01",
        arrivalWindowEnd: "2030-12-31",
        minimumStayNights: 2,
        minimumSpendMinor: 100_000,
        discountType: "PERCENTAGE",
        discountValue: 1500,
        maximumDiscountMinor: 300_000,
        appliesTo: "ACCOMMODATION_AND_EXTRA_GUEST",
        priority: 100,
        stackingMode: "EXCLUSIVE",
        stackGroup: null,
        expectedCurrentVersion: 0
      },
      metadata()
    )
  );

  return { campaign: campaign.campaign, version: version.campaignVersion };
}

describe("Phase 4B3a promotion rule foundation and management", () => {
  it("versions explicit promotion mode with optimistic concurrency and forward-only history", async () => {
    const fixture = await createFixture("settings");
    const service = new PromotionRuleService();

    const first = await db.transaction().execute((trx) =>
      service.setSettings(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          effectiveFrom: "2030-01-01",
          promotionMode: "NO_PROMOTIONS",
          expectedVersion: 0
        },
        metadata()
      )
    );
    expect(first.settingsVersion).toMatchObject({ version: 1, promotionMode: "NO_PROMOTIONS" });

    await expect(
      db.transaction().execute((trx) =>
        service.setSettings(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2030-02-01",
            promotionMode: "POLICIES",
            expectedVersion: 0
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    await expect(
      db.transaction().execute((trx) =>
        service.setSettings(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2029-12-31",
            promotionMode: "POLICIES",
            expectedVersion: 1
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const second = await db.transaction().execute((trx) =>
      service.setSettings(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          effectiveFrom: "2030-02-01",
          promotionMode: "POLICIES",
          expectedVersion: 1
        },
        metadata()
      )
    );
    expect(second.settingsVersion.version).toBe(2);
  });

  it("creates an automatic percentage campaign and explicit property assignment", async () => {
    const fixture = await createFixture("automatic");
    const service = new PromotionRuleService();
    const created = await createAutomaticCampaign(fixture);

    expect(created.version).toMatchObject({
      currencyCode: "INR",
      discountType: "PERCENTAGE",
      discountValue: 1500,
      maximumDiscountMinor: 300_000,
      stackingMode: "EXCLUSIVE"
    });

    const assignment = await db.transaction().execute((trx) =>
      service.createAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          promotionCampaignId: created.campaign.id,
          effectiveFrom: "2030-01-01",
          scopeType: "PROPERTY",
          ratePlanId: null,
          rateProductId: null,
          enabled: true
        },
        metadata()
      )
    );
    expect(assignment.assignment).toMatchObject({ scopeType: "PROPERTY", enabled: true });
  });

  it("normalizes public promo codes and keeps them unique per property", async () => {
    const fixture = await createFixture("promo-code");
    const service = new PromotionRuleService();

    const first = await db.transaction().execute((trx) =>
      service.createCampaign(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "direct10",
          name: "Direct booking code",
          description: null,
          promotionKind: "PROMO_CODE",
          publicCode: "save10"
        },
        metadata()
      )
    );
    expect(first.campaign).toMatchObject({ code: "DIRECT10", publicCode: "SAVE10" });

    await expect(
      db.transaction().execute((trx) =>
        service.createCampaign(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            code: "DIRECT15",
            name: "Second direct code",
            description: null,
            promotionKind: "PROMO_CODE",
            publicCode: "SAVE10"
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const version = await db.transaction().execute((trx) =>
      service.createCampaignVersion(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          promotionCampaignId: first.campaign.id,
          effectiveFrom: "2030-01-01",
          bookingWindowStart: null,
          bookingWindowEnd: null,
          arrivalWindowStart: null,
          arrivalWindowEnd: null,
          minimumStayNights: 1,
          minimumSpendMinor: null,
          discountType: "FIXED_AMOUNT",
          discountValue: 50_000,
          maximumDiscountMinor: null,
          appliesTo: "ACCOMMODATION",
          priority: 20,
          stackingMode: "STACKABLE",
          stackGroup: "DIRECT",
          expectedCurrentVersion: 0
        },
        metadata()
      )
    );
    expect(version.campaignVersion).toMatchObject({
      discountType: "FIXED_AMOUNT",
      discountValue: 50_000,
      stackGroup: "DIRECT"
    });
  });

  it("stores more-specific assignment state without mutating broader history", async () => {
    const fixture = await createFixture("scope");
    const service = new PromotionRuleService();
    const created = await createAutomaticCampaign(fixture);

    await db.transaction().execute((trx) =>
      service.createAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          promotionCampaignId: created.campaign.id,
          effectiveFrom: "2030-01-01",
          scopeType: "PROPERTY",
          ratePlanId: null,
          rateProductId: null,
          enabled: true
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
          promotionCampaignId: created.campaign.id,
          effectiveFrom: "2030-02-01",
          scopeType: "RATE_PRODUCT",
          ratePlanId: null,
          rateProductId: fixture.rateProductId,
          enabled: false
        },
        metadata()
      )
    );

    const rows = await db
      .selectFrom("promotion_assignments")
      .selectAll()
      .where("promotion_campaign_id", "=", created.campaign.id)
      .orderBy("effective_from")
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.scope_type).toBe("PROPERTY");
    expect(rows[1]?.scope_type).toBe("RATE_PRODUCT");
    expect(rows[1]?.enabled).toBe(false);
  });

  it("rejects cross-property promotion assignment targets before database constraints", async () => {
    const first = await createFixture("cross-a");
    const second = await createFixture("cross-b");
    const service = new PromotionRuleService();
    const created = await createAutomaticCampaign(first);

    await expect(
      db.transaction().execute((trx) =>
        service.createAssignment(
          trx,
          first.actor,
          {
            organizationId: first.organizationId,
            propertyId: first.propertyId,
            promotionCampaignId: created.campaign.id,
            effectiveFrom: "2030-01-01",
            scopeType: "RATE_PLAN",
            ratePlanId: second.ratePlanId,
            rateProductId: null,
            enabled: true
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("allows property viewers to read promotion configuration while denying management", async () => {
    const fixture = await createFixture("viewer");
    const service = new PromotionRuleService();
    const viewer: ActorContext = {
      ...fixture.actor,
      organizationMemberships: fixture.actor.organizationMemberships.map((membership) => ({
        ...membership,
        role: "VIEWER" as const
      })),
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "VIEWER" as const
        }
      ]
    };

    const configView = await db
      .transaction()
      .execute((trx) =>
        service.getConfiguration(trx, viewer, fixture.organizationId, fixture.propertyId)
      );
    expect(configView["propertyId"]).toBe(fixture.propertyId);

    await expect(
      db.transaction().execute((trx) =>
        service.setSettings(
          trx,
          viewer,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2030-01-01",
            promotionMode: "NO_PROMOTIONS",
            expectedVersion: 0
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });

  it("protects promotion versions and assignment history from mutation", async () => {
    const fixture = await createFixture("immutable");
    const created = await createAutomaticCampaign(fixture);

    await expect(
      db
        .updateTable("promotion_campaign_versions")
        .set({ priority: created.version.priority + 1 })
        .where("id", "=", created.version.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("writes promotion events, audit records and outbox messages in the same transaction", async () => {
    const fixture = await createFixture("events");
    const service = new PromotionRuleService();
    const result = await db.transaction().execute((trx) =>
      service.createCampaign(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: `EVT-${randomUUID().slice(0, 6)}`,
          name: "Event promotion",
          description: null,
          promotionKind: "AUTOMATIC",
          publicCode: null
        },
        metadata()
      )
    );

    const [event, audit, outbox] = await Promise.all([
      db
        .selectFrom("promotion_rule_events")
        .selectAll()
        .where("entity_id", "=", result.campaign.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("entity_type", "=", "promotion_campaign")
        .where("entity_id", "=", result.campaign.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_type", "=", "promotion_campaign")
        .where("aggregate_id", "=", result.campaign.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(event.event_type).toBe("PROMOTION_CAMPAIGN_CREATED");
    expect(audit.action).toBe("commercial.promotion.campaign.created");
    expect(outbox.event_type).toBe("commercial.promotion.campaign.created.v1");
  });
});
