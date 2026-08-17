import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
import { HeldReservationService } from "../src/modules/reservations/application/held-reservation-service.js";
import { BeginPaymentService } from "../src/modules/reservations/application/begin-payment-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { QuoteService } from "../src/modules/quotes/application/quote-service.js";
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
  rateProductId: string;
  roomCategoryId: string;
}

async function createFixture(): Promise<Fixture> {
  const subject = `phase4b3b-${randomUUID()}`;
  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: "Phase 4B3b Owner",
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
        legalName: `Promotion Quote Org ${randomUUID()}`,
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
        name: `Promotion Quote Property ${randomUUID()}`,
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

  const setup = new PropertySetupService();
  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: "DELUXE",
        name: "Deluxe Room",
        accommodationType: "ROOM",
        description: null,
        baseOccupancy: 2,
        maxAdults: 3,
        maxChildren: 2,
        maxOccupancy: 4,
        sizeSqm: 28,
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
          propertyId: property.property.id,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `PQ-${index}`,
          displayName: `Promotion Quote Room ${index}`,
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

  const ratePlan = await db.transaction().execute((trx) =>
    new RateService().createRatePlan(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: "EP-PROMO",
        name: "Promotion Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const rateProduct = await db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      actor,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        ratePlanId: ratePlan.ratePlan.id,
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

  return {
    actor,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    ratePlanId: ratePlan.ratePlan.id,
    rateProductId: rateProduct.rateProduct.id,
    roomCategoryId: category.roomCategory.id
  };
}

async function configureCommercialCore(
  fixture: Fixture,
  taxMode: "NO_TAX" | "POLICIES" = "NO_TAX"
) {
  const service = new CommercialRuleService();
  const effectiveFrom = "2034-01-01";

  await db.transaction().execute((trx) =>
    service.setPropertyCommercialSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom,
        taxMode,
        feeMode: "NO_FEES",
        expectedVersion: 0
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.setGuestAgePolicy(
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
    service.createCancellationPolicy(
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
    service.createCancellationPolicyVersion(
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
    service.createCancellationAssignment(
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
}

async function setPromotionMode(fixture: Fixture, promotionMode: "NO_PROMOTIONS" | "POLICIES") {
  await db.transaction().execute((trx) =>
    new PromotionRuleService().setSettings(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        effectiveFrom: "2000-01-01",
        promotionMode,
        expectedVersion: 0
      },
      metadata()
    )
  );
}

async function createFinalQuote(
  fixture: Fixture,
  options: {
    actor?: ActorContext;
    rateProductId?: string;
    ttlSeconds?: number;
    units?: { adults: number; childAges: number[] }[];
  } = {}
) {
  return db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      options.actor ?? fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        rateProductId: options.rateProductId ?? fixture.rateProductId,
        arrivalDate: "2034-02-10",
        departureDate: "2034-02-12",
        ttlSeconds: options.ttlSeconds ?? 900,
        promotionCode: null,
        units: options.units ?? [{ adults: 2, childAges: [] }]
      },
      metadata()
    )
  );
}

async function createQuoteHold(
  fixture: Fixture,
  quoteId: string,
  actor: ActorContext = fixture.actor,
  service = new QuoteHoldService()
) {
  return db.transaction().execute((trx) =>
    service.createFromQuote(
      trx,
      actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId
      },
      metadata()
    )
  );
}

async function createHeldReservation(
  fixture: Fixture,
  quoteId: string,
  options: {
    actor?: ActorContext;
    name?: string;
    email?: string | null;
    phone?: string | null;
  } = {}
) {
  return db.transaction().execute((trx) =>
    new HeldReservationService().createFromQuoteHold(
      trx,
      options.actor ?? fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId,
        leadGuest: {
          name: options.name ?? "Vishal Test Guest",
          email: options.email === undefined ? "guest@example.invalid" : options.email,
          phone: options.phone === undefined ? "+919876543210" : options.phone
        }
      },
      metadata()
    )
  );
}

async function beginPayment(
  fixture: Fixture,
  reservationId: string,
  actor: ActorContext = fixture.actor,
  service = new BeginPaymentService()
) {
  return db.transaction().execute((trx) =>
    service.beginPayment(
      trx,
      actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        reservationId
      },
      metadata()
    )
  );
}

