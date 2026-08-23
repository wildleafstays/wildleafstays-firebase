import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { SavePropertyProfileService } from "../src/modules/properties/application/save-property-profile-service.js";

const config = loadConfig();
const db = createDatabase(config);

afterAll(async () => {
  await db.destroy();
});

function requestMetadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "integration-test",
    ipAddress: null,
    userAgent: null
  };
}

async function createOwnerFixture(): Promise<{
  actor: ActorContext;
  organizationId: string;
}> {
  const authSubject = `phase2-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 2 Owner",
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

  const organization = await db.transaction().execute(async (trx) => {
    const service = new CreateOrganizationService();
    return service.execute(
      trx,
      baseActor,
      {
        legalName: `Wildleaf Phase 2 ${randomUUID()}`,
        tradingName: null,
        organizationType: "PRIVATE_LIMITED",
        countryCode: "IN",
        currencyCode: "INR"
      },
      requestMetadata()
    );
  });

  return {
    organizationId: organization.organizationId,
    actor: {
      ...baseActor,
      organizationMemberships: [
        {
          membershipId: organization.membershipId,
          organizationId: organization.organizationId,
          role: "OWNER"
        }
      ]
    }
  };
}

describe("property onboarding foundation", () => {
  it("creates a property draft with audit and outbox events atomically", async () => {
    const fixture = await createOwnerFixture();

    const result = await db.transaction().execute(async (trx) => {
      const service = new CreatePropertyDraftService();
      return service.execute(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          name: "Fernwood Test Resort",
          timezone: "Asia/Kolkata"
        },
        requestMetadata()
      );
    });

    expect(result.property.status).toBe("DRAFT");
    expect(result.property.version).toBe(1);
    expect(result.property.organizationId).toBe(fixture.organizationId);

    const [audit, outbox] = await Promise.all([
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("entity_type", "=", "property")
        .where("entity_id", "=", result.property.id)
        .where("action", "=", "property.created")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_type", "=", "property")
        .where("aggregate_id", "=", result.property.id)
        .where("event_type", "=", "property.created.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(audit.organization_id).toBe(fixture.organizationId);
    expect(outbox.aggregate_id).toBe(result.property.id);
  });

  it("saves the property profile and increments the optimistic version", async () => {
    const fixture = await createOwnerFixture();

    const created = await db.transaction().execute(async (trx) => {
      const service = new CreatePropertyDraftService();
      return service.execute(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          name: "Draft Villa",
          timezone: "Asia/Kolkata"
        },
        requestMetadata()
      );
    });

    const saved = await db.transaction().execute(async (trx) => {
      const service = new SavePropertyProfileService();
      return service.execute(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: created.property.id,
          expectedVersion: 1,
          name: "Wildleaf Fernwood",
          timezone: "Asia/Kolkata",
          propertyType: "RESORT",
          saleMode: "BOTH",
          shortDescription: "A garden resort in the hills.",
          description: "Phase 2 integration property.",
          addressLine1: "Chail Road",
          addressLine2: null,
          locality: "Chail",
          city: "Chail",
          stateRegion: "Himachal Pradesh",
          postalCode: "173217",
          countryCode: "IN",
          latitude: 30.967,
          longitude: 77.189,
          contactPhone: "+91 99999 99999",
          contactEmail: "property@example.invalid",
          checkInTime: "14:00",
          checkOutTime: "11:00"
        },
        requestMetadata()
      );
    });

    expect(saved.property.version).toBe(2);
    expect(saved.property.propertyType).toBe("RESORT");
    expect(saved.property.saleMode).toBe("BOTH");
    expect(saved.property.city).toBe("Chail");
  });

  it("rejects a stale property profile update", async () => {
    const fixture = await createOwnerFixture();

    const created = await db.transaction().execute(async (trx) => {
      const service = new CreatePropertyDraftService();
      return service.execute(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          name: "Concurrency Test",
          timezone: "Asia/Kolkata"
        },
        requestMetadata()
      );
    });

    const service = new SavePropertyProfileService();
    const input = {
      organizationId: fixture.organizationId,
      propertyId: created.property.id,
      expectedVersion: 1,
      name: "Concurrency Test",
      timezone: "Asia/Kolkata",
      propertyType: "VILLA" as const,
      saleMode: "FULL_PROPERTY_ONLY" as const,
      shortDescription: null,
      description: null,
      addressLine1: null,
      addressLine2: null,
      locality: null,
      city: "Chail",
      stateRegion: "Himachal Pradesh",
      postalCode: null,
      countryCode: "IN",
      latitude: null,
      longitude: null,
      contactPhone: null,
      contactEmail: null,
      checkInTime: null,
      checkOutTime: null
    };

    await db
      .transaction()
      .execute((trx) => service.execute(trx, fixture.actor, input, requestMetadata()));

    await expect(
      db
        .transaction()
        .execute((trx) => service.execute(trx, fixture.actor, input, requestMetadata()))
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("prevents an owner from creating a property in another organization", async () => {
    const fixtureA = await createOwnerFixture();
    const fixtureB = await createOwnerFixture();

    await expect(
      db.transaction().execute(async (trx) => {
        const service = new CreatePropertyDraftService();
        return service.execute(
          trx,
          fixtureA.actor,
          {
            organizationId: fixtureB.organizationId,
            name: "Forbidden Property",
            timezone: "Asia/Kolkata"
          },
          requestMetadata()
        );
      })
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });
});
