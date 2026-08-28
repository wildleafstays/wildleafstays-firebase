import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { PlatformHotelGstService } from "../src/modules/commercial/application/platform-hotel-gst-service.js";

const db = createDatabase(loadConfig());

afterAll(async () => {
  await db.destroy();
});

function metadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "integration-test",
    ipAddress: "127.0.0.1",
    userAgent: "vitest"
  };
}

describe("platform-controlled Indian hotel GST", () => {
  it("stores owner consent and materializes protected threshold policies", async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const propertyId = randomUUID();
    await db
      .insertInto("users")
      .values({
        id: userId,
        auth_provider: "test",
        auth_subject: `gst-${userId}`,
        email: `gst-${userId}@example.invalid`,
        display_name: "GST Owner",
        email_verified: true,
        status: "ACTIVE"
      })
      .execute();
    await db
      .insertInto("organizations")
      .values({
        id: organizationId,
        legal_name: "GST Test Organization",
        trading_name: null,
        organization_type: "PRIVATE_LIMITED",
        status: "ACTIVE",
        country_code: "IN",
        currency_code: "INR"
      })
      .execute();
    await db
      .insertInto("properties")
      .values({
        id: propertyId,
        organization_id: organizationId,
        name: "GST Test Hotel",
        status: "DRAFT",
        timezone: "Asia/Kolkata",
        country_code: "IN"
      })
      .execute();

    const actor: ActorContext = {
      userId,
      email: `gst-${userId}@example.invalid`,
      platformRoles: [],
      organizationMemberships: [{ membershipId: randomUUID(), organizationId, role: "OWNER" }],
      propertyGrants: []
    };
    const service = new PlatformHotelGstService();
    const before = await db
      .transaction()
      .execute((trx) => service.getOwnerConsent(trx, actor, organizationId, propertyId));
    expect(before["accepted"]).toBe(false);
    expect(before["currentRule"]).toMatchObject({
      thresholdMinor: 750_000,
      lower: { rateBasisPoints: 500, cgstBasisPoints: 250, sgstBasisPoints: 250 },
      upper: { rateBasisPoints: 1800, cgstBasisPoints: 900, sgstBasisPoints: 900 }
    });

    const currentRule = before["currentRule"] as { id: string };
    const accepted = await db
      .transaction()
      .execute((trx) =>
        service.acceptOwnerConsent(
          trx,
          actor,
          { organizationId, propertyId, ruleVersionId: currentRule.id, accepted: true },
          metadata()
        )
      );
    expect(accepted["accepted"]).toBe(true);

    const policies = await db
      .selectFrom("commercial_tax_policies")
      .selectAll()
      .where("property_id", "=", propertyId)
      .orderBy("code")
      .execute();
    expect(policies.map((policy) => policy.code)).toEqual([
      "INDIA_GST_ABOVE_THRESHOLD",
      "INDIA_GST_UPTO_THRESHOLD"
    ]);

    const versions = await db
      .selectFrom("commercial_tax_policy_versions")
      .selectAll()
      .where("property_id", "=", propertyId)
      .orderBy("minimum_basis_minor")
      .execute();
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.maximum_basis_minor !== null)).toMatchObject({
      minimum_basis_minor: null,
      maximum_basis_minor: 750_001,
      selection_basis: "NIGHTLY_UNIT_RATE",
      applies_to_fee: false
    });
    expect(versions.find((version) => version.minimum_basis_minor !== null)).toMatchObject({
      minimum_basis_minor: 750_001,
      maximum_basis_minor: null,
      selection_basis: "NIGHTLY_UNIT_RATE",
      applies_to_fee: false
    });

    const components = await db
      .selectFrom("commercial_tax_components")
      .select(["component_code", "rate_basis_points"])
      .where("property_id", "=", propertyId)
      .orderBy("rate_basis_points")
      .orderBy("component_code")
      .execute();
    expect(components).toEqual([
      { component_code: "CGST", rate_basis_points: 250 },
      { component_code: "SGST", rate_basis_points: 250 },
      { component_code: "CGST", rate_basis_points: 900 },
      { component_code: "SGST", rate_basis_points: 900 }
    ]);

    await expect(
      db.transaction().execute((trx) => service.listRules(trx, actor))
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
