import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { PropertyOnboardingService } from "../src/modules/property-onboarding/application/property-onboarding-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";

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

async function createOwnerPropertyFixture(): Promise<{
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
}> {
  const authSubject = `phase2c-owner-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 2C Owner",
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
        legalName: `Phase 2C Organization ${randomUUID()}`,
        tradingName: null,
        organizationType: "PRIVATE_LIMITED",
        countryCode: "IN",
        currencyCode: "INR"
      },
      requestMetadata()
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
        name: `Wildleaf Onboarding ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      requestMetadata()
    )
  );

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id
  };
}

async function createPlatformReviewer(): Promise<ActorContext> {
  const authSubject = `phase2c-reviewer-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Wildleaf Operations Reviewer",
      email_verified: true,
      status: "ACTIVE"
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .insertInto("platform_staff_roles")
    .values({
      id: randomUUID(),
      user_id: user.id,
      role_code: "OPERATIONS_ADMIN",
      status: "ACTIVE"
    })
    .execute();

  return {
    userId: user.id,
    email: user.email,
    platformRoles: ["OPERATIONS_ADMIN"],
    organizationMemberships: [],
    propertyGrants: []
  };
}

async function makePropertyReady(): Promise<{
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  documentId: string;
}> {
  const fixture = await createOwnerPropertyFixture();
  const setup = new PropertySetupService();
  const onboarding = new PropertyOnboardingService();

  await db
    .updateTable("properties")
    .set({
      property_type: "RESORT",
      sale_mode: "BOTH",
      address_line_1: "Chail Road",
      city: "Chail",
      state_region: "Himachal Pradesh",
      postal_code: "173217",
      check_in_time: "14:00",
      check_out_time: "11:00"
    })
    .where("id", "=", fixture.propertyId)
    .execute();

  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: "PREMIUM",
        name: "Premium Cottage",
        accommodationType: "COTTAGE",
        description: "Premium cottage category",
        baseOccupancy: 2,
        maxAdults: 3,
        maxChildren: 2,
        maxOccupancy: 4,
        sizeSqm: 35,
        bedConfiguration: "1 King Bed",
        extraBedAllowed: true,
        defaultViewLabel: "Garden View",
        sortOrder: 1
      },
      requestMetadata()
    )
  );

  await db.transaction().execute((trx) =>
    setup.createPhysicalUnit(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        roomCategoryId: category.roomCategory.id,
        structureId: null,
        floorId: null,
        unitCode: `COTT-${randomUUID().slice(0, 8)}`,
        displayName: "Ellie's Nest",
        hasView: true,
        viewLabel: "Garden View",
        wheelchairAccessible: false,
        stepFreeAccessible: true,
        liftAccessible: false,
        smokingPolicy: "NON_SMOKING",
        internalNotes: null,
        sortOrder: 1
      },
      requestMetadata()
    )
  );

  await db.transaction().execute((trx) =>
    onboarding.savePolicies(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        childrenPolicy: "ALLOWED",
        petsPolicy: "ON_REQUEST",
        smokingPolicy: "NON_SMOKING",
        partiesEventsPolicy: "ON_REQUEST",
        minimumCheckinAge: 18,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
        houseRules: "Respect quiet hours and property safety rules."
      },
      requestMetadata()
    )
  );

  await db.transaction().execute((trx) =>
    onboarding.replaceAmenities(
      trx,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId,
      [
        { code: "WIFI", details: null },
        { code: "PARKING", details: "On-site parking" },
        { code: "GARDEN", details: null }
      ],
      requestMetadata()
    )
  );

  await db.transaction().execute((trx) =>
    onboarding.addMedia(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        mediaType: "IMAGE",
        storageProvider: "OTHER",
        storageKey: `tests/property/${randomUUID()}/cover.jpg`,
        mimeType: "image/jpeg",
        altText: "Property cover image",
        caption: null,
        isCover: true,
        sortOrder: 1
      },
      requestMetadata()
    )
  );

  const document = await db.transaction().execute((trx) =>
    onboarding.addDocument(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        documentType: "OWNERSHIP_PROOF",
        storageProvider: "OTHER",
        storageKey: `tests/property/${randomUUID()}/ownership.pdf`,
        originalFilename: "ownership.pdf",
        issuedOn: null,
        expiresOn: null
      },
      requestMetadata()
    )
  );

  const documentView = document["document"] as { id: string };

  return {
    ...fixture,
    documentId: documentView.id
  };
}

describe("complete property onboarding workflow", () => {
  it("builds a submission-ready checklist from profile, setup, content and documents", async () => {
    const fixture = await makePropertyReady();
    const service = new PropertyOnboardingService();

    const onboarding = await service.getOnboarding(
      db,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId
    );
    const checklist = onboarding["checklist"] as {
      readyToSubmit: boolean;
      missing: string[];
    };

    expect(checklist.readyToSubmit).toBe(true);
    expect(checklist.missing).toEqual([]);
  });

  it("rejects submission when onboarding is incomplete", async () => {
    const fixture = await createOwnerPropertyFixture();
    const service = new PropertyOnboardingService();

    await expect(
      db
        .transaction()
        .execute((trx) =>
          service.submit(
            trx,
            fixture.actor,
            fixture.organizationId,
            fixture.propertyId,
            1,
            requestMetadata()
          )
        )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("enforces platform-only review, verifies the legal document, approves and activates", async () => {
    const fixture = await makePropertyReady();
    const reviewer = await createPlatformReviewer();
    const service = new PropertyOnboardingService();

    const submitted = await db
      .transaction()
      .execute((trx) =>
        service.submit(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          1,
          requestMetadata()
        )
      );
    const submittedProperty = submitted["property"] as {
      status: string;
      version: number;
      submissionSequence: number;
    };

    expect(submittedProperty.status).toBe("SUBMITTED");
    expect(submittedProperty.version).toBe(2);
    expect(submittedProperty.submissionSequence).toBe(1);

    await expect(
      db
        .transaction()
        .execute((trx) =>
          service.startReview(trx, fixture.actor, fixture.propertyId, 2, requestMetadata())
        )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });

    const reviewStarted = await db
      .transaction()
      .execute((trx) =>
        service.startReview(trx, reviewer, fixture.propertyId, 2, requestMetadata())
      );
    expect((reviewStarted["property"] as { status: string }).status).toBe("UNDER_REVIEW");

    const verified = await db
      .transaction()
      .execute((trx) =>
        service.verifyDocument(
          trx,
          reviewer,
          fixture.propertyId,
          fixture.documentId,
          "VERIFIED",
          null,
          requestMetadata()
        )
      );
    expect((verified["document"] as { verificationStatus: string }).verificationStatus).toBe(
      "VERIFIED"
    );

    const approved = await db
      .transaction()
      .execute((trx) =>
        service.decideReview(
          trx,
          reviewer,
          fixture.propertyId,
          3,
          "APPROVED",
          "Property onboarding verified",
          requestMetadata()
        )
      );
    expect((approved["property"] as { status: string }).status).toBe("APPROVED");

    const activated = await db
      .transaction()
      .execute((trx) => service.activate(trx, reviewer, fixture.propertyId, 4, requestMetadata()));
    const liveProperty = activated["property"] as {
      status: string;
      version: number;
      publicSlug: string | null;
    };

    expect(liveProperty.status).toBe("LIVE");
    expect(liveProperty.version).toBe(5);
    expect(liveProperty.publicSlug).toBeTruthy();

    const reviewRound = await db
      .selectFrom("property_review_rounds")
      .selectAll()
      .where("property_id", "=", fixture.propertyId)
      .where("submission_number", "=", 1)
      .executeTakeFirstOrThrow();

    expect(reviewRound.status).toBe("COMPLETED");
    expect(reviewRound.decision).toBe("APPROVED");
  });

  it("lists the platform review queue with authorization, filters and stable cursors", async () => {
    const newer = await makePropertyReady();
    const older = await makePropertyReady();
    const reviewer = await createPlatformReviewer();
    const service = new PropertyOnboardingService();

    for (const fixture of [newer, older]) {
      await db
        .transaction()
        .execute((trx) =>
          service.submit(
            trx,
            fixture.actor,
            fixture.organizationId,
            fixture.propertyId,
            1,
            requestMetadata()
          )
        );
    }

    await Promise.all([
      db
        .updateTable("properties")
        .set({ updated_at: new Date("2040-01-02T00:00:00.000Z") })
        .where("id", "=", newer.propertyId)
        .execute(),
      db
        .updateTable("properties")
        .set({ updated_at: new Date("2040-01-01T00:00:00.000Z") })
        .where("id", "=", older.propertyId)
        .execute()
    ]);

    await expect(
      service.listPlatformReviewQueue(db, newer.actor, { status: "SUBMITTED", limit: 1 })
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });

    const firstPage = await service.listPlatformReviewQueue(db, reviewer, {
      status: "SUBMITTED",
      limit: 1
    });
    const firstItems = firstPage["items"] as Array<Record<string, unknown>>;
    const nextCursor = firstPage["nextCursor"] as string;

    expect(firstItems).toHaveLength(1);
    expect(firstItems[0]).toMatchObject({
      propertyId: newer.propertyId,
      organizationId: newer.organizationId,
      status: "SUBMITTED"
    });
    expect(nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstItems[0])).not.toContain(newer.actor.email);

    const secondPage = await service.listPlatformReviewQueue(db, reviewer, {
      status: "SUBMITTED",
      limit: 1,
      cursor: nextCursor
    });
    const secondItems = secondPage["items"] as Array<Record<string, unknown>>;

    expect(secondItems).toHaveLength(1);
    expect(secondItems[0]?.["propertyId"]).toBe(older.propertyId);
    expect(secondItems[0]?.["propertyId"]).not.toBe(newer.propertyId);
  });

  it("rejects malformed platform review queue cursors", async () => {
    const reviewer = await createPlatformReviewer();
    const service = new PropertyOnboardingService();

    await expect(
      service.listPlatformReviewQueue(db, reviewer, { cursor: "not-a-valid-cursor" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("requires a verified ownership or lease document before approval", async () => {
    const fixture = await makePropertyReady();
    const reviewer = await createPlatformReviewer();
    const service = new PropertyOnboardingService();

    await db
      .transaction()
      .execute((trx) =>
        service.submit(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          1,
          requestMetadata()
        )
      );

    await db
      .transaction()
      .execute((trx) =>
        service.startReview(trx, reviewer, fixture.propertyId, 2, requestMetadata())
      );

    await expect(
      db
        .transaction()
        .execute((trx) =>
          service.decideReview(
            trx,
            reviewer,
            fixture.propertyId,
            3,
            "APPROVED",
            null,
            requestMetadata()
          )
        )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("supports changes-required followed by a second submission round", async () => {
    const fixture = await makePropertyReady();
    const reviewer = await createPlatformReviewer();
    const service = new PropertyOnboardingService();

    await db
      .transaction()
      .execute((trx) =>
        service.submit(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          1,
          requestMetadata()
        )
      );

    await db
      .transaction()
      .execute((trx) =>
        service.startReview(trx, reviewer, fixture.propertyId, 2, requestMetadata())
      );

    const changes = await db
      .transaction()
      .execute((trx) =>
        service.decideReview(
          trx,
          reviewer,
          fixture.propertyId,
          3,
          "CHANGES_REQUIRED",
          "Please improve the legal document description",
          requestMetadata()
        )
      );
    expect((changes["property"] as { status: string }).status).toBe("CHANGES_REQUIRED");

    const resubmitted = await db
      .transaction()
      .execute((trx) =>
        service.submit(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          4,
          requestMetadata()
        )
      );
    const resubmittedProperty = resubmitted["property"] as {
      status: string;
      version: number;
      submissionSequence: number;
    };

    expect(resubmittedProperty.status).toBe("SUBMITTED");
    expect(resubmittedProperty.version).toBe(5);
    expect(resubmittedProperty.submissionSequence).toBe(2);

    const rounds = await db
      .selectFrom("property_review_rounds")
      .select(["submission_number", "status", "decision"])
      .where("property_id", "=", fixture.propertyId)
      .orderBy("submission_number")
      .execute();

    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.decision).toBe("CHANGES_REQUIRED");
    expect(rounds[0]?.status).toBe("COMPLETED");
    expect(rounds[1]?.status).toBe("OPEN");
  });

  it("records lifecycle events in the immutable audit and outbox streams", async () => {
    const fixture = await makePropertyReady();
    const service = new PropertyOnboardingService();

    await db
      .transaction()
      .execute((trx) =>
        service.submit(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          1,
          requestMetadata()
        )
      );

    const [audit, outbox] = await Promise.all([
      db
        .selectFrom("audit_events")
        .selectAll()
        .where("property_id", "=", fixture.propertyId)
        .where("action", "=", "property.submitted")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .selectAll()
        .where("aggregate_id", "=", fixture.propertyId)
        .where("event_type", "=", "property.submitted.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(audit.entity_type).toBe("property");
    expect(outbox.event_type).toBe("property.submitted.v1");
  });
});
