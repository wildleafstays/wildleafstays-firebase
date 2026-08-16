import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";

const config = loadConfig();
const db = createDatabase(config);

afterAll(async () => {
  await db.destroy();
});

describe("platform core database", () => {
  it("creates an organization, owner membership, audit event and outbox event atomically", async () => {
    const authSubject = `integration-${randomUUID()}`;
    const user = await db
      .insertInto("users")
      .values({
        id: randomUUID(),
        auth_provider: "test",
        auth_subject: authSubject,
        email: `${authSubject}@example.invalid`,
        display_name: "Integration Owner",
        email_verified: true,
        status: "ACTIVE"
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const actor: ActorContext = {
      userId: user.id,
      email: user.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: []
    };

    const result = await db.transaction().execute(async (trx) => {
      const service = new CreateOrganizationService();
      return service.execute(
        trx,
        actor,
        {
          legalName: "Wildleaf Integration Test",
          tradingName: null,
          organizationType: "PRIVATE_LIMITED",
          countryCode: "IN",
          currencyCode: "INR"
        },
        {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          source: "integration-test",
          ipAddress: null,
          userAgent: null
        }
      );
    });

    const [membership, audit, outbox] = await Promise.all([
      db
        .selectFrom("organization_memberships")
        .selectAll()
        .where("id", "=", result.membershipId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("entity_type", "=", "organization")
        .where("entity_id", "=", result.organizationId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_type", "=", "organization")
        .where("aggregate_id", "=", result.organizationId)
        .executeTakeFirstOrThrow()
    ]);

    expect(membership.user_id).toBe(user.id);
    expect(membership.role_code).toBe("OWNER");
    expect(audit.action).toBe("organization.created");
    expect(outbox.event_type).toBe("organization.created.v1");
  });

  it("rejects mutation of audit history at the database boundary", async () => {
    const audit = await db
      .selectFrom("audit_events")
      .select(["id"])
      .orderBy("created_at", "desc")
      .executeTakeFirstOrThrow();

    await expect(
      db
        .updateTable("audit_events")
        .set({ reason: "tampered" })
        .where("id", "=", audit.id)
        .execute()
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects cross-organization property grants with composite foreign keys", async () => {
    const userAId = randomUUID();
    const userBId = randomUUID();
    const organizationAId = randomUUID();
    const organizationBId = randomUUID();
    const membershipAId = randomUUID();
    const propertyBId = randomUUID();

    await db
      .insertInto("users")
      .values([
        {
          id: userAId,
          auth_provider: "test",
          auth_subject: `cross-a-${randomUUID()}`,
          email: null,
          display_name: null,
          email_verified: false,
          status: "ACTIVE"
        },
        {
          id: userBId,
          auth_provider: "test",
          auth_subject: `cross-b-${randomUUID()}`,
          email: null,
          display_name: null,
          email_verified: false,
          status: "ACTIVE"
        }
      ])
      .execute();

    await db
      .insertInto("organizations")
      .values([
        {
          id: organizationAId,
          legal_name: "Organization A",
          trading_name: null,
          organization_type: "PRIVATE_LIMITED",
          status: "DRAFT",
          country_code: "IN",
          currency_code: "INR"
        },
        {
          id: organizationBId,
          legal_name: "Organization B",
          trading_name: null,
          organization_type: "PRIVATE_LIMITED",
          status: "DRAFT",
          country_code: "IN",
          currency_code: "INR"
        }
      ])
      .execute();

    await db
      .insertInto("organization_memberships")
      .values({
        id: membershipAId,
        organization_id: organizationAId,
        user_id: userAId,
        role_code: "ADMIN",
        status: "ACTIVE",
        invited_by_user_id: null
      })
      .execute();

    await db
      .insertInto("properties")
      .values({
        id: propertyBId,
        organization_id: organizationBId,
        public_slug: null,
        name: "Property B",
        status: "DRAFT",
        timezone: "Asia/Kolkata"
      })
      .execute();

    await expect(
      db
        .insertInto("property_access_grants")
        .values({
          id: randomUUID(),
          organization_id: organizationBId,
          property_id: propertyBId,
          organization_membership_id: membershipAId,
          role_code: "MANAGER",
          status: "ACTIVE"
        })
        .execute()
    ).rejects.toThrow();
  });
});
