import { randomUUID } from "node:crypto";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type {
  IdentityVerifier,
  VerifiedIdentity
} from "../src/infrastructure/identity/identity-verifier.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { AccessRepository } from "../src/modules/access/infrastructure/access-repository.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import type { RazorpayOrderGateway } from "../src/modules/payments/application/razorpay-order-service.js";
import type {
  RazorpayCreateOrderInput,
  RazorpayOrder
} from "../src/modules/payments/infrastructure/razorpay-provider.js";
import { registerGuestSelfServiceRoutes } from "../src/modules/guest/transport/guest-self-service-routes.js";
import { UserRepository } from "../src/modules/identity/infrastructure/user-repository.js";
import { registerSessionRoutes } from "../src/modules/identity/transport/session-routes.js";
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
let razorpayGateway: FakeRazorpayGateway;
let identityVerifier: FakeIdentityVerifier;
let userRepository: UserRepository;
let accessRepository: AccessRepository;

class FakeRazorpayGateway implements RazorpayOrderGateway {
  private readonly orders = new Map<string, RazorpayOrder>();
  createCalls = 0;

  publicKeyId(): string {
    return "rzp_test_phase6d_public";
  }

  async createOrder(input: RazorpayCreateOrderInput): Promise<RazorpayOrder> {
    this.createCalls += 1;

    const existing = this.orders.get(input.receipt);
    if (existing) return existing;

    const order: RazorpayOrder = {
      id: `order_${randomUUID().replaceAll("-", "")}`,
      amount: input.amountMinor,
      amountPaid: 0,
      amountDue: input.amountMinor,
      currency: input.currencyCode,
      receipt: input.receipt,
      status: "created",
      attempts: 0,
      createdAt: Math.floor(Date.now() / 1000)
    };

    this.orders.set(input.receipt, order);
    return order;
  }

  async findOrdersByReceipt(receipt: string): Promise<RazorpayOrder[]> {
    const order = this.orders.get(receipt);
    return order ? [order] : [];
  }
}

interface IssuedGuestIdentity {
  token: string;
  subject: string;
  email: string;
}

class FakeIdentityVerifier implements IdentityVerifier {
  private readonly identities = new Map<string, VerifiedIdentity>();

  issue(email: string, displayName: string): IssuedGuestIdentity {
    const suffix = randomUUID().replaceAll("-", "");
    const token = `phase8a-token-${suffix}`;
    const subject = `phase8a-subject-${suffix}`;
    const atIndex = email.indexOf("@");

    if (atIndex <= 0) {
      throw new Error("Phase 8A fake identity requires an email address");
    }

    const uniqueEmail = `${email.slice(0, atIndex)}.${suffix.slice(0, 12)}` + email.slice(atIndex);

    this.identities.set(token, {
      provider: "firebase",
      subject,
      email: uniqueEmail,
      displayName,
      emailVerified: true
    });

    return {
      token,
      subject,
      email: uniqueEmail
    };
  }

  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    const identity = this.identities.get(token);

    if (!identity) {
      throw new Error("Invalid Phase 8A test identity token");
    }

    return identity;
  }
}

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

async function createPublicQuoteAndHold(
  target: Fixture,
  arrivalDate: string,
  departureDate: string
) {
  const quoteResponse = await createPublicQuote(target, arrivalDate, departureDate);
  expect(quoteResponse.statusCode).toBe(201);

  const quote = (
    quoteResponse.json() as {
      quote: {
        id: string;
        quoteReference: string;
        totalMinor: number;
        currencyCode: string;
      };
    }
  ).quote;

  const holdResponse = await app.inject({
    method: "POST",
    url: `/v1/public/properties/${target.publicSlug}/quotes/${quote.id}/hold`,
    headers: {
      "idempotency-key": `public-hold-${randomUUID()}`
    }
  });

  expect(holdResponse.statusCode).toBe(201);

  return {
    quote,
    hold: (
      holdResponse.json() as {
        hold: {
          id: string;
          expiresAt: string;
        };
      }
    ).hold
  };
}

