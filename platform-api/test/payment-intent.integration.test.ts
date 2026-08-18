import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { InventoryAllocationService } from "../src/modules/inventory/application/inventory-allocation-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
import { HeldReservationService } from "../src/modules/reservations/application/held-reservation-service.js";
import { VerifiedPaymentEvidenceService } from "../src/modules/payments/application/verified-payment-evidence-service.js";
import {
  RazorpayOrderService,
  type RazorpayOrderGateway
} from "../src/modules/payments/application/razorpay-order-service.js";
import {
  RazorpayRefundSubmissionService,
  type RazorpayRefundGateway
} from "../src/modules/payments/application/razorpay-refund-submission-service.js";
import { RazorpayWebhookService } from "../src/modules/payments/application/razorpay-webhook-service.js";
import { VerifiedPaymentProcessor } from "../src/modules/payments/application/verified-payment-processor.js";
import {
  RazorpayProvider,
  RazorpayProviderError,
  type RazorpayCreateOrderInput,
  type RazorpayCreateRefundInput,
  type RazorpayOrder,
  type RazorpayRefund
} from "../src/modules/payments/infrastructure/razorpay-provider.js";
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

describe("Phase 5B1 verified payment evidence boundary", () => {
  function evidenceInput(
    fixture: Fixture,
    payment: Awaited<ReturnType<typeof beginPayment>>,
    overrides: Partial<{
      providerEventId: string;
      providerPaymentId: string;
      amountMinor: number;
      currencyCode: string;
    }> = {}
  ) {
    return {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      reservationId: payment.reservation.id,
      paymentIntentId: payment.paymentIntent.id,
      provider: "RAZORPAY",
      providerEventId: overrides.providerEventId ?? `evt_${randomUUID()}`,
      providerPaymentId: overrides.providerPaymentId ?? `pay_${randomUUID()}`,
      providerOrderId: `order_${randomUUID()}`,
      amountMinor: overrides.amountMinor ?? payment.paymentIntent.amountMinor,
      currencyCode: overrides.currencyCode ?? payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE" as const,
      payloadSha256: "a".repeat(64)
    };
  }

  async function recordEvidence(input: ReturnType<typeof evidenceInput>) {
    return db
      .transaction()
      .execute((trx) => new VerifiedPaymentEvidenceService().record(trx, input, metadata()));
  }

  async function paymentFixture() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const payment = await beginPayment(fixture, held.reservation.id);
    return { fixture, quoteHold, held, payment };
  }

  it("records verified evidence without prematurely confirming payment, reservation or inventory", async () => {
    const { fixture, quoteHold, held, payment } = await paymentFixture();
    const result = await recordEvidence(evidenceInput(fixture, payment));
    expect(result.created).toBe(true);
    expect(result.evidence).toMatchObject({
      paymentIntentId: payment.paymentIntent.id,
      reservationId: held.reservation.id,
      provider: "RAZORPAY",
      amountMinor: payment.paymentIntent.amountMinor,
      currencyCode: payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE"
    });
    const intent = await db
      .selectFrom("payment_intents")
      .select("status")
      .where("id", "=", payment.paymentIntent.id)
      .executeTakeFirstOrThrow();
    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", held.reservation.id)
      .executeTakeFirstOrThrow();
    const hold = await db
      .selectFrom("inventory_holds")
      .select("status")
      .where("id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirstOrThrow();
    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("id")
      .where("hold_id", "=", quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirst();
    expect(intent.status).toBe("PENDING");
    expect(reservation.status).toBe("PAYMENT_PENDING");
    expect(hold.status).toBe("ACTIVE");
    expect(allocation).toBeUndefined();
    const event = await db
      .selectFrom("payment_events")
      .select("event_type")
      .where("payment_intent_id", "=", payment.paymentIntent.id)
      .where("event_type", "=", "VERIFIED_PAYMENT_EVIDENCE_RECORDED")
      .executeTakeFirstOrThrow();
    expect(event.event_type).toBe("VERIFIED_PAYMENT_EVIDENCE_RECORDED");
  });

  it("returns the same evidence on an exact retry", async () => {
    const { fixture, payment } = await paymentFixture();
    const input = evidenceInput(fixture, payment);
    const first = await recordEvidence(input);
    const second = await recordEvidence(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.evidence.id).toBe(first.evidence.id);
  });

  it("rejects reuse of the same provider event with changed evidence", async () => {
    const { fixture, payment } = await paymentFixture();
    const input = evidenceInput(fixture, payment);
    await recordEvidence(input);
    await expect(
      recordEvidence({ ...input, providerPaymentId: `pay_${randomUUID()}` })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects reuse of the same provider payment identifier for a different payment intent", async () => {
    const first = await paymentFixture();
    const shared = `pay_${randomUUID()}`;
    await recordEvidence(
      evidenceInput(first.fixture, first.payment, { providerPaymentId: shared })
    );
    const second = await paymentFixture();
    await expect(
      recordEvidence(evidenceInput(second.fixture, second.payment, { providerPaymentId: shared }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an amount mismatch", async () => {
    const { fixture, payment } = await paymentFixture();
    await expect(
      recordEvidence(
        evidenceInput(fixture, payment, { amountMinor: payment.paymentIntent.amountMinor + 1 })
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a currency mismatch", async () => {
    const { fixture, payment } = await paymentFixture();
    await expect(
      recordEvidence(evidenceInput(fixture, payment, { currencyCode: "USD" }))
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("protects verified provider evidence from mutation", async () => {
    const { fixture, payment } = await paymentFixture();
    const recorded = await recordEvidence(evidenceInput(fixture, payment));
    await expect(
      db
        .updateTable("payment_provider_evidence")
        .set({ amount_minor: payment.paymentIntent.amountMinor + 1 })
        .where("id", "=", recorded.evidence.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
    await expect(
      db.deleteFrom("payment_provider_evidence").where("id", "=", recorded.evidence.id).execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("blocks generic inventory confirmation for a canonical reservation-linked hold", async () => {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    await expect(
      db
        .transaction()
        .execute((trx) =>
          new InventoryAllocationService().confirmHold(
            trx,
            fixture.actor,
            fixture.organizationId,
            fixture.propertyId,
            quoteHold.quoteHold.inventoryHoldId,
            held.reservation.reservationReference,
            metadata()
          )
        )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("Phase 5B2 canonical verified payment processing", () => {
  function phase5b2EvidenceInput(
    fixture: Fixture,
    payment: Awaited<ReturnType<typeof beginPayment>>,
    overrides: Partial<{
      providerEventId: string;
      providerPaymentId: string;
      payloadSha256: string;
    }> = {}
  ) {
    return {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      reservationId: payment.reservation.id,
      paymentIntentId: payment.paymentIntent.id,
      provider: "RAZORPAY",
      providerEventId: overrides.providerEventId ?? `evt_${randomUUID()}`,
      providerPaymentId: overrides.providerPaymentId ?? `pay_${randomUUID()}`,
      providerOrderId: `order_${randomUUID()}`,
      amountMinor: payment.paymentIntent.amountMinor,
      currencyCode: payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE" as const,
      payloadSha256: overrides.payloadSha256 ?? "b".repeat(64)
    };
  }

  async function phase5b2ReadyPayment() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    const quoteHold = await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const payment = await beginPayment(fixture, held.reservation.id);
    const evidence = await db
      .transaction()
      .execute((trx) =>
        new VerifiedPaymentEvidenceService().record(
          trx,
          phase5b2EvidenceInput(fixture, payment),
          metadata()
        )
      );
    return { fixture, quoteHold, held, payment, evidence };
  }

  async function processPhase5b2(
    ready: Awaited<ReturnType<typeof phase5b2ReadyPayment>>,
    evidenceId = ready.evidence.evidence.id,
    service = new VerifiedPaymentProcessor()
  ) {
    return db.transaction().execute((trx) =>
      service.process(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id,
          paymentEvidenceId: evidenceId
        },
        metadata()
      )
    );
  }

  it("atomically converts verified payment into payment success, confirmed reservation and confirmed inventory", async () => {
    const ready = await phase5b2ReadyPayment();
    const result = await processPhase5b2(ready);

    expect(result).toMatchObject({
      processed: true,
      outcome: "RESERVATION_CONFIRMED",
      paymentIntentId: ready.payment.paymentIntent.id,
      reservationId: ready.held.reservation.id,
      paymentEvidenceId: ready.evidence.evidence.id
    });
    expect(result.paymentSuccessId).toBeTruthy();
    expect(result.inventoryAllocationId).toBeTruthy();
    expect(result.reconciliationCaseId).toBeNull();

    const intent = await db
      .selectFrom("payment_intents")
      .select("status")
      .where("id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();
    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();
    const hold = await db
      .selectFrom("inventory_holds")
      .select(["status", "release_reason"])
      .where("id", "=", ready.quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirstOrThrow();
    const allocation = await db
      .selectFrom("inventory_allocations")
      .select(["id", "status", "confirmed_by_user_id"])
      .where("hold_id", "=", ready.quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirstOrThrow();

    expect(intent.status).toBe("SUCCEEDED");
    expect(reservation.status).toBe("CONFIRMED");
    expect(hold.status).toBe("RELEASED");
    expect(hold.release_reason).toContain("CONVERTED_TO_CONFIRMED_ALLOCATION");
    expect(allocation.status).toBe("CONFIRMED");
    expect(allocation.confirmed_by_user_id).toBeNull();
    expect(allocation.id).toBe(result.inventoryAllocationId);

    const history = await db
      .selectFrom("reservation_status_history")
      .select(["from_status", "to_status", "reason", "actor_user_id"])
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("to_status", "=", "CONFIRMED")
      .executeTakeFirstOrThrow();
    expect(history).toEqual({
      from_status: "PAYMENT_PENDING",
      to_status: "CONFIRMED",
      reason: "VERIFIED_PAYMENT_SUCCEEDED",
      actor_user_id: null
    });

    const audit = await db
      .selectFrom("audit_events")
      .select(["action", "actor_type"])
      .where("entity_type", "=", "payment_intent")
      .where("entity_id", "=", ready.payment.paymentIntent.id)
      .where("action", "=", "payment.succeeded")
      .executeTakeFirstOrThrow();
    expect(audit).toEqual({ action: "payment.succeeded", actor_type: "PROVIDER" });

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "reservation")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "reservation.confirmed.v1")
      .executeTakeFirstOrThrow();
    expect(outbox.event_type).toBe("reservation.confirmed.v1");
  });

  it("is idempotent when the same verified evidence is processed again", async () => {
    const ready = await phase5b2ReadyPayment();
    const first = await processPhase5b2(ready);
    const second = await processPhase5b2(ready);

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(second.outcome).toBe("RESERVATION_CONFIRMED");
    expect(second.paymentSuccessId).toBe(first.paymentSuccessId);
    expect(second.inventoryAllocationId).toBe(first.inventoryAllocationId);

    const [successes, allocations, confirmedHistory, succeededEvents] = await Promise.all([
      db
        .selectFrom("payment_successes")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .execute(),
      db
        .selectFrom("inventory_allocations")
        .select("id")
        .where("hold_id", "=", ready.quoteHold.quoteHold.inventoryHoldId)
        .execute(),
      db
        .selectFrom("reservation_status_history")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .where("to_status", "=", "CONFIRMED")
        .execute(),
      db
        .selectFrom("payment_events")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "PAYMENT_SUCCEEDED")
        .execute()
    ]);
    expect(successes).toHaveLength(1);
    expect(allocations).toHaveLength(1);
    expect(confirmedHistory).toHaveLength(1);
    expect(succeededEvents).toHaveLength(1);
  });

  it("records a second distinct verified payment after confirmation and reconciles it as a duplicate payment", async () => {
    const ready = await phase5b2ReadyPayment();
    const first = await processPhase5b2(ready);

    const duplicateEvidence = await db.transaction().execute((trx) =>
      new VerifiedPaymentEvidenceService().record(
        trx,
        phase5b2EvidenceInput(ready.fixture, ready.payment, {
          providerEventId: `evt_${randomUUID()}`,
          providerPaymentId: `pay_${randomUUID()}`,
          payloadSha256: "c".repeat(64)
        }),
        metadata()
      )
    );
    expect(duplicateEvidence.created).toBe(true);

    const duplicate = await processPhase5b2(ready, duplicateEvidence.evidence.id);
    expect(duplicate.processed).toBe(true);
    expect(duplicate.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(duplicate.paymentSuccessId).toBe(first.paymentSuccessId);
    expect(duplicate.reconciliationCaseId).toBeTruthy();

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["reason_code", "required_action", "status"])
      .where("payment_evidence_id", "=", duplicateEvidence.evidence.id)
      .executeTakeFirstOrThrow();
    expect(reconciliation).toEqual({
      reason_code: "DUPLICATE_VERIFIED_PAYMENT",
      required_action: "REFUND_REQUIRED",
      status: "OPEN"
    });

    const successes = await db
      .selectFrom("payment_successes")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(successes).toHaveLength(1);
  });

  it("is idempotent when the same duplicate payment evidence is reconciled again", async () => {
    const ready = await phase5b2ReadyPayment();
    await processPhase5b2(ready);
    const duplicateEvidence = await db.transaction().execute((trx) =>
      new VerifiedPaymentEvidenceService().record(
        trx,
        phase5b2EvidenceInput(ready.fixture, ready.payment, {
          providerEventId: `evt_${randomUUID()}`,
          providerPaymentId: `pay_${randomUUID()}`,
          payloadSha256: "d".repeat(64)
        }),
        metadata()
      )
    );

    const first = await processPhase5b2(ready, duplicateEvidence.evidence.id);
    const second = await processPhase5b2(ready, duplicateEvidence.evidence.id);
    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);
    expect(second.reconciliationCaseId).toBe(first.reconciliationCaseId);

    const cases = await db
      .selectFrom("payment_reconciliation_cases")
      .select("id")
      .where("payment_evidence_id", "=", duplicateEvidence.evidence.id)
      .execute();
    expect(cases).toHaveLength(1);
  });

  it("treats a verified payment after hold expiry as real money and opens a refund-required reconciliation without overselling", async () => {
    const ready = await phase5b2ReadyPayment();
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
    const result = await processPhase5b2(
      ready,
      ready.evidence.evidence.id,
      new VerifiedPaymentProcessor(() => afterExpiry)
    );

    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(result.inventoryAllocationId).toBeNull();
    expect(result.reconciliationCaseId).toBeTruthy();

    const intent = await db
      .selectFrom("payment_intents")
      .select("status")
      .where("id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();
    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();
    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("id")
      .where("hold_id", "=", ready.quoteHold.quoteHold.inventoryHoldId)
      .executeTakeFirst();
    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["reason_code", "required_action"])
      .where("id", "=", result.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();

    expect(intent.status).toBe("SUCCEEDED");
    expect(reservation.status).toBe("PAYMENT_PENDING");
    expect(allocation).toBeUndefined();
    expect(reconciliation).toEqual({
      reason_code: "INVENTORY_HOLD_EXPIRED",
      required_action: "REFUND_REQUIRED"
    });
  });

  it("opens refund reconciliation when verified money arrives after the reservation hold was released", async () => {
    const ready = await phase5b2ReadyPayment();
    await db
      .transaction()
      .execute((trx) =>
        new InventoryHoldService().releaseHold(
          trx,
          ready.fixture.actor,
          ready.fixture.organizationId,
          ready.fixture.propertyId,
          ready.quoteHold.quoteHold.inventoryHoldId,
          "TEST_RELEASE_AFTER_VERIFIED_EVIDENCE",
          metadata()
        )
      );

    const result = await processPhase5b2(ready);
    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["reason_code", "required_action"])
      .where("id", "=", result.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();
    expect(reconciliation).toEqual({
      reason_code: "INVENTORY_HOLD_NOT_ACTIVE",
      required_action: "REFUND_REQUIRED"
    });
  });

  it("persists verified money against a non-payable reservation as manual reconciliation instead of discarding payment proof", async () => {
    const ready = await phase5b2ReadyPayment();
    await db
      .updateTable("reservations")
      .set({ status: "CANCELLED" })
      .where("id", "=", ready.held.reservation.id)
      .execute();

    const result = await processPhase5b2(ready);
    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");

    const [intent, reconciliation] = await Promise.all([
      db
        .selectFrom("payment_intents")
        .select("status")
        .where("id", "=", ready.payment.paymentIntent.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_reconciliation_cases")
        .select(["reason_code", "required_action"])
        .where("id", "=", result.reconciliationCaseId as string)
        .executeTakeFirstOrThrow()
    ]);
    expect(intent.status).toBe("SUCCEEDED");
    expect(reconciliation).toEqual({
      reason_code: "RESERVATION_STATE_MISMATCH",
      required_action: "MANUAL_REVIEW"
    });
  });

  it("keeps reservation-owned confirmed inventory protected from generic release after payment confirmation", async () => {
    const ready = await phase5b2ReadyPayment();
    const result = await processPhase5b2(ready);
    expect(result.inventoryAllocationId).toBeTruthy();

    await expect(
      db
        .transaction()
        .execute((trx) =>
          new InventoryAllocationService().releaseAllocation(
            trx,
            ready.fixture.actor,
            ready.fixture.organizationId,
            ready.fixture.propertyId,
            result.inventoryAllocationId as string,
            "GENERIC_RELEASE_MUST_NOT_BYPASS_RESERVATION",
            metadata()
          )
        )
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const allocation = await db
      .selectFrom("inventory_allocations")
      .select("status")
      .where("id", "=", result.inventoryAllocationId as string)
      .executeTakeFirstOrThrow();
    expect(allocation.status).toBe("CONFIRMED");
  });
});
class FakeRazorpayOrderGateway implements RazorpayOrderGateway {
  public readonly orders: RazorpayOrder[] = [];
  public findCalls = 0;
  public createCalls = 0;
  public duplicateOnCreate = false;

  publicKeyId(): string {
    return "rzp_test_public";
  }

  async findOrdersByReceipt(receipt: string): Promise<RazorpayOrder[]> {
    this.findCalls += 1;
    return this.orders.filter((order) => order.receipt === receipt);
  }

  async createOrder(input: RazorpayCreateOrderInput): Promise<RazorpayOrder> {
    this.createCalls += 1;
    const order: RazorpayOrder = {
      id: `order_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      amount: input.amountMinor,
      amountPaid: 0,
      amountDue: input.amountMinor,
      currency: input.currencyCode.toUpperCase(),
      receipt: input.receipt,
      status: "created",
      attempts: 0,
      createdAt: 2_023_000_000
    };
    this.orders.push(order);
    if (this.duplicateOnCreate) {
      this.duplicateOnCreate = false;
      throw new RazorpayProviderError("Duplicate request", 400);
    }
    return order;
  }
}

async function phase5b3bReadyPayment() {
  const fixture = await createFixture();
  await configureCommercialCore(fixture);
  await setPromotionMode(fixture, "NO_PROMOTIONS");
  const quoted = await createFinalQuote(fixture);
  await createQuoteHold(fixture, quoted.quote.id);
  const held = await createHeldReservation(fixture, quoted.quote.id);
  const payment = await beginPayment(fixture, held.reservation.id);
  return { fixture, held, payment };
}

function expectedRazorpayReceipt(paymentIntentId: string): string {
  return `WL-${paymentIntentId.replaceAll("-", "")}`;
}

describe("Phase 5B3B Razorpay provider-order mapping and checkout", () => {
  it("creates and durably links one Razorpay order to the immutable pending payment intent", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    const result = await new RazorpayOrderService(db, gateway).prepareCheckout(
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id
      },
      metadata()
    );

    expect(result.created).toBe(true);
    expect(result.recovered).toBe(false);
    expect(result.checkout).toMatchObject({
      keyId: "rzp_test_public",
      orderId: result.providerOrder.providerOrderId,
      paymentIntentId: ready.payment.paymentIntent.id,
      reservationId: ready.held.reservation.id,
      amountMinor: ready.payment.paymentIntent.amountMinor,
      currencyCode: ready.payment.paymentIntent.currencyCode,
      receipt: expectedRazorpayReceipt(ready.payment.paymentIntent.id)
    });
    expect(gateway.createCalls).toBe(1);

    const stored = await db
      .selectFrom("payment_provider_orders")
      .selectAll()
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();
    expect(stored.provider_order_id).toBe(result.checkout.orderId);
    expect(stored.amount_minor).toBe(ready.payment.paymentIntent.amountMinor);
    expect(stored.currency_code).toBe(ready.payment.paymentIntent.currencyCode);

    const providerEvents = await db
      .selectFrom("payment_events")
      .select("event_type")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .where("event_type", "=", "PROVIDER_ORDER_LINKED")
      .execute();
    expect(providerEvents).toHaveLength(1);

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "payment_provider_order")
      .where("entity_id", "=", result.providerOrder.id)
      .executeTakeFirstOrThrow();
    expect(audit.action).toBe("payment.provider_order.linked");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "payment_intent")
      .where("aggregate_id", "=", ready.payment.paymentIntent.id)
      .where("event_type", "=", "payment.provider_order.linked.v1")
      .executeTakeFirstOrThrow();
    expect(outbox.event_type).toBe("payment.provider_order.linked.v1");
  });

  it("returns the existing mapping on retry without creating or searching Razorpay again", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    const service = new RazorpayOrderService(db, gateway);
    const input = {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      reservationId: ready.held.reservation.id,
      paymentIntentId: ready.payment.paymentIntent.id
    };

    const first = await service.prepareCheckout(ready.fixture.actor, input, metadata());
    const callsAfterFirst = {
      create: gateway.createCalls,
      find: gateway.findCalls
    };
    const second = await service.prepareCheckout(ready.fixture.actor, input, metadata());

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.providerOrder.id).toBe(first.providerOrder.id);
    expect(second.checkout.orderId).toBe(first.checkout.orderId);
    expect(gateway.createCalls).toBe(callsAfterFirst.create);
    expect(gateway.findCalls).toBe(callsAfterFirst.find);

    const stored = await db
      .selectFrom("payment_provider_orders")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(stored).toHaveLength(1);
  });

  it("recovers a pre-existing Razorpay order by the deterministic unique receipt", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    const recoveredOrderId = `order_recovered_${randomUUID().replaceAll("-", "").slice(0, 18)}`;

    gateway.orders.push({
      id: recoveredOrderId,
      amount: ready.payment.paymentIntent.amountMinor,
      amountPaid: 0,
      amountDue: ready.payment.paymentIntent.amountMinor,
      currency: ready.payment.paymentIntent.currencyCode,
      receipt: expectedRazorpayReceipt(ready.payment.paymentIntent.id),
      status: "created",
      attempts: 0,
      createdAt: 2_023_000_001
    });

    const result = await new RazorpayOrderService(db, gateway).prepareCheckout(
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id
      },
      metadata()
    );

    expect(result.created).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.checkout.orderId).toBe(recoveredOrderId);
    expect(gateway.createCalls).toBe(0);
  });

  it("recovers safely when Razorpay reports a duplicate receipt after an ambiguous create", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    gateway.duplicateOnCreate = true;

    const result = await new RazorpayOrderService(db, gateway).prepareCheckout(
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id
      },
      metadata()
    );

    expect(result.created).toBe(true);
    expect(result.recovered).toBe(true);
    expect(gateway.createCalls).toBe(1);
    expect(gateway.findCalls).toBe(2);

    const stored = await db
      .selectFrom("payment_provider_orders")
      .select("provider_order_id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();
    expect(stored.provider_order_id).toBe(result.checkout.orderId);
  });

  it("rejects provider economics that do not match the immutable payment intent", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    gateway.orders.push({
      id: "order_wrong_amount",
      amount: ready.payment.paymentIntent.amountMinor + 1,
      amountPaid: 0,
      amountDue: ready.payment.paymentIntent.amountMinor + 1,
      currency: ready.payment.paymentIntent.currencyCode,
      receipt: expectedRazorpayReceipt(ready.payment.paymentIntent.id),
      status: "created",
      attempts: 0,
      createdAt: 2_023_000_002
    });

    await expect(
      new RazorpayOrderService(db, gateway).prepareCheckout(
        ready.fixture.actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const stored = await db
      .selectFrom("payment_provider_orders")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirst();
    expect(stored).toBeUndefined();
  });

  it("refuses to contact Razorpay when the payment intent is already expired", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);

    await expect(
      new RazorpayOrderService(db, gateway, () => afterExpiry).prepareCheckout(
        ready.fixture.actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    expect(gateway.findCalls).toBe(0);
    expect(gateway.createCalls).toBe(0);
  });

  it("keeps the provider-order identity and economics immutable after linking", async () => {
    const ready = await phase5b3bReadyPayment();
    const gateway = new FakeRazorpayOrderGateway();
    const result = await new RazorpayOrderService(db, gateway).prepareCheckout(
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id
      },
      metadata()
    );

    await expect(
      db
        .updateTable("payment_provider_orders")
        .set({ provider_order_id: "order_tampered" })
        .where("id", "=", result.providerOrder.id)
        .execute()
    ).rejects.toThrow(/immutable/);

    await expect(
      db.deleteFrom("payment_provider_orders").where("id", "=", result.providerOrder.id).execute()
    ).rejects.toThrow(/immutable/);
  });
});
const phase5b3cWebhookConfig = {
  keyId: "rzp_test_webhook_key",
  keySecret: "phase5b3c_key_secret",
  webhookSecret: "phase5b3c_webhook_secret"
};

function phase5b3cProvider() {
  return new RazorpayProvider(phase5b3cWebhookConfig, async () => {
    throw new Error("Phase 5B3C webhook verification must not call Razorpay over the network");
  });
}

async function phase5b3cReadyCheckout() {
  const ready = await phase5b3bReadyPayment();
  const gateway = new FakeRazorpayOrderGateway();
  const checkout = await new RazorpayOrderService(db, gateway).prepareCheckout(
    ready.fixture.actor,
    {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      reservationId: ready.held.reservation.id,
      paymentIntentId: ready.payment.paymentIntent.id
    },
    metadata()
  );
  return { ...ready, checkout };
}

function phase5b3cRawBody(
  ready: Awaited<ReturnType<typeof phase5b3cReadyCheckout>>,
  options: {
    eventType?: string;
    providerPaymentId?: string;
    providerOrderId?: string;
    amountMinor?: number;
    currencyCode?: string;
    status?: string;
    captured?: boolean;
  } = {}
): Buffer {
  return Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_phase5b3c",
      event: options.eventType ?? "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: options.providerPaymentId ?? `pay_${randomUUID().replaceAll("-", "").slice(0, 18)}`,
            entity: "payment",
            amount: options.amountMinor ?? ready.payment.paymentIntent.amountMinor,
            currency: options.currencyCode ?? ready.payment.paymentIntent.currencyCode,
            status: options.status ?? "captured",
            order_id: options.providerOrderId ?? ready.checkout.checkout.orderId,
            captured: options.captured ?? true
          }
        }
      }
    }),
    "utf8"
  );
}

function phase5b3cSignature(rawBody: Buffer): string {
  return createHmac("sha256", phase5b3cWebhookConfig.webhookSecret).update(rawBody).digest("hex");
}

async function phase5b3cHandle(
  ready: Awaited<ReturnType<typeof phase5b3cReadyCheckout>>,
  rawBody: Buffer,
  providerEventId: string,
  processor?: VerifiedPaymentProcessor
) {
  const service = processor
    ? new RazorpayWebhookService(db, phase5b3cProvider(), { processor })
    : new RazorpayWebhookService(db, phase5b3cProvider());

  return service.handle(
    {
      rawBody,
      signature: phase5b3cSignature(rawBody),
      providerEventId
    },
    metadata()
  );
}

describe("Phase 5B3C Razorpay webhook verification and canonical processing", () => {
  it("turns a valid signed payment.captured webhook into verified evidence and a confirmed reservation", async () => {
    const ready = await phase5b3cReadyCheckout();
    const providerPaymentId = `pay_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const rawBody = phase5b3cRawBody(ready, { providerPaymentId });
    const providerEventId = `evt_${randomUUID().replaceAll("-", "")}`;

    const result = await phase5b3cHandle(ready, rawBody, providerEventId);

    expect(result.handled).toBe(true);
    expect(result.evidenceCreated).toBe(true);
    expect(result.processing).toMatchObject({
      processed: true,
      outcome: "RESERVATION_CONFIRMED",
      paymentIntentId: ready.payment.paymentIntent.id,
      reservationId: ready.held.reservation.id
    });

    const [intent, reservation, evidence, allocation] = await Promise.all([
      db
        .selectFrom("payment_intents")
        .select("status")
        .where("id", "=", ready.payment.paymentIntent.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("reservations")
        .select("status")
        .where("id", "=", ready.held.reservation.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_provider_evidence")
        .selectAll()
        .where("id", "=", result.paymentEvidenceId as string)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("inventory_allocations")
        .select("status")
        .where("id", "=", result.processing?.inventoryAllocationId as string)
        .executeTakeFirstOrThrow()
    ]);

    expect(intent.status).toBe("SUCCEEDED");
    expect(reservation.status).toBe("CONFIRMED");
    expect(allocation.status).toBe("CONFIRMED");
    expect(evidence.provider).toBe("RAZORPAY");
    expect(evidence.provider_event_id).toBe(providerEventId);
    expect(evidence.provider_payment_id).toBe(providerPaymentId);
    expect(evidence.provider_order_id).toBe(ready.checkout.checkout.orderId);
    expect(evidence.verification_method).toBe("WEBHOOK_SIGNATURE");
    expect(evidence.payload_sha256).toBe(createHash("sha256").update(rawBody).digest("hex"));
  });

  it("is idempotent when Razorpay retries the exact same signed event", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready);
    const providerEventId = `evt_${randomUUID().replaceAll("-", "")}`;

    const first = await phase5b3cHandle(ready, rawBody, providerEventId);
    const second = await phase5b3cHandle(ready, rawBody, providerEventId);

    expect(first.handled).toBe(true);
    expect(first.evidenceCreated).toBe(true);
    expect(second.handled).toBe(true);
    expect(second.evidenceCreated).toBe(false);
    expect(second.paymentEvidenceId).toBe(first.paymentEvidenceId);
    expect(second.processing?.processed).toBe(false);

    const [evidenceRows, successRows] = await Promise.all([
      db
        .selectFrom("payment_provider_evidence")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .execute(),
      db
        .selectFrom("payment_successes")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .execute()
    ]);
    expect(evidenceRows).toHaveLength(1);
    expect(successRows).toHaveLength(1);
  });

  it("acknowledges a valid signed non-captured event without changing booking state", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready, {
      eventType: "payment.authorized",
      status: "authorized",
      captured: false
    });

    const result = await phase5b3cHandle(ready, rawBody, `evt_${randomUUID().replaceAll("-", "")}`);

    expect(result).toMatchObject({
      received: true,
      handled: false,
      eventType: "payment.authorized",
      paymentEvidenceId: null,
      evidenceCreated: false,
      processing: null
    });

    const [evidenceRows, reservation] = await Promise.all([
      db
        .selectFrom("payment_provider_evidence")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .execute(),
      db
        .selectFrom("reservations")
        .select("status")
        .where("id", "=", ready.held.reservation.id)
        .executeTakeFirstOrThrow()
    ]);
    expect(evidenceRows).toHaveLength(0);
    expect(reservation.status).toBe("PAYMENT_PENDING");
  });

  it("rejects an invalid webhook signature before creating provider evidence", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready);
    const service = new RazorpayWebhookService(db, phase5b3cProvider());

    await expect(
      service.handle(
        {
          rawBody,
          signature: "0".repeat(64),
          providerEventId: `evt_${randomUUID().replaceAll("-", "")}`
        },
        metadata()
      )
    ).rejects.toMatchObject({
      code: "INVALID_WEBHOOK_SIGNATURE",
      statusCode: 401
    });

    const evidenceRows = await db
      .selectFrom("payment_provider_evidence")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(evidenceRows).toHaveLength(0);
  });

  it("rejects a signed captured payment whose amount differs from the server-owned order", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready, {
      amountMinor: ready.payment.paymentIntent.amountMinor + 1
    });

    await expect(
      phase5b3cHandle(ready, rawBody, `evt_${randomUUID().replaceAll("-", "")}`)
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const evidenceRows = await db
      .selectFrom("payment_provider_evidence")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(evidenceRows).toHaveLength(0);
  });

  it("rejects a signed captured payment for an unknown Razorpay order", async () => {
    const ready = await phase5b3cReadyCheckout();
    const unknownOrderId = `order_unknown_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
    const rawBody = phase5b3cRawBody(ready, { providerOrderId: unknownOrderId });

    await expect(
      phase5b3cHandle(ready, rawBody, `evt_${randomUUID().replaceAll("-", "")}`)
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

    const evidenceRows = await db
      .selectFrom("payment_provider_evidence")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(evidenceRows).toHaveLength(0);
  });

  it("rejects payment.captured when the embedded payment is not actually captured", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready, {
      status: "authorized",
      captured: false
    });

    await expect(
      phase5b3cHandle(ready, rawBody, `evt_${randomUUID().replaceAll("-", "")}`)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });

    const evidenceRows = await db
      .selectFrom("payment_provider_evidence")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(evidenceRows).toHaveLength(0);
  });

  it("acknowledges verified money after hold expiry while canonical processing opens refund reconciliation", async () => {
    const ready = await phase5b3cReadyCheckout();
    const rawBody = phase5b3cRawBody(ready);
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
    const result = await phase5b3cHandle(
      ready,
      rawBody,
      `evt_${randomUUID().replaceAll("-", "")}`,
      new VerifiedPaymentProcessor(() => afterExpiry)
    );

    expect(result.handled).toBe(true);
    expect(result.evidenceCreated).toBe(true);
    expect(result.processing).toMatchObject({
      processed: true,
      outcome: "RECONCILIATION_REQUIRED"
    });

    const [intent, reservation, reconciliation] = await Promise.all([
      db
        .selectFrom("payment_intents")
        .select("status")
        .where("id", "=", ready.payment.paymentIntent.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("reservations")
        .select("status")
        .where("id", "=", ready.held.reservation.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_reconciliation_cases")
        .select(["reason_code", "required_action", "status"])
        .where("id", "=", result.processing?.reconciliationCaseId as string)
        .executeTakeFirstOrThrow()
    ]);

    expect(intent.status).toBe("SUCCEEDED");
    expect(reservation.status).toBe("PAYMENT_PENDING");
    expect(reconciliation).toEqual({
      reason_code: "INVENTORY_HOLD_EXPIRED",
      required_action: "REFUND_REQUIRED",
      status: "OPEN"
    });
  });
});
async function phase5c1ReadyEvidence() {
  const ready = await phase5b3bReadyPayment();
  const evidence = await db.transaction().execute((trx) =>
    new VerifiedPaymentEvidenceService().record(
      trx,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id,
        provider: "RAZORPAY",
        providerEventId: `evt_${randomUUID()}`,
        providerPaymentId: `pay_${randomUUID()}`,
        providerOrderId: `order_${randomUUID()}`,
        amountMinor: ready.payment.paymentIntent.amountMinor,
        currencyCode: ready.payment.paymentIntent.currencyCode,
        verificationMethod: "WEBHOOK_SIGNATURE",
        payloadSha256: "e".repeat(64)
      },
      metadata()
    )
  );
  return { ...ready, evidence };
}

async function phase5c1Process(
  ready: Awaited<ReturnType<typeof phase5c1ReadyEvidence>>,
  evidenceId = ready.evidence.evidence.id,
  processor = new VerifiedPaymentProcessor()
) {
  return db.transaction().execute((trx) =>
    processor.process(
      trx,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        paymentIntentId: ready.payment.paymentIntent.id,
        paymentEvidenceId: evidenceId
      },
      metadata()
    )
  );
}

describe("Phase 5C1 canonical refund request foundation", () => {
  it("automatically creates one immutable refund request when reconciliation requires a refund", async () => {
    const ready = await phase5c1ReadyEvidence();
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);

    const result = await phase5c1Process(
      ready,
      ready.evidence.evidence.id,
      new VerifiedPaymentProcessor(() => afterExpiry)
    );

    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(result.reconciliationCaseId).toBeTruthy();

    const refund = await db
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("reconciliation_case_id", "=", result.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();

    expect(refund).toMatchObject({
      payment_intent_id: ready.payment.paymentIntent.id,
      payment_evidence_id: ready.evidence.evidence.id,
      reconciliation_case_id: result.reconciliationCaseId,
      organization_id: ready.fixture.organizationId,
      property_id: ready.fixture.propertyId,
      reservation_id: ready.held.reservation.id,
      provider: "RAZORPAY",
      provider_payment_id: ready.evidence.evidence.providerPaymentId,
      amount_minor: ready.payment.paymentIntent.amountMinor,
      currency_code: ready.payment.paymentIntent.currencyCode,
      reason_code: "INVENTORY_HOLD_EXPIRED"
    });

    const [event, audit, outbox] = await Promise.all([
      db
        .selectFrom("payment_events")
        .select("event_type")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "REFUND_REQUESTED")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .select(["action", "actor_type"])
        .where("entity_type", "=", "payment_refund_request")
        .where("entity_id", "=", refund.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .select("event_type")
        .where("aggregate_type", "=", "payment_intent")
        .where("aggregate_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "payment.refund.requested.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(event.event_type).toBe("REFUND_REQUESTED");
    expect(audit).toEqual({ action: "payment.refund.requested", actor_type: "SYSTEM" });
    expect(outbox.event_type).toBe("payment.refund.requested.v1");
  });

  it("targets the duplicate provider payment rather than the canonical first payment", async () => {
    const ready = await phase5c1ReadyEvidence();
    const first = await phase5c1Process(ready);
    expect(first.outcome).toBe("RESERVATION_CONFIRMED");

    const duplicatePaymentId = `pay_${randomUUID()}`;
    const duplicateEvidence = await db.transaction().execute((trx) =>
      new VerifiedPaymentEvidenceService().record(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id,
          provider: "RAZORPAY",
          providerEventId: `evt_${randomUUID()}`,
          providerPaymentId: duplicatePaymentId,
          providerOrderId: `order_${randomUUID()}`,
          amountMinor: ready.payment.paymentIntent.amountMinor,
          currencyCode: ready.payment.paymentIntent.currencyCode,
          verificationMethod: "WEBHOOK_SIGNATURE",
          payloadSha256: "f".repeat(64)
        },
        metadata()
      )
    );

    const duplicate = await phase5c1Process(ready, duplicateEvidence.evidence.id);
    expect(duplicate.outcome).toBe("RECONCILIATION_REQUIRED");

    const refund = await db
      .selectFrom("payment_refund_requests")
      .select(["payment_evidence_id", "provider_payment_id", "reason_code"])
      .where("reconciliation_case_id", "=", duplicate.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();

    expect(refund).toEqual({
      payment_evidence_id: duplicateEvidence.evidence.id,
      provider_payment_id: duplicatePaymentId,
      reason_code: "DUPLICATE_VERIFIED_PAYMENT"
    });
  });

  it("does not create a refund request for MANUAL_REVIEW reconciliation", async () => {
    const ready = await phase5c1ReadyEvidence();

    await db
      .updateTable("reservations")
      .set({ status: "CANCELLED" })
      .where("id", "=", ready.held.reservation.id)
      .execute();

    const result = await phase5c1Process(ready);
    expect(result.outcome).toBe("RECONCILIATION_REQUIRED");

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select("required_action")
      .where("id", "=", result.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();
    expect(reconciliation.required_action).toBe("MANUAL_REVIEW");

    const refunds = await db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("payment_evidence_id", "=", ready.evidence.evidence.id)
      .execute();
    expect(refunds).toHaveLength(0);
  });

  it("keeps refund creation idempotent when the same refund-required evidence is processed again", async () => {
    const ready = await phase5c1ReadyEvidence();
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
    const processor = new VerifiedPaymentProcessor(() => afterExpiry);

    const first = await phase5c1Process(ready, ready.evidence.evidence.id, processor);
    const second = await phase5c1Process(ready, ready.evidence.evidence.id, processor);

    expect(first.reconciliationCaseId).toBe(second.reconciliationCaseId);

    const refunds = await db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("reconciliation_case_id", "=", first.reconciliationCaseId as string)
      .execute();
    expect(refunds).toHaveLength(1);

    const events = await db
      .selectFrom("payment_events")
      .select("id")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .where("event_type", "=", "REFUND_REQUESTED")
      .execute();
    expect(events).toHaveLength(1);
  });

  it("protects canonical refund request identity and economics from mutation", async () => {
    const ready = await phase5c1ReadyEvidence();
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
    const result = await phase5c1Process(
      ready,
      ready.evidence.evidence.id,
      new VerifiedPaymentProcessor(() => afterExpiry)
    );

    const refund = await db
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("reconciliation_case_id", "=", result.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();

    await expect(
      db
        .updateTable("payment_refund_requests")
        .set({ amount_minor: refund.amount_minor + 1 })
        .where("id", "=", refund.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("payment_refund_requests").where("id", "=", refund.id).execute()
    ).rejects.toThrow(/immutable/i);
  });
});
async function phase5c2ReadyRefundRequest() {
  const ready = await phase5c1ReadyEvidence();
  const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
  const processing = await phase5c1Process(
    ready,
    ready.evidence.evidence.id,
    new VerifiedPaymentProcessor(() => afterExpiry)
  );
  const refundRequest = await db
    .selectFrom("payment_refund_requests")
    .selectAll()
    .where("reconciliation_case_id", "=", processing.reconciliationCaseId as string)
    .executeTakeFirstOrThrow();

  return { ...ready, processing, refundRequest };
}

class FakeRazorpayRefundGateway implements RazorpayRefundGateway {
  calls: RazorpayCreateRefundInput[] = [];
  failCalls = 0;
  amountDelta = 0;
  paymentIdOverride: string | null = null;
  currencyOverride: string | null = null;
  status: RazorpayRefund["status"] = "pending";
  readonly refundId = `rfnd_${randomUUID().replaceAll("-", "").slice(0, 18)}`;

  async createRefund(input: RazorpayCreateRefundInput): Promise<RazorpayRefund> {
    const observed: RazorpayCreateRefundInput = {
      providerPaymentId: input.providerPaymentId,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey
    };
    if (input.notes) observed.notes = { ...input.notes };
    this.calls.push(observed);

    if (this.failCalls > 0) {
      this.failCalls -= 1;
      throw new RazorpayProviderError("simulated ambiguous refund transport failure");
    }

    return {
      id: this.refundId,
      amount: input.amountMinor + this.amountDelta,
      currency: this.currencyOverride ?? "INR",
      paymentId: this.paymentIdOverride ?? input.providerPaymentId,
      status: this.status,
      createdAt: 2_024_000_000
    };
  }
}

function phase5c2Submit(
  ready: Awaited<ReturnType<typeof phase5c2ReadyRefundRequest>>,
  gateway: RazorpayRefundGateway
) {
  return new RazorpayRefundSubmissionService(db, gateway).submit(
    {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      reservationId: ready.held.reservation.id,
      refundRequestId: ready.refundRequest.id
    },
    metadata()
  );
}

describe("Phase 5C2 Razorpay refund submission", () => {
  it("submits the exact immutable refund request and keeps reconciliation open", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    gateway.status = "processed";

    const result = await phase5c2Submit(ready, gateway);

    expect(result.created).toBe(true);
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]).toEqual({
      providerPaymentId: ready.refundRequest.provider_payment_id,
      amountMinor: ready.refundRequest.amount_minor,
      idempotencyKey: `wl_refund_${ready.refundRequest.id.replaceAll("-", "")}_1`,
      notes: {
        refundRequestId: ready.refundRequest.id,
        paymentIntentId: ready.refundRequest.payment_intent_id,
        reconciliationCaseId: ready.refundRequest.reconciliation_case_id,
        reasonCode: ready.refundRequest.reason_code,
        refundAttemptSequence: "1"
      }
    });

    expect(result.submission).toMatchObject({
      refundRequestId: ready.refundRequest.id,
      attemptSequence: 1,
      paymentIntentId: ready.refundRequest.payment_intent_id,
      paymentEvidenceId: ready.refundRequest.payment_evidence_id,
      reconciliationCaseId: ready.refundRequest.reconciliation_case_id,
      provider: "RAZORPAY",
      providerPaymentId: ready.refundRequest.provider_payment_id,
      providerRefundId: gateway.refundId,
      amountMinor: ready.refundRequest.amount_minor,
      currencyCode: ready.refundRequest.currency_code,
      initialProviderStatus: "PROCESSED"
    });

    const [reconciliation, event, audit, outbox] = await Promise.all([
      db
        .selectFrom("payment_reconciliation_cases")
        .select(["status", "required_action"])
        .where("id", "=", ready.refundRequest.reconciliation_case_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_events")
        .select("event_type")
        .where("payment_intent_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "REFUND_SUBMITTED")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .select(["action", "actor_type"])
        .where("entity_type", "=", "payment_refund_submission")
        .where("entity_id", "=", result.submission.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .select("event_type")
        .where("aggregate_type", "=", "payment_intent")
        .where("aggregate_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "payment.refund.submitted.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(reconciliation).toEqual({ status: "OPEN", required_action: "REFUND_REQUIRED" });
    expect(event.event_type).toBe("REFUND_SUBMITTED");
    expect(audit).toEqual({ action: "payment.refund.submitted", actor_type: "SYSTEM" });
    expect(outbox.event_type).toBe("payment.refund.submitted.v1");
  });

  it("returns the stored submission on retry without contacting Razorpay again", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();

    const first = await phase5c2Submit(ready, gateway);
    const second = await phase5c2Submit(ready, gateway);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);
    expect(gateway.calls).toHaveLength(1);
  });

  it("reuses the exact provider idempotency request after an ambiguous failure", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    gateway.failCalls = 1;

    await expect(phase5c2Submit(ready, gateway)).rejects.toMatchObject({
      code: "PAYMENT_PROVIDER_ERROR",
      statusCode: 502
    });

    const rowsAfterFailure = await db
      .selectFrom("payment_refund_submissions")
      .select("id")
      .where("refund_request_id", "=", ready.refundRequest.id)
      .execute();
    expect(rowsAfterFailure).toHaveLength(0);

    const retry = await phase5c2Submit(ready, gateway);

    expect(retry.created).toBe(true);
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1]).toEqual(gateway.calls[0]);

    const rows = await db
      .selectFrom("payment_refund_submissions")
      .select(["id", "attempt_sequence"])
      .where("refund_request_id", "=", ready.refundRequest.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.attempt_sequence).toBe(1);
  });

  it("rejects a provider response with changed refund economics", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    gateway.amountDelta = 1;

    await expect(phase5c2Submit(ready, gateway)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const rows = await db
      .selectFrom("payment_refund_submissions")
      .select("id")
      .where("refund_request_id", "=", ready.refundRequest.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it("protects the persisted Razorpay refund submission from mutation", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    const result = await phase5c2Submit(ready, gateway);

    await expect(
      db
        .updateTable("payment_refund_submissions")
        .set({ provider_refund_id: "rfnd_tampered" })
        .where("id", "=", result.submission.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("payment_refund_submissions").where("id", "=", result.submission.id).execute()
    ).rejects.toThrow(/immutable/i);
  });
});
async function phase5c3ReadySubmission() {
  const ready = await phase5c2ReadyRefundRequest();
  const gateway = new FakeRazorpayRefundGateway();
  gateway.status = "pending";
  const submitted = await phase5c2Submit(ready, gateway);
  return { ...ready, gateway, submitted };
}

function phase5c3RefundRawBody(
  ready: Awaited<ReturnType<typeof phase5c2ReadyRefundRequest>>,
  options: {
    eventType: "refund.created" | "refund.processed" | "refund.failed";
    providerRefundId: string;
    attemptSequence?: number;
    amountMinor?: number;
    currencyCode?: string;
    providerPaymentId?: string;
    status?: "pending" | "processed" | "failed";
    eventCreatedAt?: number;
  }
): Buffer {
  const status =
    options.status ??
    (options.eventType === "refund.processed"
      ? "processed"
      : options.eventType === "refund.failed"
        ? "failed"
        : "pending");
  const providerPaymentId = options.providerPaymentId ?? ready.refundRequest.provider_payment_id;
  const currencyCode = options.currencyCode ?? ready.refundRequest.currency_code;

  return Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_phase5c3",
      event: options.eventType,
      contains: ["refund", "payment"],
      payload: {
        refund: {
          entity: {
            id: options.providerRefundId,
            entity: "refund",
            amount: options.amountMinor ?? ready.refundRequest.amount_minor,
            currency: currencyCode,
            payment_id: providerPaymentId,
            notes: {
              refundRequestId: ready.refundRequest.id,
              paymentIntentId: ready.refundRequest.payment_intent_id,
              reconciliationCaseId: ready.refundRequest.reconciliation_case_id,
              reasonCode: ready.refundRequest.reason_code,
              refundAttemptSequence: String(options.attemptSequence ?? 1)
            },
            receipt: null,
            acquirer_data: { arn: null },
            created_at: 2_024_000_000,
            batch_id: null,
            status,
            speed_processed: "normal",
            speed_requested: "normal"
          }
        },
        payment: {
          entity: {
            id: providerPaymentId,
            entity: "payment",
            amount: ready.refundRequest.amount_minor,
            currency: currencyCode,
            status: "captured",
            captured: true
          }
        }
      },
      created_at: options.eventCreatedAt ?? 2_024_000_100
    }),
    "utf8"
  );
}

function phase5c3Handle(rawBody: Buffer, providerEventId: string) {
  return new RazorpayWebhookService(db, phase5b3cProvider()).handle(
    {
      rawBody,
      signature: phase5b3cSignature(rawBody),
      providerEventId
    },
    metadata()
  );
}

describe("Phase 5C3 Razorpay refund webhook finalization", () => {
  it("records a signed refund.created event without prematurely resolving reconciliation", async () => {
    const ready = await phase5c3ReadySubmission();
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.created",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const result = await phase5c3Handle(
      rawBody,
      `evt_refund_created_${randomUUID().replaceAll("-", "")}`
    );

    expect(result.handled).toBe(true);
    expect(result.refund).toMatchObject({
      refundSubmissionId: ready.submitted.submission.id,
      providerRefundId: ready.submitted.submission.providerRefundId,
      lifecycleEventCreated: true,
      submissionRecovered: false,
      finalizationId: null,
      finalizationStatus: null,
      reconciliationResolved: false
    });

    const [eventRows, finalizationRows, reconciliation] = await Promise.all([
      db
        .selectFrom("payment_refund_provider_events")
        .select("id")
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .execute(),
      db
        .selectFrom("payment_refund_finalizations")
        .select("id")
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .execute(),
      db
        .selectFrom("payment_reconciliation_cases")
        .select("status")
        .where("id", "=", ready.refundRequest.reconciliation_case_id)
        .executeTakeFirstOrThrow()
    ]);

    expect(eventRows).toHaveLength(1);
    expect(finalizationRows).toHaveLength(0);
    expect(reconciliation.status).toBe("OPEN");
  });

  it("finalizes refund.processed and resolves the refund-required reconciliation atomically", async () => {
    const ready = await phase5c3ReadySubmission();
    const providerEventId = `evt_refund_processed_${randomUUID().replaceAll("-", "")}`;
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const result = await phase5c3Handle(rawBody, providerEventId);

    expect(result.refund).toMatchObject({
      refundSubmissionId: ready.submitted.submission.id,
      lifecycleEventCreated: true,
      finalizationCreated: true,
      finalizationStatus: "PROCESSED",
      reconciliationResolved: true
    });

    const [reconciliation, finalization, event, audit, outbox] = await Promise.all([
      db
        .selectFrom("payment_reconciliation_cases")
        .select(["status", "resolved_at", "resolution_note"])
        .where("id", "=", ready.refundRequest.reconciliation_case_id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_refund_finalizations")
        .selectAll()
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("payment_events")
        .select("event_type")
        .where("payment_intent_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "REFUND_PROCESSED")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .select(["action", "actor_type"])
        .where("entity_type", "=", "payment_refund_finalization")
        .where("entity_id", "=", result.refund?.finalizationId as string)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("outbox_events")
        .select("event_type")
        .where("aggregate_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "payment.refund.processed.v1")
        .executeTakeFirstOrThrow()
    ]);

    expect(reconciliation.status).toBe("RESOLVED");
    expect(reconciliation.resolved_at).not.toBeNull();
    expect(reconciliation.resolution_note).toContain(ready.submitted.submission.providerRefundId);
    expect(finalization.status).toBe("PROCESSED");
    expect(finalization.provider_event_id).toBe(providerEventId);
    expect(event.event_type).toBe("REFUND_PROCESSED");
    expect(audit).toEqual({ action: "payment.refund.processed", actor_type: "SYSTEM" });
    expect(outbox.event_type).toBe("payment.refund.processed.v1");
  });

  it("is idempotent when Razorpay retries the exact same refund terminal event", async () => {
    const ready = await phase5c3ReadySubmission();
    const providerEventId = `evt_refund_retry_${randomUUID().replaceAll("-", "")}`;
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const first = await phase5c3Handle(rawBody, providerEventId);
    const second = await phase5c3Handle(rawBody, providerEventId);

    expect(first.refund?.lifecycleEventCreated).toBe(true);
    expect(first.refund?.finalizationCreated).toBe(true);
    expect(second.refund?.lifecycleEventCreated).toBe(false);
    expect(second.refund?.finalizationCreated).toBe(false);
    expect(second.refund?.finalizationId).toBe(first.refund?.finalizationId);

    const [providerEvents, finalizations, paymentEvents] = await Promise.all([
      db
        .selectFrom("payment_refund_provider_events")
        .select("id")
        .where("provider_event_id", "=", providerEventId)
        .execute(),
      db
        .selectFrom("payment_refund_finalizations")
        .select("id")
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .execute(),
      db
        .selectFrom("payment_events")
        .select("id")
        .where("payment_intent_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "REFUND_PROCESSED")
        .execute()
    ]);

    expect(providerEvents).toHaveLength(1);
    expect(finalizations).toHaveLength(1);
    expect(paymentEvents).toHaveLength(1);
  });

  it("keeps reconciliation open on refund.failed and allows a new deterministic submission attempt", async () => {
    const ready = await phase5c3ReadySubmission();
    const failedRawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.failed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const failed = await phase5c3Handle(
      failedRawBody,
      `evt_refund_failed_${randomUUID().replaceAll("-", "")}`
    );
    expect(failed.refund).toMatchObject({
      finalizationCreated: true,
      finalizationStatus: "FAILED",
      reconciliationResolved: false
    });

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select("status")
      .where("id", "=", ready.refundRequest.reconciliation_case_id)
      .executeTakeFirstOrThrow();
    expect(reconciliation.status).toBe("OPEN");

    const retryGateway = new FakeRazorpayRefundGateway();
    const retry = await phase5c2Submit(ready, retryGateway);

    expect(retry.created).toBe(true);
    expect(retry.submission.attemptSequence).toBe(2);
    expect(retryGateway.calls).toHaveLength(1);
    expect(retryGateway.calls[0]?.idempotencyKey).toBe(
      `wl_refund_${ready.refundRequest.id.replaceAll("-", "")}_2`
    );
    expect(retryGateway.calls[0]?.notes?.["refundAttemptSequence"]).toBe("2");

    const submissions = await db
      .selectFrom("payment_refund_submissions")
      .select("attempt_sequence")
      .where("refund_request_id", "=", ready.refundRequest.id)
      .orderBy("attempt_sequence")
      .execute();
    expect(submissions.map((row) => row.attempt_sequence)).toEqual([1, 2]);
  });

  it("handles refund.processed before refund.created without reopening or duplicating final state", async () => {
    const ready = await phase5c3ReadySubmission();
    const providerRefundId = ready.submitted.submission.providerRefundId;

    const processedRawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId,
      eventCreatedAt: 2_024_000_200
    });
    await phase5c3Handle(
      processedRawBody,
      `evt_refund_processed_first_${randomUUID().replaceAll("-", "")}`
    );

    const createdRawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.created",
      providerRefundId,
      eventCreatedAt: 2_024_000_100
    });
    const created = await phase5c3Handle(
      createdRawBody,
      `evt_refund_created_late_${randomUUID().replaceAll("-", "")}`
    );

    expect(created.refund).toMatchObject({
      lifecycleEventCreated: true,
      finalizationCreated: false,
      finalizationStatus: "PROCESSED",
      reconciliationResolved: false
    });

    const [events, finalizations, reconciliation] = await Promise.all([
      db
        .selectFrom("payment_refund_provider_events")
        .select("event_type")
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .execute(),
      db
        .selectFrom("payment_refund_finalizations")
        .select("status")
        .where("refund_submission_id", "=", ready.submitted.submission.id)
        .execute(),
      db
        .selectFrom("payment_reconciliation_cases")
        .select("status")
        .where("id", "=", ready.refundRequest.reconciliation_case_id)
        .executeTakeFirstOrThrow()
    ]);

    expect(events).toHaveLength(2);
    expect(finalizations).toEqual([{ status: "PROCESSED" }]);
    expect(reconciliation.status).toBe("RESOLVED");
  });

  it("rejects signed refund lifecycle evidence that changes immutable refund economics", async () => {
    const ready = await phase5c3ReadySubmission();
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId,
      amountMinor: ready.refundRequest.amount_minor + 1
    });

    await expect(
      phase5c3Handle(rawBody, `evt_refund_bad_amount_${randomUUID().replaceAll("-", "")}`)
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const rows = await db
      .selectFrom("payment_refund_provider_events")
      .select("id")
      .where("refund_submission_id", "=", ready.submitted.submission.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it("recovers an accepted Razorpay refund from signed webhook notes when local submission persistence was lost", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const providerRefundId = `rfnd_recovered_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId,
      attemptSequence: 1
    });

    const result = await phase5c3Handle(
      rawBody,
      `evt_refund_recovery_${randomUUID().replaceAll("-", "")}`
    );

    expect(result.refund).toMatchObject({
      providerRefundId,
      submissionRecovered: true,
      finalizationCreated: true,
      finalizationStatus: "PROCESSED",
      reconciliationResolved: true
    });

    const submission = await db
      .selectFrom("payment_refund_submissions")
      .selectAll()
      .where("refund_request_id", "=", ready.refundRequest.id)
      .where("attempt_sequence", "=", 1)
      .executeTakeFirstOrThrow();

    expect(submission.provider_refund_id).toBe(providerRefundId);
    expect(submission.idempotency_key).toBe(
      `wl_refund_${ready.refundRequest.id.replaceAll("-", "")}_1`
    );

    const submittedEvents = await db
      .selectFrom("payment_events")
      .select("details_json")
      .where("payment_intent_id", "=", ready.refundRequest.payment_intent_id)
      .where("event_type", "=", "REFUND_SUBMITTED")
      .execute();
    expect(submittedEvents).toHaveLength(1);
    expect(submittedEvents[0]?.details_json).toMatchObject({ recoveredFromWebhook: true });
  });

  it("rejects reuse of a Razorpay event id with changed refund payload", async () => {
    const ready = await phase5c3ReadySubmission();
    const providerEventId = `evt_refund_conflict_${randomUUID().replaceAll("-", "")}`;
    const firstBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.created",
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    await phase5c3Handle(firstBody, providerEventId);

    const changedBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.created",
      providerRefundId: ready.submitted.submission.providerRefundId,
      eventCreatedAt: 2_024_000_101
    });

    await expect(phase5c3Handle(changedBody, providerEventId)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const rows = await db
      .selectFrom("payment_refund_provider_events")
      .select("id")
      .where("provider_event_id", "=", providerEventId)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("protects refund lifecycle evidence and finalization from mutation", async () => {
    const ready = await phase5c3ReadySubmission();
    const rawBody = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    const result = await phase5c3Handle(
      rawBody,
      `evt_refund_immutable_${randomUUID().replaceAll("-", "")}`
    );

    await expect(
      db
        .updateTable("payment_refund_provider_events")
        .set({ provider_status: "FAILED" })
        .where("id", "=", result.refund?.lifecycleEventId as string)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .deleteFrom("payment_refund_finalizations")
        .where("id", "=", result.refund?.finalizationId as string)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });
});
