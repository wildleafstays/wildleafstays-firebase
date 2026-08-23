import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
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
}

async function createFixture(label: string): Promise<Fixture> {
  const subject = `phase4b1b-${label}-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: `Phase 4B1b ${label}`,
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
        legalName: `Commercial Management Org ${label} ${randomUUID()}`,
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
        name: `Commercial Management Property ${label} ${randomUUID()}`,
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

  const plan = await db.transaction().execute((trx) =>
    new RateService().createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: `FLEX-${randomUUID().slice(0, 6).toUpperCase()}`,
        name: "Flexible Commercial Plan",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    ratePlanId: plan.ratePlan.id
  };
}

async function createTaxWithVersion(fixture: Fixture, code = `GST-${randomUUID().slice(0, 6)}`) {
  const service = new CommercialRuleService();
  const policy = await db.transaction().execute((trx) =>
    service.createTaxPolicy(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code,
        name: "Accommodation Tax",
        description: null
      },
      metadata()
    )
  );

  const version = await db.transaction().execute((trx) =>
    service.createTaxPolicyVersion(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        taxPolicyId: policy.policy.id,
        effectiveFrom: "2030-01-01",
        priceMode: "EXCLUSIVE",
        selectionBasis: "ALWAYS",
        minimumBasisMinor: null,
        maximumBasisMinor: null,
        appliesToAccommodation: true,
        appliesToExtraGuest: true,
        appliesToFee: true,
        expectedCurrentVersion: 0,
        components: [
          { code: "CGST", name: "Central component", rateBasisPoints: 900, sortOrder: 1 },
          { code: "SGST", name: "State component", rateBasisPoints: 900, sortOrder: 2 }
        ]
      },
      metadata()
    )
  );

  return { policy: policy.policy, version: version.taxPolicyVersion };
}

describe("Phase 4B1b commercial rule management services", () => {
  it("appends commercial settings with optimistic concurrency and no historical rewrite", async () => {
    const fixture = await createFixture("settings");
    const service = new CommercialRuleService();

    const first = await db.transaction().execute((trx) =>
      service.setPropertyCommercialSettings(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          effectiveFrom: "2030-01-01",
          taxMode: "POLICIES",
          feeMode: "NO_FEES",
          expectedVersion: 0
        },
        metadata()
      )
    );
    expect(first.settingsVersion.version).toBe(1);

    await expect(
      db.transaction().execute((trx) =>
        service.setPropertyCommercialSettings(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2030-02-01",
            taxMode: "POLICIES",
            feeMode: "POLICIES",
            expectedVersion: 0
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    await expect(
      db.transaction().execute((trx) =>
        service.setPropertyCommercialSettings(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2029-12-31",
            taxMode: "NO_TAX",
            feeMode: "NO_FEES",
            expectedVersion: 1
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("creates and seals tax versions atomically and appends assignment state", async () => {
    const fixture = await createFixture("tax");
    const service = new CommercialRuleService();
    const tax = await createTaxWithVersion(fixture, "GST-ROOM");

    expect(tax.version.version).toBe(1);
    expect(tax.version.sealedAt).toBeTruthy();
    expect(tax.version.components).toHaveLength(2);

    const assignment = await db.transaction().execute((trx) =>
      service.createTaxAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          taxPolicyId: tax.policy.id,
          effectiveFrom: "2030-01-01",
          scopeType: "PROPERTY",
          ratePlanId: null,
          rateProductId: null,
          enabled: true
        },
        metadata()
      )
    );
    expect(assignment.assignment["enabled"]).toBe(true);

    const componentId = (tax.version.components[0] as { id: string }).id;
    await expect(
      db
        .updateTable("commercial_tax_components")
        .set({ rate_basis_points: 800 })
        .where("id", "=", componentId)
        .execute()
    ).rejects.toThrow();
  });

  it("creates taxable fee versions in property currency and assigns them to a rate plan", async () => {
    const fixture = await createFixture("fee");
    const service = new CommercialRuleService();
    const tax = await createTaxWithVersion(fixture);
    const fee = await db.transaction().execute((trx) =>
      service.createFeePolicy(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "SERVICE-FEE",
          name: "Service Fee",
          description: null
        },
        metadata()
      )
    );

    const version = await db.transaction().execute((trx) =>
      service.createFeePolicyVersion(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          feePolicyId: fee.policy.id,
          effectiveFrom: "2030-01-01",
          calculationType: "FIXED",
          applicationBasis: "PER_STAY",
          amountMinor: 50_000,
          rateBasisPoints: null,
          priceMode: "EXCLUSIVE",
          taxable: true,
          taxPolicyId: tax.policy.id,
          expectedCurrentVersion: 0
        },
        metadata()
      )
    );
    expect(version.feePolicyVersion.currencyCode).toBe("INR");
    expect(version.feePolicyVersion.taxPolicyId).toBe(tax.policy.id);

    const assignment = await db.transaction().execute((trx) =>
      service.createFeeAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          feePolicyId: fee.policy.id,
          effectiveFrom: "2030-01-01",
          scopeType: "RATE_PLAN",
          ratePlanId: fixture.ratePlanId,
          rateProductId: null,
          enabled: true
        },
        metadata()
      )
    );
    expect(assignment.assignment["ratePlanId"]).toBe(fixture.ratePlanId);
  });

  it("creates sealed cancellation snapshots and assigns them without mutating earlier history", async () => {
    const fixture = await createFixture("cancellation");
    const service = new CommercialRuleService();
    const policy = await db.transaction().execute((trx) =>
      service.createCancellationPolicy(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "FLEX-CXL",
          name: "Flexible Cancellation",
          description: null
        },
        metadata()
      )
    );

    const version = await db.transaction().execute((trx) =>
      service.createCancellationPolicyVersion(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          cancellationPolicyId: policy.policy.id,
          effectiveFrom: "2030-01-01",
          arrivalLocalTime: "14:00",
          policyText: "Free until 48 hours, then full stay.",
          expectedCurrentVersion: 0,
          tiers: [
            {
              triggerType: "CANCELLATION",
              minimumMinutesBeforeArrival: 2880,
              penaltyType: "PERCENTAGE_OF_STAY",
              penaltyValue: 0
            },
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
          ]
        },
        metadata()
      )
    );
    expect(version.cancellationPolicyVersion.sealedAt).toBeTruthy();
    expect(version.cancellationPolicyVersion.tiers).toHaveLength(3);

    const assignment = await db.transaction().execute((trx) =>
      service.createCancellationAssignment(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          ratePlanId: fixture.ratePlanId,
          cancellationPolicyId: policy.policy.id,
          effectiveFrom: "2030-01-01"
        },
        metadata()
      )
    );
    expect(assignment.assignment["cancellationPolicyId"]).toBe(policy.policy.id);
  });

  it("versions guest age policy explicitly and blocks backdated changes", async () => {
    const fixture = await createFixture("guest-age");
    const service = new CommercialRuleService();
    const first = await db.transaction().execute((trx) =>
      service.setGuestAgePolicy(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          effectiveFrom: "2030-01-01",
          infantMaxAge: 2,
          childMaxAge: 12,
          infantsCountTowardsOccupancy: false,
          infantsCountTowardsChildLimit: false,
          infantsChargeAsChildren: false,
          expectedVersion: 0
        },
        metadata()
      )
    );
    expect(first.guestAgePolicyVersion.version).toBe(1);

    await expect(
      db.transaction().execute((trx) =>
        service.setGuestAgePolicy(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2029-01-01",
            infantMaxAge: 2,
            childMaxAge: 13,
            infantsCountTowardsOccupancy: false,
            infantsCountTowardsChildLimit: false,
            infantsChargeAsChildren: false,
            expectedVersion: 1
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("rejects cross-property rate-plan assignment before relying on database constraints", async () => {
    const first = await createFixture("tenant-a");
    const second = await createFixture("tenant-b");
    const service = new CommercialRuleService();
    const tax = await createTaxWithVersion(first);

    await expect(
      db.transaction().execute((trx) =>
        service.createTaxAssignment(
          trx,
          first.actor,
          {
            organizationId: first.organizationId,
            propertyId: first.propertyId,
            taxPolicyId: tax.policy.id,
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

  it("allows read-only commercial access while denying management to viewers", async () => {
    const fixture = await createFixture("authorization");
    const service = new CommercialRuleService();
    await db.transaction().execute((trx) =>
      service.setPropertyCommercialSettings(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          effectiveFrom: "2030-01-01",
          taxMode: "NO_TAX",
          feeMode: "NO_FEES",
          expectedVersion: 0
        },
        metadata()
      )
    );

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
        service.setGuestAgePolicy(
          trx,
          viewer,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            effectiveFrom: "2030-01-01",
            infantMaxAge: 2,
            childMaxAge: 12,
            infantsCountTowardsOccupancy: false,
            infantsCountTowardsChildLimit: false,
            infantsChargeAsChildren: false,
            expectedVersion: 0
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });

  it("writes commercial events, audit records, and outbox events in the same transaction", async () => {
    const fixture = await createFixture("audit");
    const service = new CommercialRuleService();
    await db.transaction().execute((trx) =>
      service.createFeePolicy(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          code: "AUDIT-FEE",
          name: "Audited Fee",
          description: null
        },
        metadata()
      )
    );

    const [event, audit, outbox] = await Promise.all([
      db
        .selectFrom("commercial_rule_events")
        .select("id")
        .where("property_id", "=", fixture.propertyId)
        .where("event_type", "=", "FEE_POLICY_CREATED")
        .executeTakeFirst(),
      db
        .selectFrom("audit_events")
        .select("id")
        .where("property_id", "=", fixture.propertyId)
        .where("action", "=", "commercial.fee.policy.created")
        .executeTakeFirst(),
      db
        .selectFrom("outbox_events")
        .select("id")
        .where("event_type", "=", "commercial.fee.policy.created.v1")
        .executeTakeFirst()
    ]);

    expect(event?.id).toBeTruthy();
    expect(audit?.id).toBeTruthy();
    expect(outbox?.id).toBeTruthy();
  });
});
