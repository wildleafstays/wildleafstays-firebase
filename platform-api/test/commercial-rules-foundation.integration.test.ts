import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
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
  userId: string;
  currencyCode: string;
}

async function createFixture(label: string): Promise<Fixture> {
  const authSubject = `phase4b1a-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: `Commercial ${label}`,
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
        legalName: `Commercial Org ${label} ${randomUUID()}`,
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
        name: `Commercial Property ${label} ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  await db
    .updateTable("properties")
    .set({
      property_type: "HOTEL",
      sale_mode: "ROOMS_ONLY"
    })
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
    ratePlanId: plan.ratePlan.id,
    userId: user.id,
    currencyCode: "INR"
  };
}

async function createTaxPolicy(fixture: Fixture) {
  const policyId = randomUUID();
  await db
    .insertInto("commercial_tax_policies")
    .values({
      id: policyId,
      organization_id: fixture.organizationId,
      property_id: fixture.propertyId,
      code: `GST-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: "Accommodation Tax",
      description: null,
      current_version: 0,
      created_by_user_id: fixture.userId,
      updated_by_user_id: fixture.userId
    })
    .execute();
  return policyId;
}

async function createTaxVersion(
  fixture: Fixture,
  policyId: string,
  versionNumber: number,
  effectiveFrom: string
) {
  const versionId = randomUUID();
  await db
    .insertInto("commercial_tax_policy_versions")
    .values({
      id: versionId,
      tax_policy_id: policyId,
      organization_id: fixture.organizationId,
      property_id: fixture.propertyId,
      version_number: versionNumber,
      effective_from: effectiveFrom,
      price_mode: "EXCLUSIVE",
      selection_basis: "ALWAYS",
      minimum_basis_minor: null,
      maximum_basis_minor: null,
      applies_to_accommodation: true,
      applies_to_extra_guest: true,
      applies_to_fee: false,
      sealed_at: null,
      created_by_user_id: fixture.userId
    })
    .execute();
  return versionId;
}

async function addTaxComponents(fixture: Fixture, versionId: string) {
  await db
    .insertInto("commercial_tax_components")
    .values([
      {
        id: randomUUID(),
        tax_policy_version_id: versionId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        component_code: "CGST",
        component_name: "Central component",
        rate_basis_points: 900,
        sort_order: 1
      },
      {
        id: randomUUID(),
        tax_policy_version_id: versionId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        component_code: "SGST",
        component_name: "State component",
        rate_basis_points: 900,
        sort_order: 2
      }
    ])
    .execute();
}

async function createCancellationPolicy(fixture: Fixture) {
  const policyId = randomUUID();
  await db
    .insertInto("cancellation_policies")
    .values({
      id: policyId,
      organization_id: fixture.organizationId,
      property_id: fixture.propertyId,
      code: `CXL-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: "Flexible Cancellation",
      description: null,
      current_version: 0,
      created_by_user_id: fixture.userId,
      updated_by_user_id: fixture.userId
    })
    .execute();
  return policyId;
}

async function createCancellationVersion(
  fixture: Fixture,
  policyId: string,
  versionNumber: number,
  effectiveFrom: string
) {
  const versionId = randomUUID();
  await db
    .insertInto("cancellation_policy_versions")
    .values({
      id: versionId,
      cancellation_policy_id: policyId,
      organization_id: fixture.organizationId,
      property_id: fixture.propertyId,
      version_number: versionNumber,
      effective_from: effectiveFrom,
      arrival_local_time: "14:00",
      currency_code: fixture.currencyCode,
      policy_text: "Test cancellation policy",
      sealed_at: null,
      created_by_user_id: fixture.userId
    })
    .execute();
  return versionId;
}

