import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import type { RazorpayOrderGateway } from "../src/modules/payments/application/razorpay-order-service.js";
import type { RazorpayPaymentRecoveryGateway } from "../src/modules/payments/application/razorpay-payment-recovery-service.js";
import type {
  RazorpayCreateOrderInput,
  RazorpayOrder,
  RazorpayPayment
} from "../src/modules/payments/infrastructure/razorpay-provider.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { registerPublicCatalogRoutes } from "../src/modules/public-booking/transport/public-catalog-routes.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import { registerErrorHandler } from "../src/shared/http/error-handler.js";

const config = loadConfig();
const db = createDatabase(config);

interface RoomMixFixture {
  actor: ActorContext;
  organizationId: string;
  propertyId: string;
  publicSlug: string;
  ratePlanId: string;
  deluxeCategoryId: string;
  deluxeRateProductId: string;
  superCategoryId: string;
  superRateProductId: string;
}

class FakeRazorpayGateway implements RazorpayOrderGateway, RazorpayPaymentRecoveryGateway {
  private readonly orders = new Map<string, RazorpayOrder>();
  private readonly payments = new Map<string, RazorpayPayment[]>();
  createCalls = 0;

  publicKeyId(): string {
    return "rzp_test_room_mix_public";
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

  async findPaymentsByOrder(providerOrderId: string): Promise<RazorpayPayment[]> {
    return this.payments.get(providerOrderId) ?? [];
  }

  capturePayment(providerOrderId: string): void {
    const order = [...this.orders.values()].find((candidate) => candidate.id === providerOrderId);
    if (!order) throw new Error("Fake room-mix Razorpay order was not found");

    this.payments.set(providerOrderId, [
      {
        id: `pay_${randomUUID().replaceAll("-", "")}`,
        orderId: providerOrderId,
        amount: order.amount,
        currency: order.currency,
        status: "captured",
        captured: true,
        createdAt: Math.floor(Date.now() / 1000)
      }
    ]);
  }
}

function metadata(source = "room-mix-integration") {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source,
    ipAddress: null,
    userAgent: null
  };
}