beforeAll(async () => {
  fixture = await createFixture(true);
  incompleteFixture = await createFixture(false);

  app = Fastify({ logger: false });
  app.decorateRequest("actor", null);
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = request.id;
    void reply.header("x-request-id", request.id);
    void reply.header("x-correlation-id", request.correlationId);
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Wildleaf Phase 8A Integration Test API",
        version: "8A"
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer"
          }
        }
      }
    }
  });

  registerErrorHandler(app);

  razorpayGateway = new FakeRazorpayGateway();
  identityVerifier = new FakeIdentityVerifier();
  userRepository = new UserRepository(db);
  accessRepository = new AccessRepository(db);

  const authentication = {
    identityVerifier,
    userRepository,
    accessRepository
  };

  await registerPublicCatalogRoutes(app, {
    db,
    authentication,
    razorpayOrderGateway: razorpayGateway
  });

  await registerSessionRoutes(app, authentication);

  await registerGuestSelfServiceRoutes(app, {
    db,
    ...authentication
  });

  await app.ready();
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
describe("Phase 6D public guest reservation and Razorpay checkout", () => {
  it("creates one SYSTEM/null-user reservation, payment intent and Razorpay order and replays safely", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2034-02-20", "2034-02-22");

    const checkoutKey = `public-checkout-${randomUUID()}`;
    const callsBefore = razorpayGateway.createCalls;

    const response = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        "idempotency-key": checkoutKey
      },
      payload: {
        leadGuest: {
          name: "  Public   Guest  ",
          email: "PUBLIC.GUEST@EXAMPLE.COM",
          phone: "+919876543210"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.json() as {
      reservation: {
        id: string;
        reservationReference: string;
        quoteId: string;
        status: string;
        totalMinor: number;
        currencyCode: string;
        leadGuest: {
          name: string;
          email: string | null;
          phone: string | null;
        };
      };
      paymentIntent: {
        id: string;
        paymentReference: string;
        reservationId: string;
        status: string;
        amountMinor: number;
        currencyCode: string;
        expiresAt: string;
      };
      checkout: {
        keyId: string;
        orderId: string;
        paymentIntentId: string;
        reservationId: string;
        amountMinor: number;
        currencyCode: string;
        receipt: string;
        expiresAt: string;
      };
    };

    expect(body.reservation).toMatchObject({
      quoteId: quote.id,
      status: "PAYMENT_PENDING",
      totalMinor: quote.totalMinor,
      currencyCode: quote.currencyCode,
      leadGuest: {
        name: "Public Guest",
        email: "public.guest@example.com",
        phone: "+919876543210"
      }
    });

    expect(body.paymentIntent).toMatchObject({
      reservationId: body.reservation.id,
      status: "PENDING",
      amountMinor: quote.totalMinor,
      currencyCode: quote.currencyCode
    });

    expect(body.checkout).toMatchObject({
      keyId: "rzp_test_phase6d_public",
      paymentIntentId: body.paymentIntent.id,
      reservationId: body.reservation.id,
      amountMinor: quote.totalMinor,
      currencyCode: quote.currencyCode
    });

    expect(body.checkout.receipt).toMatch(/^WL-[A-Fa-f0-9]{32}$/);
    expect(razorpayGateway.createCalls).toBe(callsBefore + 1);

    const [reservationRow, paymentRow, providerOrderRow] = await Promise.all([
      db
        .selectFrom("reservations")
        .select(["quote_id", "status", "source", "created_by_user_id"])
        .where("id", "=", body.reservation.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_intents")
        .select([
          "reservation_id",
          "status",
          "source",
          "created_by_user_id",
          "amount_minor",
          "currency_code"
        ])
        .where("id", "=", body.paymentIntent.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_provider_orders")
        .select([
          "payment_intent_id",
          "reservation_id",
          "provider",
          "source",
          "amount_minor",
          "currency_code"
        ])
        .where("payment_intent_id", "=", body.paymentIntent.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(reservationRow).toEqual({
      quote_id: quote.id,
      status: "PAYMENT_PENDING",
      source: "public-api",
      created_by_user_id: null
    });

    expect(paymentRow).toEqual({
      reservation_id: body.reservation.id,
      status: "PENDING",
      source: "public-api",
      created_by_user_id: null,
      amount_minor: quote.totalMinor,
      currency_code: quote.currencyCode
    });

    expect(providerOrderRow).toEqual({
      payment_intent_id: body.paymentIntent.id,
      reservation_id: body.reservation.id,
      provider: "RAZORPAY",
      source: "public-api",
      amount_minor: quote.totalMinor,
      currency_code: quote.currencyCode
    });

    const correlationId = response.headers["x-correlation-id"];
    expect(typeof correlationId).toBe("string");

    const audits = await db
      .selectFrom("audit_events")
      .select(["action", "actor_type", "actor_user_id", "actor_role"])
      .where("property_id", "=", fixture.propertyId)
      .where("correlation_id", "=", String(correlationId))
      .where("actor_role", "=", "PUBLIC_BOOKING")
      .execute();

    expect(audits.map((row) => row.action).sort()).toEqual(
      [
        "payment.intent.created",
        "payment.provider_order.linked",
        "reservation.held.created",
        "reservation.payment.started"
      ].sort()
    );

    expect(audits.every((row) => row.actor_type === "SYSTEM")).toBe(true);
    expect(audits.every((row) => row.actor_user_id === null)).toBe(true);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.propertyId);

    const replay = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        "idempotency-key": checkoutKey
      },
      payload: {
        leadGuest: {
          name: "  Public   Guest  ",
          email: "PUBLIC.GUEST@EXAMPLE.COM",
          phone: "+919876543210"
        }
      }
    });

    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json()).toEqual(body);
    expect(razorpayGateway.createCalls).toBe(callsBefore + 1);

    const reservationCount = await db
      .selectFrom("reservations")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("quote_id", "=", quote.id)
      .executeTakeFirstOrThrow();

    const paymentCount = await db
      .selectFrom("payment_intents")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("reservation_id", "=", body.reservation.id)
      .executeTakeFirstOrThrow();

    expect(Number(reservationCount.count)).toBe(1);
    expect(Number(paymentCount.count)).toBe(1);
  });

  it("refuses to replace the immutable lead guest on a public checkout retry with a new key", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2034-02-23", "2034-02-25");

    const first = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        "idempotency-key": `public-checkout-first-${randomUUID()}`
      },
      payload: {
        leadGuest: {
          name: "Guest One",
          email: "guest.one@example.com",
          phone: null
        }
      }
    });

    expect(first.statusCode).toBe(201);

    const callsAfterFirst = razorpayGateway.createCalls;

    const conflicting = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        "idempotency-key": `public-checkout-conflict-${randomUUID()}`
      },
      payload: {
        leadGuest: {
          name: "Guest Two",
          email: "guest.two@example.com",
          phone: null
        }
      }
    });

    expect(conflicting.statusCode).toBe(409);
    expect(razorpayGateway.createCalls).toBe(callsAfterFirst);

    const count = await db
      .selectFrom("reservations")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("quote_id", "=", quote.id)
      .executeTakeFirstOrThrow();

    expect(Number(count.count)).toBe(1);
  });

  it("rejects checkout before reservation mutation when Razorpay is unavailable", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2034-02-26", "2034-02-28");

    const noProviderApp = Fastify({ logger: false });
    noProviderApp.decorateRequest("correlationId", "");

    noProviderApp.addHook("onRequest", async (request, reply) => {
      request.correlationId = request.id;
      void reply.header("x-request-id", request.id);
      void reply.header("x-correlation-id", request.correlationId);
    });

    registerErrorHandler(noProviderApp);
    await registerPublicCatalogRoutes(noProviderApp, { db });

    try {
      const before = await db
        .selectFrom("reservations")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("quote_id", "=", quote.id)
        .executeTakeFirstOrThrow();

      const response = await noProviderApp.inject({
        method: "POST",
        url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
        headers: {
          "idempotency-key": `public-checkout-no-provider-${randomUUID()}`
        },
        payload: {
          leadGuest: {
            name: "No Provider Guest",
            email: "no.provider@example.com",
            phone: null
          }
        }
      });

      expect(response.statusCode).toBe(503);

      const after = await db
        .selectFrom("reservations")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("quote_id", "=", quote.id)
        .executeTakeFirstOrThrow();

      expect(Number(after.count)).toBe(Number(before.count));
      expect(Number(after.count)).toBe(0);
    } finally {
      await noProviderApp.close();
    }
  });

  it("returns a minimal guarded public checkout status without exposing tenant or guest data", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2034-03-01", "2034-03-03");
    const checkout = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        "idempotency-key": `public-checkout-status-${randomUUID()}`
      },
      payload: {
        leadGuest: {
          name: "Status Guest",
          email: "status.guest@example.com",
          phone: null
        }
      }
    });
    expect(checkout.statusCode).toBe(201);

    const prepared = checkout.json() as {
      reservation: { id: string; reservationReference: string };
      paymentIntent: { id: string };
    };
    const status = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/checkout-status`,
      payload: {
        reservationId: prepared.reservation.id,
        paymentIntentId: prepared.paymentIntent.id
      }
    });

    expect(status.statusCode).toBe(200);
    expect(status.headers["cache-control"]).toBe("no-store");
    expect(status.json()).toMatchObject({
      outcome: "PAYMENT_PENDING",
      reservation: {
        id: prepared.reservation.id,
        reservationReference: prepared.reservation.reservationReference,
        status: "PAYMENT_PENDING"
      },
      paymentIntent: {
        id: prepared.paymentIntent.id,
        status: "PENDING"
      }
    });

    const serialized = status.body;
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.propertyId);
    expect(serialized).not.toContain("status.guest@example.com");

    const mismatched = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/checkout-status`,
      payload: {
        reservationId: prepared.reservation.id,
        paymentIntentId: randomUUID()
      }
    });
    expect(mismatched.statusCode).toBe(404);

    await db
      .updateTable("properties")
      .set({ status: "DRAFT" })
      .where("id", "=", fixture.propertyId)
      .execute();
    try {
      const hidden = await app.inject({
        method: "POST",
        url: `/v1/public/properties/${fixture.publicSlug}/checkout-status`,
        payload: {
          reservationId: prepared.reservation.id,
          paymentIntentId: prepared.paymentIntent.id
        }
      });
      expect(hidden.statusCode).toBe(404);
    } finally {
      await db
        .updateTable("properties")
        .set({ status: "LIVE" })
        .where("id", "=", fixture.propertyId)
        .execute();
    }

    await db
      .updateTable("payment_intents")
      .set({ status: "SUCCEEDED" })
      .where("id", "=", prepared.paymentIntent.id)
      .execute();
    await db
      .updateTable("reservations")
      .set({ status: "CONFIRMED" })
      .where("id", "=", prepared.reservation.id)
      .execute();

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/checkout-status`,
      payload: {
        reservationId: prepared.reservation.id,
        paymentIntentId: prepared.paymentIntent.id
      }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      outcome: "CONFIRMED",
      reservation: { status: "CONFIRMED" },
      paymentIntent: { status: "SUCCEEDED" }
    });
  });
});
interface Phase8aCheckoutBody {
  reservation: {
    id: string;
    reservationReference: string;
    quoteId: string;
    status: string;
  };
  paymentIntent: {
    id: string;
  };
}

interface Phase8aBooking {
  quoteId: string;
  reservationId: string;
  reservationReference: string;
  idempotencyKey: string;
}

async function phase8aUserId(identity: IssuedGuestIdentity): Promise<string> {
  const row = await db
    .selectFrom("users")
    .select("id")
    .where("auth_provider", "=", "firebase")
    .where("auth_subject", "=", identity.subject)
    .executeTakeFirstOrThrow();

  return row.id;
}

async function createPhase8aBooking(input: {
  arrivalDate: string;
  departureDate: string;
  identity?: IssuedGuestIdentity | null;
  name: string;
  email: string | null;
  phone: string | null;
  idempotencyKey?: string;
}): Promise<Phase8aBooking> {
  const { quote } = await createPublicQuoteAndHold(fixture, input.arrivalDate, input.departureDate);

  const idempotencyKey = input.idempotencyKey ?? `phase8a-checkout-${randomUUID()}`;

  const headers: Record<string, string> = {
    "idempotency-key": idempotencyKey
  };

  if (input.identity) {
    headers["authorization"] = `Bearer ${input.identity.token}`;
  }

  const response = await app.inject({
    method: "POST",
    url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
    headers,
    payload: {
      leadGuest: {
        name: input.name,
        email: input.email,
        phone: input.phone
      }
    }
  });

  expect(response.statusCode).toBe(201);

  const body = response.json() as Phase8aCheckoutBody;

  return {
    quoteId: quote.id,
    reservationId: body.reservation.id,
    reservationReference: body.reservation.reservationReference,
    idempotencyKey
  };
}

describe("Phase 8A guest account and self-service foundation", () => {
  let guestOne: IssuedGuestIdentity;
  let guestTwo: IssuedGuestIdentity;
  let emailMatchGuest: IssuedGuestIdentity;
  let phoneOnlyGuest: IssuedGuestIdentity;

  let guestOneBookingA: Phase8aBooking;
  let guestOneBookingB: Phase8aBooking;
  let guestTwoBooking: Phase8aBooking;
  let anonymousEmailBooking: Phase8aBooking;
  let anonymousPhoneBooking: Phase8aBooking;

  beforeAll(async () => {
    guestOne = identityVerifier.issue("phase8a.guest.one@example.invalid", "Phase 8A Guest One");

    guestTwo = identityVerifier.issue("phase8a.guest.two@example.invalid", "Phase 8A Guest Two");

    emailMatchGuest = identityVerifier.issue(
      "phase8a.matching.email@example.invalid",
      "Phase 8A Matching Email"
    );

    phoneOnlyGuest = identityVerifier.issue(
      "phase8a.phone.account@example.invalid",
      "Phase 8A Phone Account"
    );

    guestOneBookingA = await createPhase8aBooking({
      arrivalDate: "2035-01-10",
      departureDate: "2035-01-12",
      identity: guestOne,
      name: "Guest One A",
      email: guestOne.email,
      phone: "+919810000001"
    });

    guestOneBookingB = await createPhase8aBooking({
      arrivalDate: "2035-01-13",
      departureDate: "2035-01-15",
      identity: guestOne,
      name: "Guest One B",
      email: guestOne.email,
      phone: "+919810000001"
    });

    guestTwoBooking = await createPhase8aBooking({
      arrivalDate: "2035-01-16",
      departureDate: "2035-01-18",
      identity: guestTwo,
      name: "Guest Two",
      email: guestTwo.email,
      phone: "+919810000002"
    });

    anonymousEmailBooking = await createPhase8aBooking({
      arrivalDate: "2035-01-19",
      departureDate: "2035-01-21",
      identity: null,
      name: "Matching Email Anonymous Guest",
      email: emailMatchGuest.email,
      phone: null
    });

    anonymousPhoneBooking = await createPhase8aBooking({
      arrivalDate: "2035-01-22",
      departureDate: "2035-01-24",
      identity: null,
      name: "Phone Snapshot Anonymous Guest",
      email: null,
      phone: "+919810000099"
    });
  });

  it("[8A-01] authenticated checkout creates exactly one immutable guest ownership link", async () => {
    const userId = await phase8aUserId(guestOne);

    const links = await db
      .selectFrom("guest_reservation_links")
      .selectAll()
      .where("reservation_id", "=", guestOneBookingA.reservationId)
      .execute();

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      reservation_id: guestOneBookingA.reservationId,
      user_id: userId,
      link_source: "AUTHENTICATED_CHECKOUT"
    });
  });

  it("[8A-02] anonymous checkout remains supported and creates no ownership link", async () => {
    const link = await db
      .selectFrom("guest_reservation_links")
      .selectAll()
      .where("reservation_id", "=", anonymousEmailBooking.reservationId)
      .executeTakeFirst();

    expect(link).toBeUndefined();

    const reservation = await db
      .selectFrom("reservations")
      .select(["id", "source", "created_by_user_id"])
      .where("id", "=", anonymousEmailBooking.reservationId)
      .executeTakeFirstOrThrow();

    expect(reservation).toEqual({
      id: anonymousEmailBooking.reservationId,
      source: "public-api",
      created_by_user_id: null
    });
  });

  it("[8A-03] invalid supplied bearer token returns 401 without checkout side effects", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2035-02-01", "2035-02-03");

    const response = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        authorization: "Bearer phase8a-invalid-token",
        "idempotency-key": `phase8a-invalid-auth-${randomUUID()}`
      },
      payload: {
        leadGuest: {
          name: "Invalid Auth Guest",
          email: "invalid.auth@example.invalid",
          phone: null
        }
      }
    });

    expect(response.statusCode).toBe(401);

    const reservationCount = await db
      .selectFrom("reservations")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("quote_id", "=", quote.id)
      .executeTakeFirstOrThrow();

    expect(Number(reservationCount.count)).toBe(0);
  });

  it("[8A-04] role-less authenticated user can complete public checkout", async () => {
    const userId = await phase8aUserId(guestOne);

    const [platformRoles, memberships] = await Promise.all([
      db
        .selectFrom("platform_staff_roles")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("organization_memberships")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow()
    ]);

    expect(Number(platformRoles.count)).toBe(0);
    expect(Number(memberships.count)).toBe(0);

    const reservation = await db
      .selectFrom("reservations")
      .select(["id", "status"])
      .where("id", "=", guestOneBookingA.reservationId)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("PAYMENT_PENDING");
  });

  it("[8A-05] idempotent authenticated checkout never duplicates or transfers ownership", async () => {
    const { quote } = await createPublicQuoteAndHold(fixture, "2035-02-04", "2035-02-06");

    const key = `phase8a-replay-${randomUUID()}`;
    const payload = {
      leadGuest: {
        name: "Replay Guest",
        email: guestOne.email,
        phone: "+919810000003"
      }
    };

    const first = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        authorization: `Bearer ${guestOne.token}`,
        "idempotency-key": key
      },
      payload
    });

    expect(first.statusCode).toBe(201);

    const firstBody = first.json() as Phase8aCheckoutBody;

    const replay = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        authorization: `Bearer ${guestOne.token}`,
        "idempotency-key": key
      },
      payload
    });

    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect((replay.json() as Phase8aCheckoutBody).reservation.id).toBe(firstBody.reservation.id);

    const transferAttempt = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/quotes/${quote.id}/checkout`,
      headers: {
        authorization: `Bearer ${guestTwo.token}`,
        "idempotency-key": key
      },
      payload
    });

    expect(transferAttempt.statusCode).toBe(409);

    const userId = await phase8aUserId(guestOne);

    const links = await db
      .selectFrom("guest_reservation_links")
      .select(["reservation_id", "user_id"])
      .where("reservation_id", "=", firstBody.reservation.id)
      .execute();

    expect(links).toEqual([
      {
        reservation_id: firstBody.reservation.id,
        user_id: userId
      }
    ]);
  });

  it("[8A-06] guest reservation list is ownership scoped with stable cursor pagination", async () => {
    const full = await app.inject({
      method: "GET",
      url: "/v1/guest/reservations?limit=100",
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(full.statusCode).toBe(200);
    expect(full.headers["cache-control"]).toBe("no-store, private");

    const fullBody = full.json() as {
      reservations: Array<{ id: string }>;
      nextCursor: string | null;
    };

    const ownedIds = fullBody.reservations.map((item) => item.id);

    expect(ownedIds).toContain(guestOneBookingA.reservationId);
    expect(ownedIds).toContain(guestOneBookingB.reservationId);
    expect(ownedIds).not.toContain(guestTwoBooking.reservationId);
    expect(ownedIds).not.toContain(anonymousEmailBooking.reservationId);
    expect(ownedIds).not.toContain(anonymousPhoneBooking.reservationId);

    const guestOneUserId = await phase8aUserId(guestOne);

    const returnedLinks = await db
      .selectFrom("guest_reservation_links")
      .select(["reservation_id", "user_id"])
      .where("reservation_id", "in", ownedIds)
      .execute();

    expect(returnedLinks).toHaveLength(ownedIds.length);
    expect(returnedLinks.every((link) => link.user_id === guestOneUserId)).toBe(true);

    const first = await app.inject({
      method: "GET",
      url: "/v1/guest/reservations?limit=1",
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(first.statusCode).toBe(200);

    const firstBody = first.json() as {
      reservations: Array<{ id: string }>;
      nextCursor: string | null;
    };

    expect(firstBody.reservations).toHaveLength(1);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(ownedIds).toContain(firstBody.reservations[0]?.id);

    const second = await app.inject({
      method: "GET",
      url: `/v1/guest/reservations?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(second.statusCode).toBe(200);

    const secondBody = second.json() as {
      reservations: Array<{ id: string }>;
      nextCursor: string | null;
    };

    expect(secondBody.reservations).toHaveLength(1);
    expect(ownedIds).toContain(secondBody.reservations[0]?.id);
    expect(secondBody.reservations[0]?.id).not.toBe(firstBody.reservations[0]?.id);
  });
  it("[8A-07] guest reservation detail returns a reservation linked to the current user", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/guest/reservations/${guestOneBookingA.reservationId}`,
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, private");

    expect(response.json()).toMatchObject({
      id: guestOneBookingA.reservationId,
      reservationReference: guestOneBookingA.reservationReference
    });
  });

  it("[8A-08] second authenticated guest receives 404 for another guest reservation", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/guest/reservations/${guestOneBookingA.reservationId}`,
      headers: {
        authorization: `Bearer ${guestTwo.token}`
      }
    });

    expect(response.statusCode).toBe(404);
  });

  it("[8A-09] matching lead-guest email without ownership link grants no access", async () => {
    const detail = await app.inject({
      method: "GET",
      url: `/v1/guest/reservations/${anonymousEmailBooking.reservationId}`,
      headers: {
        authorization: `Bearer ${emailMatchGuest.token}`
      }
    });

    expect(detail.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: "/v1/guest/reservations",
      headers: {
        authorization: `Bearer ${emailMatchGuest.token}`
      }
    });

    expect(list.statusCode).toBe(200);

    const body = list.json() as {
      reservations: Array<{ id: string }>;
    };

    expect(body.reservations.map((item) => item.id)).not.toContain(
      anonymousEmailBooking.reservationId
    );
  });

  it("[8A-10] lead-guest phone snapshot without ownership link grants no access", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/guest/reservations/${anonymousPhoneBooking.reservationId}`,
      headers: {
        authorization: `Bearer ${phoneOnlyGuest.token}`
      }
    });

    expect(response.statusCode).toBe(404);
  });

  it("[8A-11] direct ownership-link update is rejected by database immutability", async () => {
    const guestTwoUserId = await phase8aUserId(guestTwo);

    await expect(
      db
        .updateTable("guest_reservation_links")
        .set({
          user_id: guestTwoUserId
        })
        .where("reservation_id", "=", guestOneBookingA.reservationId)
        .execute()
    ).rejects.toThrow(/immutable/i);

    const owner = await db
      .selectFrom("guest_reservation_links")
      .select("user_id")
      .where("reservation_id", "=", guestOneBookingA.reservationId)
      .executeTakeFirstOrThrow();

    expect(owner.user_id).toBe(await phase8aUserId(guestOne));
  });

  it("[8A-12] direct ownership-link delete is rejected by database immutability", async () => {
    await expect(
      db
        .deleteFrom("guest_reservation_links")
        .where("reservation_id", "=", guestOneBookingA.reservationId)
        .execute()
    ).rejects.toThrow(/immutable/i);

    const existing = await db
      .selectFrom("guest_reservation_links")
      .select("reservation_id")
      .where("reservation_id", "=", guestOneBookingA.reservationId)
      .executeTakeFirst();

    expect(existing?.reservation_id).toBe(guestOneBookingA.reservationId);
  });

  it("[8A-13] one reservation cannot be linked to two different users", async () => {
    const guestTwoUserId = await phase8aUserId(guestTwo);

    await expect(
      db
        .insertInto("guest_reservation_links")
        .values({
          reservation_id: guestOneBookingA.reservationId,
          user_id: guestTwoUserId,
          link_source: "AUTHENTICATED_CHECKOUT"
        })
        .execute()
    ).rejects.toThrow();

    const links = await db
      .selectFrom("guest_reservation_links")
      .select(["reservation_id", "user_id"])
      .where("reservation_id", "=", guestOneBookingA.reservationId)
      .execute();

    expect(links).toHaveLength(1);
    expect(links[0]?.user_id).toBe(await phase8aUserId(guestOne));
  });

  it("[8A-14] GUEST_RESERVATION_LINKED audit action is written exactly once", async () => {
    const userId = await phase8aUserId(guestOne);

    const audits = await db
      .selectFrom("audit_events")
      .select(["action", "actor_type", "actor_user_id", "actor_role", "entity_type", "entity_id"])
      .where("action", "=", "GUEST_RESERVATION_LINKED")
      .where("entity_id", "=", guestOneBookingA.reservationId)
      .execute();

    expect(audits).toHaveLength(1);

    expect(audits[0]).toEqual({
      action: "GUEST_RESERVATION_LINKED",
      actor_type: "USER",
      actor_user_id: userId,
      actor_role: null,
      entity_type: "GUEST_RESERVATION_LINK",
      entity_id: guestOneBookingA.reservationId
    });
  });

  it("[8A-15] guest routes require authentication but no permission or role", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/v1/guest/reservations"
    });

    expect(unauthenticated.statusCode).toBe(401);

    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/guest/reservations",
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(authenticated.statusCode).toBe(200);

    const userId = await phase8aUserId(guestOne);

    const roleCount = await db
      .selectFrom("platform_staff_roles")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("user_id", "=", userId)
      .executeTakeFirstOrThrow();

    expect(Number(roleCount.count)).toBe(0);
  });

  it("[8A-16] existing session endpoint works for a user with zero roles and memberships", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: {
        authorization: `Bearer ${guestOne.token}`
      }
    });

    expect(response.statusCode).toBe(200);

    expect(response.json()).toMatchObject({
      user: {
        email: guestOne.email
      },
      platformRoles: [],
      organizations: [],
      propertyGrants: []
    });
  });

  it("[8A-17] existing anonymous marketplace routes remain anonymous", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/destinations"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("public");
  });

  it("[8A-18] OpenAPI exposes both authenticated guest reservation read endpoints", async () => {
    const document = app.swagger() as {
      paths?: Record<
        string,
        {
          get?: {
            security?: Array<Record<string, unknown>>;
          };
        }
      >;
    };

    const listRoute = document.paths?.["/v1/guest/reservations"]?.get;
    const detailRoute = document.paths?.["/v1/guest/reservations/{reservationId}"]?.get;

    expect(listRoute).toBeDefined();
    expect(detailRoute).toBeDefined();

    expect(listRoute?.security).toEqual([
      {
        bearerAuth: []
      }
    ]);

    expect(detailRoute?.security).toEqual([
      {
        bearerAuth: []
      }
    ]);
  });
});