describe("Phase 4B1a commercial policy schema foundation", () => {
  it("uses immutable effective-from timelines so future versions do not rewrite history", async () => {
    const fixture = await createFixture("timeline");
    const policyId = await createTaxPolicy(fixture);
    const v1 = await createTaxVersion(fixture, policyId, 1, "2030-01-01");
    await addTaxComponents(fixture, v1);
    await db
      .updateTable("commercial_tax_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", v1)
      .execute();

    const v2 = await createTaxVersion(fixture, policyId, 2, "2031-01-01");
    await addTaxComponents(fixture, v2);
    await db
      .updateTable("commercial_tax_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", v2)
      .execute();

    const effective2030 = await db
      .selectFrom("commercial_tax_policy_versions")
      .select(["id", "version_number"])
      .where("tax_policy_id", "=", policyId)
      .where("effective_from", "<=", "2030-06-01")
      .where("sealed_at", "is not", null)
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    const effective2031 = await db
      .selectFrom("commercial_tax_policy_versions")
      .select(["id", "version_number"])
      .where("tax_policy_id", "=", policyId)
      .where("effective_from", "<=", "2031-06-01")
      .where("sealed_at", "is not", null)
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    expect(effective2030.version_number).toBe(1);
    expect(effective2031.version_number).toBe(2);

    await expect(
      db
        .updateTable("commercial_tax_policy_versions")
        .set({ price_mode: "INCLUSIVE" })
        .where("id", "=", v1)
        .execute()
    ).rejects.toThrow(/commercial rule snapshots are immutable/i);
  });

  it("requires tax components before sealing and freezes components after sealing", async () => {
    const fixture = await createFixture("tax-seal");
    const policyId = await createTaxPolicy(fixture);
    const versionId = await createTaxVersion(fixture, policyId, 1, "2030-01-01");

    await expect(
      db
        .updateTable("commercial_tax_policy_versions")
        .set({ sealed_at: new Date() })
        .where("id", "=", versionId)
        .execute()
    ).rejects.toThrow(/requires at least one component/i);

    await addTaxComponents(fixture, versionId);
    await db
      .updateTable("commercial_tax_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", versionId)
      .execute();

    await expect(
      db
        .insertInto("commercial_tax_components")
        .values({
          id: randomUUID(),
          tax_policy_version_id: versionId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          component_code: "CESS",
          component_name: "Cess",
          rate_basis_points: 100,
          sort_order: 3
        })
        .execute()
    ).rejects.toThrow(/sealed tax policy versions cannot accept components/i);
  });

  it("supports explicit commercial completeness modes instead of treating missing rules as zero", async () => {
    const fixture = await createFixture("commercial-mode");

    await db
      .insertInto("property_commercial_settings")
      .values({
        property_id: fixture.propertyId,
        organization_id: fixture.organizationId,
        current_version: 2,
        created_by_user_id: fixture.userId,
        updated_by_user_id: fixture.userId
      })
      .execute();

    await db
      .insertInto("property_commercial_setting_versions")
      .values([
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          version_number: 1,
          effective_from: "2030-01-01",
          tax_mode: "NO_TAX",
          fee_mode: "NO_FEES",
          created_by_user_id: fixture.userId
        },
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          version_number: 2,
          effective_from: "2031-01-01",
          tax_mode: "POLICIES",
          fee_mode: "POLICIES",
          created_by_user_id: fixture.userId
        }
      ])
      .execute();

    const effective = await db
      .selectFrom("property_commercial_setting_versions")
      .selectAll()
      .where("property_id", "=", fixture.propertyId)
      .where("effective_from", "<=", "2031-06-01")
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    expect(effective.tax_mode).toBe("POLICIES");
    expect(effective.fee_mode).toBe("POLICIES");
  });

  it("models tax assignment changes as append-only effective state", async () => {
    const fixture = await createFixture("tax-assignment");
    const policyId = await createTaxPolicy(fixture);

    await db
      .insertInto("commercial_tax_assignments")
      .values([
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          tax_policy_id: policyId,
          scope_type: "PROPERTY",
          rate_plan_id: null,
          rate_product_id: null,
          effective_from: "2030-01-01",
          enabled: true,
          created_by_user_id: fixture.userId
        },
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          tax_policy_id: policyId,
          scope_type: "PROPERTY",
          rate_plan_id: null,
          rate_product_id: null,
          effective_from: "2032-01-01",
          enabled: false,
          created_by_user_id: fixture.userId
        }
      ])
      .execute();

    const current = await db
      .selectFrom("commercial_tax_assignments")
      .select(["enabled"])
      .where("tax_policy_id", "=", policyId)
      .where("scope_type", "=", "PROPERTY")
      .where("effective_from", "<=", "2031-06-01")
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    const future = await db
      .selectFrom("commercial_tax_assignments")
      .select(["enabled"])
      .where("tax_policy_id", "=", policyId)
      .where("scope_type", "=", "PROPERTY")
      .where("effective_from", "<=", "2032-06-01")
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    expect(current.enabled).toBe(true);
    expect(future.enabled).toBe(false);
  });

  it("enforces structurally valid fixed and percentage fee models", async () => {
    const fixture = await createFixture("fees");
    const taxPolicyId = await createTaxPolicy(fixture);

    const fixedPolicyId = randomUUID();
    await db
      .insertInto("commercial_fee_policies")
      .values({
        id: fixedPolicyId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        code: `FEE-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: "Service Fee",
        description: null,
        current_version: 1,
        created_by_user_id: fixture.userId,
        updated_by_user_id: fixture.userId
      })
      .execute();

    await db
      .insertInto("commercial_fee_policy_versions")
      .values({
        id: randomUUID(),
        fee_policy_id: fixedPolicyId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        version_number: 1,
        effective_from: "2030-01-01",
        currency_code: fixture.currencyCode,
        calculation_type: "FIXED",
        application_basis: "PER_STAY",
        amount_minor: 25_000,
        rate_basis_points: null,
        price_mode: "EXCLUSIVE",
        taxable: true,
        tax_policy_id: taxPolicyId,
        created_by_user_id: fixture.userId
      })
      .execute();

    const invalidPolicyId = randomUUID();
    await db
      .insertInto("commercial_fee_policies")
      .values({
        id: invalidPolicyId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        code: `BAD-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: "Invalid Fee",
        description: null,
        current_version: 1,
        created_by_user_id: fixture.userId,
        updated_by_user_id: fixture.userId
      })
      .execute();

    await expect(
      db
        .insertInto("commercial_fee_policy_versions")
        .values({
          id: randomUUID(),
          fee_policy_id: invalidPolicyId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          version_number: 1,
          effective_from: "2030-01-01",
          currency_code: fixture.currencyCode,
          calculation_type: "FIXED",
          application_basis: "PER_STAY",
          amount_minor: 10_000,
          rate_basis_points: 500,
          price_mode: "EXCLUSIVE",
          taxable: false,
          tax_policy_id: null,
          created_by_user_id: fixture.userId
        })
        .execute()
    ).rejects.toThrow();
  });

  it("requires complete cancellation tier snapshots before sealing", async () => {
    const fixture = await createFixture("cancel-seal");
    const policyId = await createCancellationPolicy(fixture);
    const versionId = await createCancellationVersion(fixture, policyId, 1, "2030-01-01");

    await db
      .insertInto("cancellation_policy_tiers")
      .values({
        id: randomUUID(),
        cancellation_policy_version_id: versionId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        trigger_type: "CANCELLATION",
        minimum_minutes_before_arrival: 0,
        penalty_type: "PERCENTAGE_OF_STAY",
        penalty_value: 10000
      })
      .execute();

    await expect(
      db
        .updateTable("cancellation_policy_versions")
        .set({ sealed_at: new Date() })
        .where("id", "=", versionId)
        .execute()
    ).rejects.toThrow(/requires a no-show tier/i);

    await db
      .insertInto("cancellation_policy_tiers")
      .values([
        {
          id: randomUUID(),
          cancellation_policy_version_id: versionId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          trigger_type: "CANCELLATION",
          minimum_minutes_before_arrival: 1440,
          penalty_type: "PERCENTAGE_OF_STAY",
          penalty_value: 0
        },
        {
          id: randomUUID(),
          cancellation_policy_version_id: versionId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          trigger_type: "NO_SHOW",
          minimum_minutes_before_arrival: null,
          penalty_type: "PERCENTAGE_OF_STAY",
          penalty_value: 10000
        }
      ])
      .execute();

    await db
      .updateTable("cancellation_policy_versions")
      .set({ sealed_at: new Date() })
      .where("id", "=", versionId)
      .execute();

    await expect(
      db
        .insertInto("cancellation_policy_tiers")
        .values({
          id: randomUUID(),
          cancellation_policy_version_id: versionId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          trigger_type: "CANCELLATION",
          minimum_minutes_before_arrival: 2880,
          penalty_type: "PERCENTAGE_OF_STAY",
          penalty_value: 0
        })
        .execute()
    ).rejects.toThrow(/sealed cancellation policy versions cannot accept tiers/i);
  });

  it("allows future cancellation-policy changes without mutating prior assignments", async () => {
    const fixture = await createFixture("cancel-assignment");
    const firstPolicyId = await createCancellationPolicy(fixture);
    const secondPolicyId = await createCancellationPolicy(fixture);

    await db
      .insertInto("rate_plan_cancellation_assignments")
      .values([
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          rate_plan_id: fixture.ratePlanId,
          cancellation_policy_id: firstPolicyId,
          effective_from: "2030-01-01",
          created_by_user_id: fixture.userId
        },
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          rate_plan_id: fixture.ratePlanId,
          cancellation_policy_id: secondPolicyId,
          effective_from: "2031-01-01",
          created_by_user_id: fixture.userId
        }
      ])
      .execute();

    const first = await db
      .selectFrom("rate_plan_cancellation_assignments")
      .select(["cancellation_policy_id"])
      .where("rate_plan_id", "=", fixture.ratePlanId)
      .where("effective_from", "<=", "2030-06-01")
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    const second = await db
      .selectFrom("rate_plan_cancellation_assignments")
      .select(["cancellation_policy_id"])
      .where("rate_plan_id", "=", fixture.ratePlanId)
      .where("effective_from", "<=", "2031-06-01")
      .orderBy("effective_from", "desc")
      .executeTakeFirstOrThrow();

    expect(first.cancellation_policy_id).toBe(firstPolicyId);
    expect(second.cancellation_policy_id).toBe(secondPolicyId);
  });

  it("enforces guest age boundaries and immutable effective history", async () => {
    const fixture = await createFixture("guest-age");

    await db
      .insertInto("guest_age_policies")
      .values({
        property_id: fixture.propertyId,
        organization_id: fixture.organizationId,
        current_version: 2,
        created_by_user_id: fixture.userId,
        updated_by_user_id: fixture.userId
      })
      .execute();

    const firstId = randomUUID();
    await db
      .insertInto("guest_age_policy_versions")
      .values([
        {
          id: firstId,
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          version_number: 1,
          effective_from: "2030-01-01",
          infant_max_age: 2,
          child_max_age: 11,
          infants_count_towards_occupancy: true,
          infants_count_towards_child_limit: false,
          infants_charge_as_children: false,
          created_by_user_id: fixture.userId
        },
        {
          id: randomUUID(),
          organization_id: fixture.organizationId,
          property_id: fixture.propertyId,
          version_number: 2,
          effective_from: "2031-01-01",
          infant_max_age: 2,
          child_max_age: 12,
          infants_count_towards_occupancy: true,
          infants_count_towards_child_limit: false,
          infants_charge_as_children: false,
          created_by_user_id: fixture.userId
        }
      ])
      .execute();

    await expect(
      db
        .updateTable("guest_age_policy_versions")
        .set({ child_max_age: 15 })
        .where("id", "=", firstId)
        .execute()
    ).rejects.toThrow(/commercial rule snapshots are immutable/i);

    const other = await createFixture("guest-age-invalid");
    await db
      .insertInto("guest_age_policies")
      .values({
        property_id: other.propertyId,
        organization_id: other.organizationId,
        current_version: 1,
        created_by_user_id: other.userId,
        updated_by_user_id: other.userId
      })
      .execute();

    await expect(
      db
        .insertInto("guest_age_policy_versions")
        .values({
          id: randomUUID(),
          organization_id: other.organizationId,
          property_id: other.propertyId,
          version_number: 1,
          effective_from: "2030-01-01",
          infant_max_age: 12,
          child_max_age: 10,
          infants_count_towards_occupancy: true,
          infants_count_towards_child_limit: true,
          infants_charge_as_children: false,
          created_by_user_id: other.userId
        })
        .execute()
    ).rejects.toThrow();
  });

  it("prevents cross-property commercial policy assignment and keeps events append-only", async () => {
    const first = await createFixture("tenant-a");
    const second = await createFixture("tenant-b");
    const firstTaxPolicy = await createTaxPolicy(first);

    await expect(
      db
        .insertInto("commercial_tax_assignments")
        .values({
          id: randomUUID(),
          organization_id: second.organizationId,
          property_id: second.propertyId,
          tax_policy_id: firstTaxPolicy,
          scope_type: "PROPERTY",
          rate_plan_id: null,
          rate_product_id: null,
          effective_from: "2030-01-01",
          enabled: true,
          created_by_user_id: second.userId
        })
        .execute()
    ).rejects.toThrow();

    const eventId = randomUUID();
    await db
      .insertInto("commercial_rule_events")
      .values({
        id: eventId,
        organization_id: first.organizationId,
        property_id: first.propertyId,
        entity_type: "TAX_POLICY",
        entity_id: firstTaxPolicy,
        event_type: "TAX_POLICY_CREATED",
        details_json: { code: "TEST" },
        actor_user_id: first.userId,
        source: "integration-test",
        request_id: randomUUID(),
        correlation_id: randomUUID()
      })
      .execute();

    await expect(
      db
        .updateTable("commercial_rule_events")
        .set({ event_type: "CHANGED" })
        .where("id", "=", eventId)
        .execute()
    ).rejects.toThrow(/commercial rule snapshots are immutable/i);
  });
});