async function createRoomCategory(input: {
  fixtureBase: {
    actor: ActorContext;
    organizationId: string;
    propertyId: string;
  };
  code: string;
  name: string;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  sortOrder: number;
}): Promise<string> {
  const setup = new PropertySetupService();
  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      input.fixtureBase.actor,
      {
        organizationId: input.fixtureBase.organizationId,
        propertyId: input.fixtureBase.propertyId,
        code: input.code,
        name: input.name,
        accommodationType: "ROOM",
        description: `${input.name} room-mix integration category`,
        baseOccupancy: 2,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        maxOccupancy: input.maxOccupancy,
        sizeSqm: input.sortOrder === 1 ? 24 : 32,
        bedConfiguration: "1 King Bed",
        extraBedAllowed: input.maxOccupancy > 2,
        defaultViewLabel: "Valley View",
        sortOrder: input.sortOrder
      },
      metadata()
    )
  );

  for (let index = 1; index <= 2; index += 1) {
    await db.transaction().execute((trx) =>
      setup.createPhysicalUnit(
        trx,
        input.fixtureBase.actor,
        {
          organizationId: input.fixtureBase.organizationId,
          propertyId: input.fixtureBase.propertyId,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `${input.code}-${index}-${randomUUID().slice(0, 6)}`,
          displayName: `${input.name} ${index}`,
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

  return category.roomCategory.id;
}

async function configureCommercial(fixture: RoomMixFixture): Promise<void> {
  const commercial = new CommercialRuleService();
  const effectiveFrom = "2035-01-01";

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
        infantMaxAge: 5,
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
        code: "MIX-FLEX",
        name: "Mixed Room Flexible",
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
        policyText: "Room-mix integration cancellation snapshot.",
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

async function createFixture(): Promise<RoomMixFixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: `room-mix-${suffix}`,
      email: `room-mix-${suffix}@example.invalid`,
      display_name: "Room Mix Owner",
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
        legalName: `Room Mix Organization ${suffix}`,
        tradingName: "Wildleaf Room Mix",
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
        name: `Room Mix Property ${suffix}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  const propertyId = property.property.id;
  const publicSlug = `room-mix-${suffix}`;
  await db
    .updateTable("properties")
    .set({
      property_type: "HOTEL",
      sale_mode: "ROOMS_ONLY",
      locality: "Chail",
      city: "Chail",
      state_region: "Himachal Pradesh",
      country_code: "IN"
    })
    .where("id", "=", propertyId)
    .execute();

  const fixtureBase = {
    actor,
    organizationId: organization.organizationId,
    propertyId
  };

  const deluxeCategoryId = await createRoomCategory({
    fixtureBase,
    code: `DLX-${suffix.slice(0, 4)}`,
    name: "Deluxe Room",
    maxAdults: 2,
    maxChildren: 0,
    maxOccupancy: 2,
    sortOrder: 1
  });
  const superCategoryId = await createRoomCategory({
    fixtureBase,
    code: `SDLX-${suffix.slice(0, 4)}`,
    name: "Super Deluxe",
    maxAdults: 2,
    maxChildren: 2,
    maxOccupancy: 3,
    sortOrder: 2
  });

  const rates = new RateService();
  const plan = await db.transaction().execute((trx) =>
    rates.createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        code: `MIX-EP-${suffix.slice(0, 4)}`,
        name: "Room Mix Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const deluxeProduct = await db.transaction().execute((trx) =>
    rates.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        ratePlanId: plan.ratePlan.id,
        productType: "ROOM_CATEGORY",
        roomCategoryId: deluxeCategoryId,
        baseRateMinor: 400_000,
        floorRateMinor: 300_000,
        ceilingRateMinor: 700_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 2,
        maxChildren: 0,
        maxOccupancy: 2,
        extraAdultMinor: 0,
        extraChildMinor: 0,
        expectedVersion: null
      },
      metadata()
    )
  );

  const superProduct = await db.transaction().execute((trx) =>
    rates.configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId,
        ratePlanId: plan.ratePlan.id,
        productType: "ROOM_CATEGORY",
        roomCategoryId: superCategoryId,
        baseRateMinor: 550_000,
        floorRateMinor: 400_000,
        ceilingRateMinor: 900_000,
        includedAdults: 2,
        includedChildren: 0,
        maxAdults: 2,
        maxChildren: 2,
        maxOccupancy: 3,
        extraAdultMinor: 0,
        extraChildMinor: 50_000,
        expectedVersion: null
      },
      metadata()
    )
  );

  const fixture: RoomMixFixture = {
    actor,
    organizationId: organization.organizationId,
    propertyId,
    publicSlug,
    ratePlanId: plan.ratePlan.id,
    deluxeCategoryId,
    deluxeRateProductId: deluxeProduct.rateProduct.id,
    superCategoryId,
    superRateProductId: superProduct.rateProduct.id
  };

  await configureCommercial(fixture);

  await db
    .updateTable("properties")
    .set({
      status: "LIVE",
      public_slug: publicSlug,
      live_at: new Date()
    })
    .where("id", "=", propertyId)
    .execute();

  return fixture;
}

let app: FastifyInstance;
let fixture: RoomMixFixture;
let razorpay: FakeRazorpayGateway;

beforeAll(async () => {
  fixture = await createFixture();
  razorpay = new FakeRazorpayGateway();

  app = Fastify({ logger: false });
  app.decorateRequest("actor", null);
  app.decorateRequest("correlationId", "");
  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = request.id;
    void reply.header("x-request-id", request.id);
    void reply.header("x-correlation-id", request.correlationId);
  });

  registerErrorHandler(app);
  await registerPublicCatalogRoutes(app, {
    db,
    razorpayOrderGateway: razorpay,
    razorpayPaymentRecoveryGateway: razorpay
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Atomic public room-mix checkout", () => {
  it("quotes, holds, pays and confirms two room categories as one booking", async () => {
    const arrivalDate = "2036-03-10";
    const departureDate = "2036-03-11";

    const quoteResponse = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/room-mixes/quotes`,
      headers: { "idempotency-key": `room-mix-quote-${randomUUID()}` },
      payload: {
        arrivalDate,
        departureDate,
        items: [
          {
            rateProductId: fixture.deluxeRateProductId,
            units: [{ adults: 2, childAges: [] }]
          },
          {
            rateProductId: fixture.superRateProductId,
            units: [{ adults: 1, childAges: [8, 10] }]
          }
        ]
      }
    });

    expect(quoteResponse.statusCode).toBe(201);
    const roomMixQuote = (
      quoteResponse.json() as {
        roomMixQuote: {
          id: string;
          totalMinor: number;
          currencyCode: string;
          quantity: number;
          checkoutSupported: boolean;
          items: Array<{ roomCategoryId: string; quantity: number; totalMinor: number }>;
        };
      }
    ).roomMixQuote;

    expect(roomMixQuote).toMatchObject({
      quantity: 2,
      currencyCode: "INR",
      totalMinor: 1_050_000,
      checkoutSupported: true
    });
    expect(roomMixQuote.items.map((item) => item.roomCategoryId).sort()).toEqual(
      [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
    );

    const holdResponse = await app.inject({
      method: "POST",
      url:
        `/v1/public/properties/${fixture.publicSlug}/room-mixes/` +
        `${roomMixQuote.id}/hold`,
      headers: { "idempotency-key": `room-mix-hold-${randomUUID()}` }
    });

    expect(holdResponse.statusCode).toBe(201);
    const hold = (
      holdResponse.json() as {
        hold: {
          id: string;
          items: Array<{ roomCategoryId: string; quantity: number }>;
        };
      }
    ).hold;
    expect(hold.items).toHaveLength(2);
    expect(hold.items.map((item) => item.roomCategoryId).sort()).toEqual(
      [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
    );

    const checkoutKey = `room-mix-checkout-${randomUUID()}`;
    const checkoutResponse = await app.inject({
      method: "POST",
      url:
        `/v1/public/properties/${fixture.publicSlug}/room-mixes/` +
        `${roomMixQuote.id}/checkout`,
      headers: { "idempotency-key": checkoutKey },
      payload: {
        leadGuest: {
          name: "Vishal Room Mix Guest",
          email: "room.mix.guest@example.com",
          phone: null
        }
      }
    });

    expect(checkoutResponse.statusCode).toBe(201);
    const checkout = checkoutResponse.json() as {
      reservation: {
        id: string;
        quoteId: string | null;
        roomMixQuoteId: string | null;
        productType: string;
        quantity: number;
        totalMinor: number;
        status: string;
      };
      paymentIntent: {
        id: string;
        amountMinor: number;
        status: string;
      };
      checkout: {
        orderId: string;
        amountMinor: number;
      };
    };

    expect(checkout.reservation).toMatchObject({
      quoteId: null,
      roomMixQuoteId: roomMixQuote.id,
      productType: "ROOM_MIX",
      quantity: 2,
      totalMinor: roomMixQuote.totalMinor,
      status: "PAYMENT_PENDING"
    });
    expect(checkout.paymentIntent).toMatchObject({
      amountMinor: roomMixQuote.totalMinor,
      status: "PENDING"
    });
    expect(checkout.checkout.amountMinor).toBe(roomMixQuote.totalMinor);

    const [reservationRows, mixedFinancial, standardFinancial, paymentRows] = await Promise.all([
      db
        .selectFrom("reservations")
        .selectAll()
        .where("room_mix_quote_id", "=", roomMixQuote.id)
        .execute(),
      db
        .selectFrom("reservation_room_mix_financial_snapshots")
        .selectAll()
        .where("reservation_id", "=", checkout.reservation.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("reservation_financial_snapshots")
        .select("id")
        .where("reservation_id", "=", checkout.reservation.id)
        .executeTakeFirst(),
      db
        .selectFrom("payment_intents")
        .selectAll()
        .where("reservation_id", "=", checkout.reservation.id)
        .execute()
    ]);

    expect(reservationRows).toHaveLength(1);
    expect(mixedFinancial).toMatchObject({
      room_mix_quote_id: roomMixQuote.id,
      total_minor: roomMixQuote.totalMinor,
      quantity: 2
    });
    expect(standardFinancial).toBeUndefined();
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]?.amount_minor).toBe(roomMixQuote.totalMinor);

    const repeatedCheckout = await app.inject({
      method: "POST",
      url:
        `/v1/public/properties/${fixture.publicSlug}/room-mixes/` +
        `${roomMixQuote.id}/checkout`,
      headers: { "idempotency-key": checkoutKey },
      payload: {
        leadGuest: {
          name: "Vishal Room Mix Guest",
          email: "room.mix.guest@example.com",
          phone: null
        }
      }
    });
    expect(repeatedCheckout.statusCode).toBe(201);
    expect(
      (repeatedCheckout.json() as { reservation: { id: string } }).reservation.id
    ).toBe(checkout.reservation.id);

    razorpay.capturePayment(checkout.checkout.orderId);
    const statusResponse = await app.inject({
      method: "POST",
      url: `/v1/public/properties/${fixture.publicSlug}/checkout-status`,
      payload: {
        reservationId: checkout.reservation.id,
        paymentIntentId: checkout.paymentIntent.id
      }
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      outcome: "CONFIRMED",
      reservation: { id: checkout.reservation.id, status: "CONFIRMED" },
      paymentIntent: { id: checkout.paymentIntent.id, status: "SUCCEEDED" }
    });

    const allocation = await db
      .selectFrom("inventory_allocations")
      .selectAll()
      .where("hold_id", "=", hold.id)
      .executeTakeFirstOrThrow();
    const allocationItems = await db
      .selectFrom("inventory_allocation_items")
      .select(["room_category_id", "quantity"])
      .where("allocation_id", "=", allocation.id)
      .orderBy("room_category_id")
      .execute();

    expect(allocationItems).toHaveLength(2);
    expect(allocationItems.map((item) => item.room_category_id).sort()).toEqual(
      [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
    );
    expect(allocationItems.every((item) => item.quantity === 1)).toBe(true);
  });
});
