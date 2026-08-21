import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { registerPublicCatalogRoutes } from "../src/modules/public-booking/transport/public-catalog-routes.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { QuoteService } from "../src/modules/quotes/application/quote-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import { registerErrorHandler } from "../src/shared/http/error-handler.js";

const config = loadConfig();
const db = createDatabase(config);

interface Fixture {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  publicSlug: string;
  roomCategoryId: string;
  ratePlanId: string;
  rateProductId: string;
}

let app: FastifyInstance;
let fixture: Fixture;
let incompleteFixture: Fixture;

function metadata(source = "integration-test") {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source,
    ipAddress: null,
    userAgent: null
  };
}

async function configureCommercial(fixture: Fixture): Promise<void> {
  const commercial = new CommercialRuleService();
  const effectiveFrom = "2034-01-01";

  await db.transaction().execute((trx) =>
    commercial.setPropertyCommercialSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom,
        taxMode: "NO_TAX",
        feeMode: "NO_FEES",
        expectedVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    commercial.setGuestAgePolicy(
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
    commercial.createCancellationPolicy(
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
    commercial.createCancellationPolicyVersion(
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
    commercial.createCancellationAssignment(
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

  await db.transaction().execute((trx) =>
    new PromotionRuleService().setSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom: "2000-01-01",
        promotionMode: "NO_PROMOTIONS",
        expectedVersion: 0
      },
      metadata()
    )
  );
}

async function createFixture(withCommercial: boolean): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const authSubject = `phase6c-${suffix}`;

  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: authSubject,
      email: `${authSubject}@example.invalid`,
      display_name: "Phase 6C Owner",
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
        legalName: `Phase 6C Organization ${suffix}`,
        tradingName: "Wildleaf Public Quote",
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
        name: `Phase 6C Property ${suffix}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  const propertyId = property.property.id;
  const publicSlug = `phase-6c-${suffix}`;

  await db
    .updateTable("properties")
    .set({
      property_type: "HOTEL",
      sale_mode: "ROOMS_ONLY",
      locality: "Public Quote Hills",
      city: "Public Quote City",
      state_region: "Himachal Pradesh",
      country_code: "IN"
    })
    .where("id", "=", propertyId)
    .execute();

  const setup = new PropertySetupService();
  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        code: "PUBLIC-Q",
        name: "Public Quote Room",
        accommodationType: "ROOM",
        description: "Phase 6C public quote room",
        baseOccupancy: 2,
        maxAdults: 3,
        maxChildren: 2,
        maxOccupancy: 4,
        sizeSqm: 30,
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
          propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `PUBLIC-Q-${index}-${suffix}`,
          displayName: `Public Quote Room ${index}`,
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

  const rates = new RateService();
  const plan = await db.transaction().execute((trx) =>
    rates.createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        code: "PUBLIC-Q-EP",
        name: "Public Quote Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const product = await db.transaction().execute((trx) =>
    rates.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        ratePlanId: plan.ratePlan.id,
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

  const result: Fixture = {
    actor,
    organizationId: organization.organizationId,
    propertyId,
    publicSlug,
    roomCategoryId: category.roomCategory.id,
    ratePlanId: plan.ratePlan.id,
    rateProductId: product.rateProduct.id
  };

  if (withCommercial) {
    await configureCommercial(result);
  }

  await db
    .updateTable("properties")
    .set({
      status: "LIVE",
      public_slug: publicSlug,
      live_at: new Date()
    })
    .where("id", "=", propertyId)
    .execute();

  return result;
}

function publicQuotePayload(target: Fixture, arrivalDate: string, departureDate: string) {
  return {
    rateProductId: target.rateProductId,
    arrivalDate,
    departureDate,
    promotionCode: null,
    units: [{ adults: 2, childAges: [3, 8] }]
  };
}

async function createPublicQuote(
  target: Fixture,
  arrivalDate: string,
  departureDate: string,
  idempotencyKey = `public-quote-${randomUUID()}`
) {
  return app.inject({
    method: "POST",
    url: `/v1/public/properties/${target.publicSlug}/quotes`,
    headers: {
      "idempotency-key": idempotencyKey
    },
    payload: publicQuotePayload(target, arrivalDate, departureDate)
  });
}

beforeAll(async () => {
  fixture = await createFixture(true);
  incompleteFixture = await createFixture(false);
  app = Fastify({ logger: false });
  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = request.id;
    void reply.header("x-request-id", request.id);
    void reply.header("x-correlation-id", request.correlationId);
  });
  registerErrorHandler(app);
  await registerPublicCatalogRoutes(app, { db });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Phase 6C public exact quote and inventory hold", () => {
  it("creates an exact commercial quote as SYSTEM/null-user and replays idempotently", async () => {
    const key = `public-quote-${randomUUID()}`;
    const response = await createPublicQuote(fixture, "2034-02-10", "2034-02-12", key);

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.json() as {
      quote: {
        id: string;
        quoteReference: string;
        rateProductId: string;
        pricingScope: string;
        exactCommercialPriceIncluded: boolean;
        accommodationMinor: number;
        extraGuestMinor: number;
        discountMinor: number;
        feeMinor: number;
        taxMinor: number;
        totalMinor: number;
        commercialStatus: string;
        promotionStatus: string;
        holdEligible: boolean;
        guestAgePolicy: {
          infantMaxAge: number | null;
          childMaxAge: number;
        };
        units: Array<{
          children: number;
          infants: number;
          occupancyCount: number;
          chargeableChildren: number;
          extraChildren: number;
        }>;
        cancellationPolicy: {
          policyCode: string;
          policyName: string;
        };
        promotion: {
          promotionMode: string;
          discountMinor: number;
          lines: unknown[];
        };
      };
    };

    expect(body.quote).toMatchObject({
      rateProductId: fixture.rateProductId,
      pricingScope: "FINAL_COMMERCIAL_PRICE",
      exactCommercialPriceIncluded: true,
      accommodationMinor: 1_000_000,
      extraGuestMinor: 100_000,
      discountMinor: 0,
      feeMinor: 0,
      taxMinor: 0,
      totalMinor: 1_100_000,
      commercialStatus: "COMMERCIAL_RULES_APPLIED",
      promotionStatus: "EVALUATED",
      holdEligible: true
    });
    expect(body.quote.guestAgePolicy).toMatchObject({
      infantMaxAge: 4,
      childMaxAge: 12
    });
    expect(body.quote.units).toEqual([
      expect.objectContaining({
        children: 1,
        infants: 1,
        occupancyCount: 3,
        chargeableChildren: 1,
        extraChildren: 1
      })
    ]);
    expect(body.quote.cancellationPolicy).toMatchObject({
      policyCode: "FLEX",
      policyName: "Flexible Cancellation"
    });
    expect(body.quote.promotion).toMatchObject({
      promotionMode: "NO_PROMOTIONS",
      discountMinor: 0,
      lines: []
    });

    const quoteRow = await db
      .selectFrom("quotes")
      .select(["source", "created_by_user_id"])
      .where("id", "=", body.quote.id)
      .executeTakeFirstOrThrow();
    expect(quoteRow).toEqual({
      source: "public-api",
      created_by_user_id: null
    });

    const audit = await db
      .selectFrom("audit_events")
      .select(["actor_type", "actor_user_id", "actor_role"])
      .where("entity_type", "=", "quote")
      .where("entity_id", "=", body.quote.id)
      .where("action", "=", "quote.created")
      .executeTakeFirstOrThrow();
    expect(audit).toEqual({
      actor_type: "SYSTEM",
      actor_user_id: null,
      actor_role: "PUBLIC_BOOKING"
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.propertyId);
    expect(serialized).not.toContain("ratePlanId");
    expect(serialized).not.toContain("policyId");
    expect(serialized).not.toContain("versionId");
    expect(serialized).not.toContain("assignmentId");
    expect(serialized).not.toContain("sellableQuantity");

    const replay = await createPublicQuote(fixture, "2034-02-10", "2034-02-12", key);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(body);

    const count = await db
      .selectFrom("quotes")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("id", "=", body.quote.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  it("atomically converts a public quote to a canonical system-origin hold", async () => {
    const quoteResponse = await createPublicQuote(fixture, "2034-03-10", "2034-03-12");
    expect(quoteResponse.statusCode).toBe(201);
    const quote = (quoteResponse.json() as { quote: { id: string; quoteReference: string } }).quote;

    const holdKey = `public-hold-${randomUUID()}`;
    const response = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/hold`,
      headers: {
        "idempotency-key": holdKey
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.json() as {
      created: boolean;
      quoteId: string;
      quoteReference: string;
      hold: {
        id: string;
        status: string;
        startDate: string;
        endDate: string;
        expiresAt: string;
        items: Array<{
          bucketType: string;
          roomCategoryId: string | null;
          quantity: number;
        }>;
      };
    };

    expect(body).toMatchObject({
      created: true,
      quoteId: quote.id,
      quoteReference: quote.quoteReference,
      hold: {
        status: "ACTIVE",
        startDate: "2034-03-10",
        endDate: "2034-03-12",
        items: [
          {
            bucketType: "ROOM_CATEGORY",
            roomCategoryId: fixture.roomCategoryId,
            quantity: 1
          }
        ]
      }
    });

    const [holdRow, linkRow] = await Promise.all([
      db
        .selectFrom("inventory_holds")
        .select(["created_by_user_id", "status", "client_reference"])
        .where("id", "=", body.hold.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("quote_inventory_holds")
        .select(["linked_by_user_id", "source", "inventory_hold_id"])
        .where("quote_id", "=", quote.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(holdRow).toMatchObject({
      created_by_user_id: null,
      status: "ACTIVE",
      client_reference: quote.quoteReference
    });
    expect(linkRow).toMatchObject({
      linked_by_user_id: null,
      source: "public-api",
      inventory_hold_id: body.hold.id
    });

    const buckets = await db
      .selectFrom("inventory_daily_buckets")
      .select(["stay_date", "held_quantity"])
      .where("property_id", "=", fixture.propertyId)
      .where("room_category_id", "=", fixture.roomCategoryId)
      .where("stay_date", ">=", "2034-03-10")
      .where("stay_date", "<", "2034-03-12")
      .orderBy("stay_date")
      .execute();
    expect(buckets).toHaveLength(2);
    expect(buckets.map((row) => row.held_quantity)).toEqual([1, 1]);

    const audits = await db
      .selectFrom("audit_events")
      .select(["action", "actor_type", "actor_user_id", "actor_role"])
      .where("property_id", "=", fixture.propertyId)
      .where("actor_role", "=", "PUBLIC_BOOKING")
      .where("action", "in", ["inventory.hold.created", "quote.hold.created"])
      .execute();
    expect(audits).toHaveLength(2);
    expect(audits.every((row) => row.actor_type === "SYSTEM")).toBe(true);
    expect(audits.every((row) => row.actor_user_id === null)).toBe(true);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/hold`,
      headers: {
        "idempotency-key": holdKey
      }
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(body);

    const secondKey = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/hold`,
      headers: {
        "idempotency-key": `public-hold-second-${randomUUID()}`
      }
    });
    expect(secondKey.statusCode).toBe(200);
    expect(secondKey.json()).toMatchObject({
      created: false,
      quoteId: quote.id,
      hold: { id: body.hold.id, status: "ACTIVE" }
    });
  });

  it("refuses to convert an authenticated partner quote through the public hold route", async () => {
    const partnerQuote = await db.transaction().execute((trx) =>
      new QuoteService().createQuote(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          rateProductId: fixture.rateProductId,
          arrivalDate: "2034-04-10",
          departureDate: "2034-04-12",
          ttlSeconds: 900,
          promotionCode: null,
          units: [{ adults: 2, childAges: [] }]
        },
        metadata()
      )
    );

    const source = await db
      .selectFrom("quotes")
      .select("source")
      .where("id", "=", partnerQuote.quote.id)
      .executeTakeFirstOrThrow();
    expect(source.source).toBe("integration-test");

    const response = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/` + `${partnerQuote.quote.id}/hold`,
      headers: {
        "idempotency-key": `partner-guard-${randomUUID()}`
      }
    });

    expect(response.statusCode).toBe(404);

    const link = await db
      .selectFrom("quote_inventory_holds")
      .select("id")
      .where("quote_id", "=", partnerQuote.quote.id)
      .executeTakeFirst();
    expect(link).toBeUndefined();
  });

  it("rejects incomplete commercial configuration and rolls the public quote transaction back", async () => {
    const before = await db
      .selectFrom("quotes")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", incompleteFixture.propertyId)
      .where("source", "=", "public-api")
      .executeTakeFirstOrThrow();

    const response = await createPublicQuote(incompleteFixture, "2034-05-10", "2034-05-12");

    expect(response.statusCode).toBe(409);

    const after = await db
      .selectFrom("quotes")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", incompleteFixture.propertyId)
      .where("source", "=", "public-api")
      .executeTakeFirstOrThrow();

    expect(Number(after.count)).toBe(Number(before.count));
  });

  it("requires a strong idempotency key and keeps non-live slugs outside public write routes", async () => {
    const weak = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes`,
      headers: {
        "idempotency-key": "too-short"
      },
      payload: publicQuotePayload(fixture, "2034-06-10", "2034-06-12")
    });
    expect(weak.statusCode).toBe(400);

    await db
      .updateTable("properties")
      .set({ status: "DRAFT" })
      .where("id", "=", incompleteFixture.propertyId)
      .execute();

    const hidden = await createPublicQuote(incompleteFixture, "2034-06-10", "2034-06-12");
    expect(hidden.statusCode).toBe(404);
  });
});