describe("Phase 5A provider-neutral payment intent", () => {
  it("moves a HELD reservation to PAYMENT_PENDING with one immutable payment intent", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    const result = await beginPayment(fixture, held.reservation.id);

    expect(result.created).toBe(true);
    expect(result.reservation.status).toBe("PAYMENT_PENDING");
    expect(result.paymentIntent).toMatchObject({
      reservationId: held.reservation.id,
      purpose: "RESERVATION_TOTAL",
      amountMinor: held.reservation.totalMinor,
      currencyCode: held.reservation.currencyCode,
      status: "PENDING"
    });
    expect(result.paymentIntent.paymentReference).toMatch(/^PI-[A-F0-9]{16}$/);
    expect(new Date(result.paymentIntent.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(held.reservation.holdExpiresAt).getTime()
    );

    const hold = await db
      .selectFrom("inventory_holds")
      .select("status")
      .where("id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirstOrThrow();
    expect(hold.status).toBe("ACTIVE");

    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("id")
      .where("hold_id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirst();
    expect(allocation).toBeUndefined();

    const history = await db
      .selectFrom("reservation_status_history")
      .select(["sequence_number", "from_status", "to_status", "reason"])
      .where("reservation_id", "=", held.reservation.id)
      .orderBy("sequence_number")
      .execute();
    expect(history).toEqual([
      {
        sequence_number: 1,
        from_status: null,
        to_status: "HELD",
        reason: "QUOTE_HOLD_ACCEPTED"
      },
      {
        sequence_number: 2,
        from_status: "HELD",
        to_status: "PAYMENT_PENDING",
        reason: "PAYMENT_INTENT_CREATED"
      }
    ]);

    const event = await db
      .selectFrom("payment_events")
      .select("event_type")
      .where("payment_intent_id", "=", result.paymentIntent.id)
      .executeTakeFirstOrThrow();
    expect(event.event_type).toBe("PAYMENT_INTENT_CREATED");

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "payment_intent")
      .where("entity_id", "=", result.paymentIntent.id)
      .executeTakeFirstOrThrow();
    expect(audit.action).toBe("payment.intent.created");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "payment_intent")
      .where("aggregate_id", "=", result.paymentIntent.id)
      .executeTakeFirstOrThrow();
    expect(outbox.event_type).toBe("payment.intent.created.v1");
  });

  it("returns the same pending intent on a repeated begin-payment command", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    const first = await beginPayment(fixture, held.reservation.id);
    const second = await beginPayment(fixture, held.reservation.id);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.paymentIntent.id).toBe(first.paymentIntent.id);
    expect(second.reservation.status).toBe("PAYMENT_PENDING");

    const intents = await db
      .selectFrom("payment_intents")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .execute();
    expect(intents).toHaveLength(1);

    const pendingHistory = await db
      .selectFrom("reservation_status_history")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .where("to_status", "=", "PAYMENT_PENDING")
      .execute();
    expect(pendingHistory).toHaveLength(1);
  });

  it("lets FRONT_DESK begin payment without finance or inventory-manage permission", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    const frontDeskActor: ActorContext = {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "FRONT_DESK"
        }
      ]
    };

    const result = await beginPayment(fixture, held.reservation.id, frontDeskActor);
    expect(result.reservation.status).toBe("PAYMENT_PENDING");
    expect(result.paymentIntent.status).toBe("PENDING");
  });

  it("refuses to begin payment after the reservation hold is released", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    await db
      .transaction()
      .execute((trx) =>
        new InventoryHoldService().releaseHold(
          trx,
          fixture.actor,
          fixture.organizationId,
          fixture.propertyId,
          quoteHold.quoteHold.inventoryHoldId,
          "TEST_RELEASE_BEFORE_PAYMENT",
          metadata()
        )
      );

    await expect(beginPayment(fixture, held.reservation.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const stored = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", held.reservation.id)
      .executeTakeFirstOrThrow();
    expect(stored.status).toBe("HELD");

    const intents = await db
      .selectFrom("payment_intents")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .execute();
    expect(intents).toHaveLength(0);
  });

  it("refuses a new payment with less than one safe minute left on the hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    const future = new Date(new Date(held.reservation.holdExpiresAt).getTime() - 30_000);
    const service = new BeginPaymentService(() => future);

    await expect(
      beginPayment(fixture, held.reservation.id, fixture.actor, service)
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("rejects begin-payment from an invalid reservation state", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);

    await db
      .updateTable("reservations")
      .set({ status: "CANCELLED" })
      .where("id", "=", held.reservation.id)
      .execute();

    await expect(beginPayment(fixture, held.reservation.id)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("protects payment monetary identity and event history from mutation", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const result = await beginPayment(fixture, held.reservation.id);

    await expect(
      db
        .updateTable("payment_intents")
        .set({ amount_minor: result.paymentIntent.amountMinor + 1 })
        .where("id", "=", result.paymentIntent.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .deleteFrom("payment_events")
        .where("payment_intent_id", "=", result.paymentIntent.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("lets a reservation viewer read the payment intent without mutation permission", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const result = await beginPayment(fixture, held.reservation.id);

    const viewerActor: ActorContext = {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "VIEWER"
        }
      ]
    };

    const read = await db.transaction().execute((trx) =>
      new BeginPaymentService().getPaymentIntent(trx, viewerActor, {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        reservationId: held.reservation.id,
        paymentIntentId: result.paymentIntent.id
      })
    );

    expect(read.paymentIntent).toEqual(result.paymentIntent);
  });
});
