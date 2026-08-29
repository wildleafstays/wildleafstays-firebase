import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import {
  assertOwnerPropertyEditable,
  OwnerResponsibilityService
} from "../src/modules/properties/application/owner-responsibility-service.js";

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

describe("approved property owner responsibility", () => {
  it("keeps a live property locked until immutable responsibility acceptance", async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const propertyId = randomUUID();

    await db
      .insertInto("users")
      .values({
        id: userId,
        auth_provider: "test",
        auth_subject: `owner-responsibility-${userId}`,
        email: `owner-responsibility-${userId}@example.invalid`,
        display_name: "Live Property Owner",
        email_verified: true,
        status: "ACTIVE"
      })
      .execute();
    await db
      .insertInto("organizations")
      .values({
        id: organizationId,
        legal_name: "Owner Responsibility Test Organization",
        trading_name: null,
        organization_type: "PRIVATE_LIMITED",
        status: "ACTIVE",
        country_code: "IN",
        currency_code: "INR"
      })
      .execute();
    const property = await db
      .insertInto("properties")
      .values({
        id: propertyId,
        organization_id: organizationId,
        name: "Live Editable Hotel",
        status: "LIVE",
        timezone: "Asia/Kolkata",
        country_code: "IN"
      })
      .returning(["id", "organization_id", "status"])
      .executeTakeFirstOrThrow();

    const actor: ActorContext = {
      userId,
      email: `owner-responsibility-${userId}@example.invalid`,
      platformRoles: [],
      organizationMemberships: [{ membershipId: randomUUID(), organizationId, role: "OWNER" }],
      propertyGrants: []
    };
    const service = new OwnerResponsibilityService();

    await expect(assertOwnerPropertyEditable(db, property)).rejects.toMatchObject({
      statusCode: 409
    });

    const before = await service.get(db, actor, organizationId, propertyId);
    expect(before).toMatchObject({ accepted: false, requiredForEditing: true, editable: false });

    const terms = before["currentTerms"] as { id: string };
    const accepted = await db
      .transaction()
      .execute((trx) =>
        service.accept(
          trx,
          actor,
          { organizationId, propertyId, termsVersionId: terms.id, accepted: true },
          metadata()
        )
      );
    expect(accepted).toMatchObject({ accepted: true, editable: true });
    await expect(assertOwnerPropertyEditable(db, property)).resolves.toBeUndefined();

    const evidence = await db
      .selectFrom("property_owner_responsibility_acceptances")
      .selectAll()
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow();
    expect(evidence.acceptance_text).toContain(
      "I am responsible for keeping all property information"
    );
    await expect(
      db
        .updateTable("property_owner_responsibility_acceptances")
        .set({ user_agent: "tampered" })
        .where("id", "=", evidence.id)
        .execute()
    ).rejects.toThrow(/immutable/);
  });
});
