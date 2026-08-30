import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { AuditExplorerService } from "../src/modules/audit/application/audit-explorer-service.js";
import { QualityAuditService } from "../src/modules/quality/application/quality-audit-service.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { InventoryAllocationService } from "../src/modules/inventory/application/inventory-allocation-service.js";
import { InventoryHoldService } from "../src/modules/inventory/application/inventory-hold-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
import { OwnerReportService } from "../src/modules/reports/application/owner-report-service.js";
import { HeldReservationService } from "../src/modules/reservations/application/held-reservation-service.js";
import { StayLifecycleService } from "../src/modules/reservations/application/stay-lifecycle-service.js";
import {
  RevenueLedgerPostingService,
  revenueRecognitionDateForLine
} from "../src/modules/finance/application/revenue-ledger-posting-service.js";
import { RevenueReversalService } from "../src/modules/finance/application/revenue-reversal-service.js";
import { RevenueRecognitionScheduleService } from "../src/modules/finance/application/revenue-recognition-schedule-service.js";
import { buildRevenueRecognitionBasis } from "../src/modules/finance/domain/revenue-recognition.js";
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
import { PaymentFinanceReadService } from "../src/modules/payments/application/payment-finance-read-service.js";
import { PaymentReconciliationCommandService } from "../src/modules/payments/application/payment-reconciliation-command-service.js";
import { PaymentRefundCommandService } from "../src/modules/payments/application/payment-refund-command-service.js";
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
    createdAt?: number;
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
            captured: options.captured ?? true,
            created_at: options.createdAt ?? Math.floor(Date.now() / 1000)
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
    const afterExpiry = new Date(new Date(ready.payment.paymentIntent.expiresAt).getTime() + 1_000);
    const rawBody = phase5b3cRawBody(ready, {
      createdAt: Math.floor(afterExpiry.getTime() / 1000)
    });
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

  if (refundRequest.reconciliation_case_id === null) {
    throw new Error("Expected reconciliation-backed refund request fixture");
  }

  const reconciliationRefundRequest = {
    ...refundRequest,
    reconciliation_case_id: refundRequest.reconciliation_case_id
  };

  return { ...ready, processing, refundRequest: reconciliationRefundRequest };
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

describe("Phase 5D1 finance and reconciliation read layer", () => {
  it("returns complete reservation payment history without exposing provider hashes or refund idempotency keys", async () => {
    const ready = await phase5c3ReadySubmission();
    const service = new PaymentFinanceReadService();

    const result = await db.transaction().execute((trx) =>
      service.getReservationPaymentHistory(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id
      })
    );

    expect(result.reservation).toMatchObject({
      id: ready.held.reservation.id,
      reservationReference: ready.held.reservation.reservationReference,
      totalMinor: ready.payment.paymentIntent.amountMinor,
      currencyCode: ready.payment.paymentIntent.currencyCode
    });
    expect(result.paymentIntents).toHaveLength(1);
    expect(result.verifiedPayments).toHaveLength(1);
    expect(result.reconciliations).toHaveLength(1);
    expect(result.refundRequests).toHaveLength(1);
    expect(result.refundSubmissions).toHaveLength(1);
    expect(result.refundSubmissions[0]).toMatchObject({
      attemptSequence: 1,
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    expect(result.verifiedPayments[0]).not.toHaveProperty("payloadSha256");
    expect(result.refundSubmissions[0]).not.toHaveProperty("idempotencyKey");
  });

  it("lists an OPEN refund reconciliation with its current operational refund state", async () => {
    const ready = await phase5c3ReadySubmission();
    const service = new PaymentFinanceReadService();

    const result = await db.transaction().execute((trx) =>
      service.listReconciliations(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        filters: {
          status: "OPEN",
          requiredAction: "REFUND_REQUIRED",
          reasonCode: "INVENTORY_HOLD_EXPIRED",
          limit: 20
        }
      })
    );

    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      refundRequestId: ready.refundRequest.id,
      latestRefundSubmissionId: ready.submitted.submission.id,
      latestRefundAttemptSequence: 1,
      latestProviderRefundId: ready.submitted.submission.providerRefundId,
      refundState: "SUBMITTED"
    });
    expect(result.items[0]?.paymentEvidence).toMatchObject({
      id: ready.evidence.evidence.id,
      providerPaymentId: ready.refundRequest.provider_payment_id,
      amountMinor: ready.refundRequest.amount_minor,
      currencyCode: ready.refundRequest.currency_code
    });
    expect(result.items[0]?.paymentEvidence).not.toHaveProperty("payloadSha256");
  });

  it("shows failed refund lifecycle detail and the subsequent deterministic retry attempt", async () => {
    const ready = await phase5c3ReadySubmission();
    const failedRaw = phase5c3RefundRawBody(ready, {
      eventType: "refund.failed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    await phase5c3Handle(failedRaw, `evt_refund_5d1_failed_${randomUUID().replaceAll("-", "")}`);

    const retryGateway = new FakeRazorpayRefundGateway();
    retryGateway.status = "pending";
    const retry = await phase5c2Submit(ready, retryGateway);
    expect(retry.submission.attemptSequence).toBe(2);

    const service = new PaymentFinanceReadService();
    const detail = await db.transaction().execute((trx) =>
      service.getReconciliationDetail(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reconciliationCaseId: ready.refundRequest.reconciliation_case_id
      })
    );

    expect(detail.reconciliation.status).toBe("OPEN");
    expect(detail.refundRequest?.id).toBe(ready.refundRequest.id);
    expect(detail.refundSubmissions.map((item) => item.attemptSequence)).toEqual([1, 2]);
    expect(detail.refundFinalizations).toHaveLength(1);
    expect(detail.refundFinalizations[0]?.status).toBe("FAILED");
    expect(detail.refundProviderEvents).toHaveLength(1);
    expect(detail.refundProviderEvents[0]?.eventType).toBe("refund.failed");
    expect(detail.refundSubmissions[0]).not.toHaveProperty("idempotencyKey");
    expect(detail.refundProviderEvents[0]).not.toHaveProperty("payloadSha256");
  });

  it("moves a processed refund out of the OPEN queue while keeping it visible as RESOLVED", async () => {
    const ready = await phase5c3ReadySubmission();
    const processedRaw = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    await phase5c3Handle(
      processedRaw,
      `evt_refund_5d1_processed_${randomUUID().replaceAll("-", "")}`
    );

    const service = new PaymentFinanceReadService();
    const [open, resolved] = await db.transaction().execute(async (trx) => {
      const openResult = await service.listReconciliations(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        filters: { status: "OPEN", limit: 20 }
      });
      const resolvedResult = await service.listReconciliations(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        filters: { status: "RESOLVED", limit: 20 }
      });
      return [openResult, resolvedResult] as const;
    });

    expect(open.items).toHaveLength(0);
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]).toMatchObject({
      refundRequestId: ready.refundRequest.id,
      refundState: "PROCESSED"
    });
    expect(resolved.items[0]?.reconciliation.status).toBe("RESOLVED");
  });

  it("paginates the property reconciliation queue without repeating a case", async () => {
    const ready = await phase5c1ReadyEvidence();
    const confirmed = await phase5c1Process(ready);
    expect(confirmed.outcome).toBe("RESERVATION_CONFIRMED");

    const reconciliationIds: string[] = [];
    for (const marker of ["a", "b"]) {
      const evidence = await db.transaction().execute((trx) =>
        new VerifiedPaymentEvidenceService().record(
          trx,
          {
            organizationId: ready.fixture.organizationId,
            propertyId: ready.fixture.propertyId,
            reservationId: ready.held.reservation.id,
            paymentIntentId: ready.payment.paymentIntent.id,
            provider: "RAZORPAY",
            providerEventId: `evt_5d1_${marker}_${randomUUID()}`,
            providerPaymentId: `pay_5d1_${marker}_${randomUUID()}`,
            providerOrderId: `order_5d1_${marker}_${randomUUID()}`,
            amountMinor: ready.payment.paymentIntent.amountMinor,
            currencyCode: ready.payment.paymentIntent.currencyCode,
            verificationMethod: "WEBHOOK_SIGNATURE",
            payloadSha256: marker.repeat(64)
          },
          metadata()
        )
      );
      const processed = await phase5c1Process(ready, evidence.evidence.id);
      expect(processed.outcome).toBe("RECONCILIATION_REQUIRED");
      reconciliationIds.push(processed.reconciliationCaseId as string);
    }

    const service = new PaymentFinanceReadService();
    const first = await db.transaction().execute((trx) =>
      service.listReconciliations(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        filters: { status: "OPEN", requiredAction: "REFUND_REQUIRED", limit: 1 }
      })
    );
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();

    const second = await db.transaction().execute((trx) =>
      service.listReconciliations(trx, ready.fixture.actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        filters: {
          status: "OPEN",
          requiredAction: "REFUND_REQUIRED",
          limit: 1,
          cursor: first.nextCursor
        }
      })
    );

    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.reconciliation.id).not.toBe(first.items[0]?.reconciliation.id);
    expect(
      new Set([first.items[0]?.reconciliation.id, second.items[0]?.reconciliation.id])
    ).toEqual(new Set(reconciliationIds));
  });

  it("requires FINANCE_READ even when the user can otherwise read the reservation", async () => {
    const ready = await phase5c3ReadySubmission();
    const viewer: ActorContext = {
      ...ready.fixture.actor,
      organizationMemberships: ready.fixture.actor.organizationMemberships.map((membership) => ({
        ...membership,
        role: "VIEWER" as const
      })),
      propertyGrants: []
    };

    const service = new PaymentFinanceReadService();
    await expect(
      db.transaction().execute((trx) =>
        service.getReservationPaymentHistory(trx, viewer, {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        })
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });
  });
});
function phase5d2SettlementActor(
  ready: Awaited<ReturnType<typeof phase5c2ReadyRefundRequest>>
): ActorContext {
  return {
    ...ready.fixture.actor,
    platformRoles: ["FINANCE_MANAGER"]
  };
}

function phase5d2Submit(
  ready: Awaited<ReturnType<typeof phase5c2ReadyRefundRequest>>,
  gateway: RazorpayRefundGateway,
  actor: ActorContext = phase5d2SettlementActor(ready)
) {
  return new PaymentRefundCommandService(db, gateway).submit(
    actor,
    {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      reconciliationCaseId: ready.refundRequest.reconciliation_case_id
    },
    metadata()
  );
}

describe("Phase 5D2 authorized refund submission command", () => {
  it("submits only the canonical refund and attributes the money-moving command to the settlement actor", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    const actor = phase5d2SettlementActor(ready);

    const result = await phase5d2Submit(ready, gateway, actor);

    expect(result.created).toBe(true);
    expect(result.reconciliationCaseId).toBe(ready.refundRequest.reconciliation_case_id);
    expect(result.refundRequestId).toBe(ready.refundRequest.id);
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
      currencyCode: ready.refundRequest.currency_code
    });
    expect(result.submission).not.toHaveProperty("idempotencyKey");

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

    const [event, audit] = await Promise.all([
      db
        .selectFrom("payment_events")
        .select(["event_type", "actor_user_id"])
        .where("payment_intent_id", "=", ready.refundRequest.payment_intent_id)
        .where("event_type", "=", "REFUND_SUBMITTED")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("audit_events")
        .select(["action", "actor_type", "actor_user_id"])
        .where("entity_type", "=", "payment_refund_submission")
        .where("entity_id", "=", result.submission.id)
        .executeTakeFirstOrThrow()
    ]);

    expect(event).toEqual({
      event_type: "REFUND_SUBMITTED",
      actor_user_id: actor.userId
    });
    expect(audit).toEqual({
      action: "payment.refund.submitted",
      actor_type: "USER",
      actor_user_id: actor.userId
    });
  });

  it("reuses the existing refund attempt on a repeated settlement command without calling Razorpay again", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();
    const actor = phase5d2SettlementActor(ready);

    const first = await phase5d2Submit(ready, gateway, actor);
    const second = await phase5d2Submit(ready, gateway, actor);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.submission.id).toBe(first.submission.id);
    expect(second.submission).not.toHaveProperty("idempotencyKey");
    expect(gateway.calls).toHaveLength(1);
  });

  it("denies an organization OWNER who has finance visibility but lacks SETTLEMENT_MANAGE", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const gateway = new FakeRazorpayRefundGateway();

    await expect(phase5d2Submit(ready, gateway, ready.fixture.actor)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    expect(gateway.calls).toHaveLength(0);
    const submissions = await db
      .selectFrom("payment_refund_submissions")
      .select("id")
      .where("refund_request_id", "=", ready.refundRequest.id)
      .execute();
    expect(submissions).toHaveLength(0);
  });

  it("refuses to turn a MANUAL_REVIEW reconciliation into a provider refund", async () => {
    const ready = await phase5c1ReadyEvidence();
    await db
      .updateTable("reservations")
      .set({ status: "CANCELLED" })
      .where("id", "=", ready.held.reservation.id)
      .execute();

    const processed = await phase5c1Process(ready);
    expect(processed.outcome).toBe("RECONCILIATION_REQUIRED");
    expect(processed.reconciliationCaseId).toBeTruthy();

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["required_action", "status"])
      .where("id", "=", processed.reconciliationCaseId as string)
      .executeTakeFirstOrThrow();
    expect(reconciliation).toEqual({ required_action: "MANUAL_REVIEW", status: "OPEN" });

    const actor: ActorContext = {
      ...ready.fixture.actor,
      platformRoles: ["FINANCE_MANAGER"]
    };
    const gateway = new FakeRazorpayRefundGateway();

    await expect(
      new PaymentRefundCommandService(db, gateway).submit(
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reconciliationCaseId: processed.reconciliationCaseId as string
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    expect(gateway.calls).toHaveLength(0);
  });

  it("allows the authorized command to create attempt two only after verified refund failure", async () => {
    const ready = await phase5c3ReadySubmission();
    const failedRaw = phase5c3RefundRawBody(ready, {
      eventType: "refund.failed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });
    await phase5c3Handle(failedRaw, `evt_refund_5d2_failed_${randomUUID().replaceAll("-", "")}`);

    const gateway = new FakeRazorpayRefundGateway();
    gateway.status = "pending";
    const actor = phase5d2SettlementActor(ready);

    const retry = await phase5d2Submit(ready, gateway, actor);

    expect(retry.created).toBe(true);
    expect(retry.submission.attemptSequence).toBe(2);
    expect(retry.submission).not.toHaveProperty("idempotencyKey");
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0]?.notes?.["refundAttemptSequence"]).toBe("2");
  });
});
async function phase5d3ReadyManualReview() {
  const ready = await phase5c1ReadyEvidence();

  await db
    .updateTable("reservations")
    .set({ status: "CANCELLED" })
    .where("id", "=", ready.held.reservation.id)
    .execute();

  const processed = await phase5c1Process(ready);
  expect(processed.outcome).toBe("RECONCILIATION_REQUIRED");
  expect(processed.reconciliationCaseId).toBeTruthy();

  const reconciliationCaseId = processed.reconciliationCaseId as string;
  const reconciliation = await db
    .selectFrom("payment_reconciliation_cases")
    .selectAll()
    .where("id", "=", reconciliationCaseId)
    .executeTakeFirstOrThrow();

  expect(reconciliation).toMatchObject({
    required_action: "MANUAL_REVIEW",
    status: "OPEN",
    resolution_code: null,
    resolved_by_user_id: null
  });

  return {
    ...ready,
    processed,
    reconciliationCaseId,
    reconciliation
  };
}

function phase5d3SettlementActor(
  ready: Awaited<ReturnType<typeof phase5d3ReadyManualReview>>
): ActorContext {
  return {
    ...ready.fixture.actor,
    platformRoles: ["FINANCE_MANAGER"]
  };
}

async function phase5d3Resolve(
  ready: Awaited<ReturnType<typeof phase5d3ReadyManualReview>>,
  note = "Verified payment retained after finance reviewed the cancelled reservation."
) {
  const actor = phase5d3SettlementActor(ready);
  const result = await new PaymentReconciliationCommandService(db).resolveManualReview(
    actor,
    {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      reconciliationCaseId: ready.reconciliationCaseId,
      resolutionCode: "PAYMENT_RETAINED",
      note
    },
    metadata()
  );

  return { actor, result };
}

describe("Phase 5D3 authorized manual reconciliation resolution", () => {
  it("resolves only the manual-review case with a structured retained-payment outcome", async () => {
    const ready = await phase5d3ReadyManualReview();
    const reservationBefore = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();
    const paymentBefore = await db
      .selectFrom("payment_intents")
      .select(["status", "amount_minor", "currency_code"])
      .where("id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();

    const note = "Finance confirmed that the verified payment is intentionally retained.";
    const { actor, result } = await phase5d3Resolve(ready, note);

    expect(result.created).toBe(true);
    expect(result.reconciliation).toMatchObject({
      id: ready.reconciliationCaseId,
      requiredAction: "MANUAL_REVIEW",
      status: "RESOLVED",
      resolvedByUserId: actor.userId,
      resolutionCode: "PAYMENT_RETAINED",
      resolutionNote: note
    });
    expect(result.reconciliation.resolvedAt).toBeTruthy();

    const reservationAfter = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();
    const paymentAfter = await db
      .selectFrom("payment_intents")
      .select(["status", "amount_minor", "currency_code"])
      .where("id", "=", ready.payment.paymentIntent.id)
      .executeTakeFirstOrThrow();

    expect(reservationAfter).toEqual(reservationBefore);
    expect(paymentAfter).toEqual(paymentBefore);

    const [events, audits, outbox] = await Promise.all([
      db
        .selectFrom("payment_events")
        .select(["event_type", "actor_user_id"])
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "PAYMENT_RECONCILIATION_RESOLVED")
        .execute(),
      db
        .selectFrom("audit_events")
        .select(["action", "actor_type", "actor_user_id", "reason"])
        .where("entity_type", "=", "payment_reconciliation_case")
        .where("entity_id", "=", ready.reconciliationCaseId)
        .where("action", "=", "payment.reconciliation.resolved")
        .execute(),
      db
        .selectFrom("outbox_events")
        .select(["aggregate_id", "event_type"])
        .where("aggregate_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "payment.reconciliation.resolved.v1")
        .execute()
    ]);

    expect(events).toEqual([
      {
        event_type: "PAYMENT_RECONCILIATION_RESOLVED",
        actor_user_id: actor.userId
      }
    ]);
    expect(audits).toEqual([
      {
        action: "payment.reconciliation.resolved",
        actor_type: "USER",
        actor_user_id: actor.userId,
        reason: "PAYMENT_RETAINED"
      }
    ]);
    expect(outbox).toEqual([
      {
        aggregate_id: ready.payment.paymentIntent.id,
        event_type: "payment.reconciliation.resolved.v1"
      }
    ]);
  });

  it("returns the existing resolution on an exact retry without duplicating lifecycle records", async () => {
    const ready = await phase5d3ReadyManualReview();
    const note = "Finance confirmed that the verified payment is intentionally retained.";

    const first = await phase5d3Resolve(ready, note);
    const second = await phase5d3Resolve(ready, note);

    expect(first.result.created).toBe(true);
    expect(second.result.created).toBe(false);
    expect(second.result.reconciliation).toEqual(first.result.reconciliation);

    const [events, audits, outbox] = await Promise.all([
      db
        .selectFrom("payment_events")
        .select("id")
        .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "PAYMENT_RECONCILIATION_RESOLVED")
        .execute(),
      db
        .selectFrom("audit_events")
        .select("id")
        .where("entity_type", "=", "payment_reconciliation_case")
        .where("entity_id", "=", ready.reconciliationCaseId)
        .where("action", "=", "payment.reconciliation.resolved")
        .execute(),
      db
        .selectFrom("outbox_events")
        .select("id")
        .where("aggregate_id", "=", ready.payment.paymentIntent.id)
        .where("event_type", "=", "payment.reconciliation.resolved.v1")
        .execute()
    ]);

    expect(events).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it("requires SETTLEMENT_MANAGE before reading or resolving the case", async () => {
    const ready = await phase5d3ReadyManualReview();

    await expect(
      new PaymentReconciliationCommandService(db).resolveManualReview(
        ready.fixture.actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reconciliationCaseId: ready.reconciliationCaseId,
          resolutionCode: "PAYMENT_RETAINED",
          note: "Finance confirmed that the verified payment is intentionally retained."
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "ACCESS_DENIED", statusCode: 403 });

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["status", "resolution_code", "resolved_by_user_id"])
      .where("id", "=", ready.reconciliationCaseId)
      .executeTakeFirstOrThrow();

    expect(reconciliation).toEqual({
      status: "OPEN",
      resolution_code: null,
      resolved_by_user_id: null
    });
  });

  it("refuses manual closure of a REFUND_REQUIRED case", async () => {
    const ready = await phase5c2ReadyRefundRequest();
    const actor: ActorContext = {
      ...ready.fixture.actor,
      platformRoles: ["FINANCE_MANAGER"]
    };

    await expect(
      new PaymentReconciliationCommandService(db).resolveManualReview(
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reconciliationCaseId: ready.refundRequest.reconciliation_case_id,
          resolutionCode: "PAYMENT_RETAINED",
          note: "Finance reviewed this case but provider refund processing remains mandatory."
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["required_action", "status", "resolution_code"])
      .where("id", "=", ready.refundRequest.reconciliation_case_id)
      .executeTakeFirstOrThrow();

    expect(reconciliation).toEqual({
      required_action: "REFUND_REQUIRED",
      status: "OPEN",
      resolution_code: null
    });
  });

  it("rejects a different resolution note after the case has been resolved", async () => {
    const ready = await phase5d3ReadyManualReview();
    const first = await phase5d3Resolve(
      ready,
      "Finance confirmed that the verified payment is intentionally retained."
    );

    await expect(
      new PaymentReconciliationCommandService(db).resolveManualReview(
        first.actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reconciliationCaseId: ready.reconciliationCaseId,
          resolutionCode: "PAYMENT_RETAINED",
          note: "A different note must not rewrite the completed reconciliation decision."
        },
        metadata()
      )
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("exposes structured manual resolution identity through the finance read layer", async () => {
    const ready = await phase5d3ReadyManualReview();
    const note = "Finance confirmed that the verified payment is intentionally retained.";
    const { actor } = await phase5d3Resolve(ready, note);

    const detail = await db.transaction().execute((trx) =>
      new PaymentFinanceReadService().getReconciliationDetail(trx, actor, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reconciliationCaseId: ready.reconciliationCaseId
      })
    );

    expect(detail.reconciliation).toMatchObject({
      status: "RESOLVED",
      resolvedByUserId: actor.userId,
      resolutionCode: "PAYMENT_RETAINED",
      resolutionNote: note
    });
  });

  it("keeps the resolved reconciliation lifecycle immutable at the database boundary", async () => {
    const ready = await phase5d3ReadyManualReview();
    await phase5d3Resolve(ready);

    await expect(
      db
        .updateTable("payment_reconciliation_cases")
        .set({ resolution_note: "Attempted mutation after resolution must be rejected." })
        .where("id", "=", ready.reconciliationCaseId)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("assigns the provider refund resolution code when a verified refund closes the case", async () => {
    const ready = await phase5c3ReadySubmission();
    const processedRaw = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    await phase5c3Handle(
      processedRaw,
      `evt_refund_5d3_processed_${randomUUID().replaceAll("-", "")}`
    );

    const reconciliation = await db
      .selectFrom("payment_reconciliation_cases")
      .select(["status", "required_action", "resolved_by_user_id", "resolution_code"])
      .where("id", "=", ready.refundRequest.reconciliation_case_id)
      .executeTakeFirstOrThrow();

    expect(reconciliation).toEqual({
      status: "RESOLVED",
      required_action: "REFUND_REQUIRED",
      resolved_by_user_id: null,
      resolution_code: "PROVIDER_REFUND_PROCESSED"
    });
  });
});

async function phase5e1JournalByPaymentEvidence(paymentEvidenceId: string) {
  return db
    .selectFrom("financial_ledger_journals")
    .selectAll()
    .where("payment_evidence_id", "=", paymentEvidenceId)
    .executeTakeFirstOrThrow();
}

async function phase5e1JournalEntries(journalId: string) {
  return db
    .selectFrom("financial_ledger_entries")
    .select(["line_number", "account_code", "direction", "amount_minor", "currency_code"])
    .where("journal_id", "=", journalId)
    .orderBy("line_number", "asc")
    .execute();
}

describe("Phase 5E1 immutable double-entry money movement ledger", () => {
  it("posts verified payment evidence immediately as guest funds held", async () => {
    const ready = await phase5c1ReadyEvidence();

    const journal = await phase5e1JournalByPaymentEvidence(ready.evidence.evidence.id);
    expect(journal).toMatchObject({
      organization_id: ready.fixture.organizationId,
      property_id: ready.fixture.propertyId,
      reservation_id: ready.held.reservation.id,
      payment_intent_id: ready.payment.paymentIntent.id,
      journal_type: "PAYMENT_RECEIVED",
      payment_evidence_id: ready.evidence.evidence.id,
      refund_finalization_id: null,
      amount_minor: ready.payment.paymentIntent.amountMinor,
      currency_code: ready.payment.paymentIntent.currencyCode
    });

    expect(await phase5e1JournalEntries(journal.id)).toEqual([
      {
        line_number: 1,
        account_code: "PAYMENT_PROVIDER_CLEARING",
        direction: "DEBIT",
        amount_minor: ready.payment.paymentIntent.amountMinor,
        currency_code: ready.payment.paymentIntent.currencyCode
      },
      {
        line_number: 2,
        account_code: "GUEST_FUNDS_HELD",
        direction: "CREDIT",
        amount_minor: ready.payment.paymentIntent.amountMinor,
        currency_code: ready.payment.paymentIntent.currencyCode
      }
    ]);

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();
    expect(reservation.status).toBe("PAYMENT_PENDING");
  });

  it("keeps the payment-received journal idempotent on exact evidence retry", async () => {
    const ready = await phase5c1ReadyEvidence();
    const evidence = ready.evidence.evidence;

    const retry = await db.transaction().execute((trx) =>
      new VerifiedPaymentEvidenceService().record(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id,
          provider: evidence.provider,
          providerEventId: evidence.providerEventId,
          providerPaymentId: evidence.providerPaymentId,
          providerOrderId: evidence.providerOrderId,
          amountMinor: evidence.amountMinor,
          currencyCode: evidence.currencyCode,
          verificationMethod: evidence.verificationMethod,
          payloadSha256: evidence.payloadSha256
        },
        metadata()
      )
    );

    expect(retry.created).toBe(false);
    expect(retry.evidence.id).toBe(evidence.id);

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("payment_evidence_id", "=", evidence.id)
      .execute();
    expect(journals).toHaveLength(1);

    const entries = await db
      .selectFrom("financial_ledger_entries")
      .select("id")
      .where("journal_id", "=", journals[0]!.id)
      .execute();
    expect(entries).toHaveLength(2);
  });

  it("posts a second receipt for a distinct duplicate verified payment", async () => {
    const ready = await phase5c1ReadyEvidence();

    const duplicate = await db.transaction().execute((trx) =>
      new VerifiedPaymentEvidenceService().record(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          paymentIntentId: ready.payment.paymentIntent.id,
          provider: "RAZORPAY",
          providerEventId: `evt_5e1_duplicate_${randomUUID().replaceAll("-", "")}`,
          providerPaymentId: `pay_5e1_duplicate_${randomUUID().replaceAll("-", "")}`,
          providerOrderId: `order_5e1_duplicate_${randomUUID().replaceAll("-", "")}`,
          amountMinor: ready.payment.paymentIntent.amountMinor,
          currencyCode: ready.payment.paymentIntent.currencyCode,
          verificationMethod: "WEBHOOK_SIGNATURE",
          payloadSha256: "a".repeat(64)
        },
        metadata()
      )
    );

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .select(["journal_type", "payment_evidence_id", "amount_minor"])
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .orderBy("created_at", "asc")
      .execute();

    expect(journals).toHaveLength(2);
    expect(journals).toEqual(
      expect.arrayContaining([
        {
          journal_type: "PAYMENT_RECEIVED",
          payment_evidence_id: ready.evidence.evidence.id,
          amount_minor: ready.payment.paymentIntent.amountMinor
        },
        {
          journal_type: "PAYMENT_RECEIVED",
          payment_evidence_id: duplicate.evidence.id,
          amount_minor: ready.payment.paymentIntent.amountMinor
        }
      ])
    );
  });

  it("does not invent another money movement when finance retains a manual-review payment", async () => {
    const ready = await phase5d3ReadyManualReview();

    const before = await db
      .selectFrom("financial_ledger_journals")
      .select(["id", "journal_type"])
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(before).toHaveLength(1);
    expect(before[0]?.journal_type).toBe("PAYMENT_RECEIVED");

    await phase5d3Resolve(
      ready,
      "Finance reviewed the verified payment and intentionally retained the guest funds."
    );

    const after = await db
      .selectFrom("financial_ledger_journals")
      .select(["id", "journal_type"])
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();

    expect(after).toEqual(before);
  });

  it("posts a processed refund as the exact reverse money movement", async () => {
    const ready = await phase5c3ReadySubmission();
    const raw = phase5c3RefundRawBody(ready, {
      eventType: "refund.processed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const result = await phase5c3Handle(
      raw,
      `evt_refund_5e1_processed_${randomUUID().replaceAll("-", "")}`
    );

    expect(result.refund!.finalizationStatus).toBe("PROCESSED");
    expect(result.refund!.finalizationId).toBeTruthy();

    const journal = await db
      .selectFrom("financial_ledger_journals")
      .selectAll()
      .where("refund_finalization_id", "=", result.refund!.finalizationId as string)
      .executeTakeFirstOrThrow();

    expect(journal).toMatchObject({
      journal_type: "REFUND_PROCESSED",
      payment_evidence_id: null,
      refund_finalization_id: result.refund!.finalizationId,
      payment_intent_id: ready.payment.paymentIntent.id,
      amount_minor: ready.refundRequest.amount_minor,
      currency_code: ready.refundRequest.currency_code
    });

    expect(await phase5e1JournalEntries(journal.id)).toEqual([
      {
        line_number: 1,
        account_code: "GUEST_FUNDS_HELD",
        direction: "DEBIT",
        amount_minor: ready.refundRequest.amount_minor,
        currency_code: ready.refundRequest.currency_code
      },
      {
        line_number: 2,
        account_code: "PAYMENT_PROVIDER_CLEARING",
        direction: "CREDIT",
        amount_minor: ready.refundRequest.amount_minor,
        currency_code: ready.refundRequest.currency_code
      }
    ]);

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .select("journal_type")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(journals).toHaveLength(2);
  });

  it("does not post money movement for a failed refund", async () => {
    const ready = await phase5c3ReadySubmission();
    const raw = phase5c3RefundRawBody(ready, {
      eventType: "refund.failed",
      providerRefundId: ready.submitted.submission.providerRefundId
    });

    const result = await phase5c3Handle(
      raw,
      `evt_refund_5e1_failed_${randomUUID().replaceAll("-", "")}`
    );

    expect(result.refund!.finalizationStatus).toBe("FAILED");
    expect(result.refund!.finalizationId).toBeTruthy();

    const refundJournals = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("refund_finalization_id", "=", result.refund!.finalizationId as string)
      .execute();
    expect(refundJournals).toHaveLength(0);

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .select("journal_type")
      .where("payment_intent_id", "=", ready.payment.paymentIntent.id)
      .execute();
    expect(journals).toEqual([{ journal_type: "PAYMENT_RECEIVED" }]);
  });

  it("keeps journal and entry history immutable at the database boundary", async () => {
    const ready = await phase5c1ReadyEvidence();
    const journal = await phase5e1JournalByPaymentEvidence(ready.evidence.evidence.id);
    const entries = await db
      .selectFrom("financial_ledger_entries")
      .select("id")
      .where("journal_id", "=", journal.id)
      .orderBy("line_number", "asc")
      .execute();

    await expect(
      db
        .updateTable("financial_ledger_journals")
        .set({ amount_minor: journal.amount_minor + 1 })
        .where("id", "=", journal.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("financial_ledger_entries").where("id", "=", entries[0]!.id).execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects an incomplete journal at the deferred database balance boundary", async () => {
    const ready = await phase5c1ReadyEvidence();
    const request = metadata();

    await expect(
      db.transaction().execute(async (trx) => {
        const evidenceId = randomUUID();
        const evidence = await trx
          .insertInto("payment_provider_evidence")
          .values({
            id: evidenceId,
            payment_intent_id: ready.payment.paymentIntent.id,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            provider: "RAZORPAY",
            provider_event_id: `evt_5e1_balance_${randomUUID().replaceAll("-", "")}`,
            provider_payment_id: `pay_5e1_balance_${randomUUID().replaceAll("-", "")}`,
            provider_order_id: null,
            amount_minor: ready.payment.paymentIntent.amountMinor,
            currency_code: ready.payment.paymentIntent.currencyCode,
            verification_method: "WEBHOOK_SIGNATURE",
            payload_sha256: "b".repeat(64),
            source: request.source,
            request_id: request.requestId,
            correlation_id: request.correlationId
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        const journalId = randomUUID();
        await trx
          .insertInto("financial_ledger_journals")
          .values({
            id: journalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            payment_intent_id: ready.payment.paymentIntent.id,
            journal_type: "PAYMENT_RECEIVED",
            payment_evidence_id: evidence.id,
            refund_finalization_id: null,
            amount_minor: evidence.amount_minor,
            currency_code: evidence.currency_code,
            occurred_at: evidence.received_at,
            source: request.source,
            request_id: request.requestId,
            correlation_id: request.correlationId
          })
          .execute();

        await trx
          .insertInto("financial_ledger_entries")
          .values({
            id: randomUUID(),
            journal_id: journalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            line_number: 1,
            account_code: "PAYMENT_PROVIDER_CLEARING",
            direction: "DEBIT",
            amount_minor: evidence.amount_minor,
            currency_code: evidence.currency_code
          })
          .execute();
      })
    ).rejects.toThrow(/exactly two balanced entries/i);
  });
});

describe("Phase 5E2A canonical stay lifecycle", () => {
  function lifecycleEvidenceInput(
    fixture: Fixture,
    payment: Awaited<ReturnType<typeof beginPayment>>
  ) {
    return {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      reservationId: payment.reservation.id,
      paymentIntentId: payment.paymentIntent.id,
      provider: "RAZORPAY",
      providerEventId: `evt_${randomUUID()}`,
      providerPaymentId: `pay_${randomUUID()}`,
      providerOrderId: `order_${randomUUID()}`,
      amountMinor: payment.paymentIntent.amountMinor,
      currencyCode: payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE" as const,
      payloadSha256: "5".repeat(64)
    };
  }

  function frontDeskActor(fixture: Fixture): ActorContext {
    return {
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
  }

  function financeActor(fixture: Fixture): ActorContext {
    return {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "FINANCE"
        }
      ]
    };
  }

  async function confirmedStayFixture() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");

    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const payment = await beginPayment(fixture, held.reservation.id);

    const evidence = await db
      .transaction()
      .execute((trx) =>
        new VerifiedPaymentEvidenceService().record(
          trx,
          lifecycleEvidenceInput(fixture, payment),
          metadata()
        )
      );

    const processed = await db.transaction().execute((trx) =>
      new VerifiedPaymentProcessor().process(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id,
          paymentIntentId: payment.paymentIntent.id,
          paymentEvidenceId: evidence.evidence.id
        },
        metadata()
      )
    );

    expect(processed.outcome).toBe("RESERVATION_CONFIRMED");

    return {
      fixture,
      held,
      payment,
      evidence,
      processed
    };
  }

  async function checkIn(
    ready: Awaited<ReturnType<typeof confirmedStayFixture>>,
    actor: ActorContext,
    service = new StayLifecycleService()
  ) {
    return db.transaction().execute((trx) =>
      service.checkIn(
        trx,
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );
  }

  async function checkOut(
    ready: Awaited<ReturnType<typeof confirmedStayFixture>>,
    actor: ActorContext,
    service = new StayLifecycleService()
  ) {
    return db.transaction().execute((trx) =>
      service.checkOut(
        trx,
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );
  }

  it("Phase 7E1A reports canonical confirmed room occupancy", async () => {
    const ready = await confirmedStayFixture();

    const report = await new OwnerReportService().occupancy(db, ready.fixture.actor, {
      organizationId: ready.fixture.organizationId,
      propertyId: ready.fixture.propertyId,
      startDate: ready.held.reservation.arrivalDate,
      endDate: ready.held.reservation.departureDate
    });

    expect(report).toMatchObject({
      propertyId: ready.fixture.propertyId,
      startDate: "2034-02-10",
      endDate: "2034-02-12",
      nights: 2,
      capacityBasis: "CURRENT_ACTIVE_PHYSICAL_UNITS",
      confirmedReservationCount: 1,
      capacityRoomNights: 4,
      confirmedRoomNights: 2,
      confirmedOccupancyBps: 5000
    });

    expect(report.days).toEqual([
      {
        date: "2034-02-10",
        capacityRooms: 2,
        confirmedRooms: 1,
        confirmedOccupancyBps: 5000
      },
      {
        date: "2034-02-11",
        capacityRooms: 2,
        confirmedRooms: 1,
        confirmedOccupancyBps: 5000
      }
    ]);
  });
  it("lets FRONT_DESK check in a confirmed reservation and records one canonical boundary", async () => {
    const ready = await confirmedStayFixture();
    const actor = frontDeskActor(ready.fixture);

    const result = await checkIn(ready, actor);

    expect(result.transitioned).toBe(true);
    expect(result.reservation.status).toBe("CHECKED_IN");

    const history = await db
      .selectFrom("reservation_status_history")
      .select(["from_status", "to_status", "reason", "actor_user_id"])
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("to_status", "=", "CHECKED_IN")
      .executeTakeFirstOrThrow();

    expect(history).toEqual({
      from_status: "CONFIRMED",
      to_status: "CHECKED_IN",
      reason: "FRONT_DESK_CHECK_IN",
      actor_user_id: actor.userId
    });

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "reservation")
      .where("entity_id", "=", ready.held.reservation.id)
      .where("action", "=", "reservation.checked_in")
      .executeTakeFirstOrThrow();

    expect(audit.action).toBe("reservation.checked_in");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "reservation")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "reservation.checked_in.v1")
      .executeTakeFirstOrThrow();

    expect(outbox.event_type).toBe("reservation.checked_in.v1");
  });

  it("replays check-in semantically without duplicating history, audit or outbox effects", async () => {
    const ready = await confirmedStayFixture();
    const actor = frontDeskActor(ready.fixture);

    const first = await checkIn(ready, actor);
    const second = await checkIn(ready, actor);

    expect(first.transitioned).toBe(true);
    expect(second.transitioned).toBe(false);
    expect(second.reservation.status).toBe("CHECKED_IN");

    const [history, audits, outbox] = await Promise.all([
      db
        .selectFrom("reservation_status_history")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .where("to_status", "=", "CHECKED_IN")
        .execute(),
      db
        .selectFrom("audit_events")
        .select("id")
        .where("entity_type", "=", "reservation")
        .where("entity_id", "=", ready.held.reservation.id)
        .where("action", "=", "reservation.checked_in")
        .execute(),
      db
        .selectFrom("outbox_events")
        .select("id")
        .where("aggregate_type", "=", "reservation")
        .where("aggregate_id", "=", ready.held.reservation.id)
        .where("event_type", "=", "reservation.checked_in.v1")
        .execute()
    ]);

    expect(history).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });

  it("rejects checkout before check-in and leaves a confirmed reservation unchanged", async () => {
    const ready = await confirmedStayFixture();
    const actor = frontDeskActor(ready.fixture);

    await expect(checkOut(ready, actor)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");
  });

  it("does not let a FINANCE property role mutate the stay lifecycle", async () => {
    const ready = await confirmedStayFixture();
    const actor = financeActor(ready.fixture);

    await expect(checkIn(ready, actor)).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");
  });

  it("records CHECKED_OUT as an immutable stay-completion boundary without moving money", async () => {
    const ready = await confirmedStayFixture();
    const actor = frontDeskActor(ready.fixture);

    const ledgerBefore = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    await checkIn(ready, actor);
    const result = await checkOut(ready, actor);

    expect(result.transitioned).toBe(true);
    expect(result.reservation.status).toBe("CHECKED_OUT");

    const checkoutHistory = await db
      .selectFrom("reservation_status_history")
      .select(["id", "from_status", "to_status", "reason", "actor_user_id", "created_at"])
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("to_status", "=", "CHECKED_OUT")
      .executeTakeFirstOrThrow();

    expect(checkoutHistory.from_status).toBe("CHECKED_IN");
    expect(checkoutHistory.to_status).toBe("CHECKED_OUT");
    expect(checkoutHistory.reason).toBe("FRONT_DESK_CHECK_OUT");
    expect(checkoutHistory.actor_user_id).toBe(actor.userId);
    expect(checkoutHistory.created_at).toBeInstanceOf(Date);

    await expect(
      db
        .updateTable("reservation_status_history")
        .set({ reason: "MUTATION_MUST_FAIL" })
        .where("id", "=", checkoutHistory.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("reservation_status_history").where("id", "=", checkoutHistory.id).execute()
    ).rejects.toThrow(/immutable/i);

    const ledgerAfter = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(ledgerAfter).toHaveLength(ledgerBefore.length);

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "reservation")
      .where("entity_id", "=", ready.held.reservation.id)
      .where("action", "=", "reservation.checked_out")
      .executeTakeFirstOrThrow();

    expect(audit.action).toBe("reservation.checked_out");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "reservation")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "reservation.checked_out.v1")
      .executeTakeFirstOrThrow();

    expect(outbox.event_type).toBe("reservation.checked_out.v1");
  });

  it("replays checkout semantically without duplicating the stay-completion boundary", async () => {
    const ready = await confirmedStayFixture();
    const actor = frontDeskActor(ready.fixture);

    await checkIn(ready, actor);
    const first = await checkOut(ready, actor);
    const second = await checkOut(ready, actor);

    expect(first.transitioned).toBe(true);
    expect(second.transitioned).toBe(false);
    expect(second.reservation.status).toBe("CHECKED_OUT");

    const [history, audits, outbox] = await Promise.all([
      db
        .selectFrom("reservation_status_history")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .where("to_status", "=", "CHECKED_OUT")
        .execute(),
      db
        .selectFrom("audit_events")
        .select("id")
        .where("entity_type", "=", "reservation")
        .where("entity_id", "=", ready.held.reservation.id)
        .where("action", "=", "reservation.checked_out")
        .execute(),
      db
        .selectFrom("outbox_events")
        .select("id")
        .where("aggregate_type", "=", "reservation")
        .where("aggregate_id", "=", ready.held.reservation.id)
        .where("event_type", "=", "reservation.checked_out.v1")
        .execute()
    ]);

    expect(history).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
  });
});
describe("Phase 5E2B1 immutable revenue recognition schedule foundation", () => {
  it("derives final net revenue from discounted stay, inclusive fees and embedded tax", () => {
    const built = buildRevenueRecognitionBasis({
      currencyCode: "INR",
      acceptedTotalMinor: 10_900,
      grossAccommodationMinor: 10_000,
      grossExtraGuestMinor: 1_000,
      accommodationDiscountMinor: 1_000,
      extraGuestDiscountMinor: 100,
      inclusiveFeeMinor: 900,
      exclusiveFeeMinor: 500,
      inclusiveTaxMinor: 900,
      exclusiveTaxMinor: 500,
      taxMinor: 1_400,
      quoteNights: [
        {
          id: "night-1",
          stayDate: "2034-02-10",
          accommodationMinor: 6_000,
          extraGuestMinor: 1_000
        },
        {
          id: "night-2",
          stayDate: "2034-02-11",
          accommodationMinor: 4_000,
          extraGuestMinor: 0
        }
      ],
      feeLines: [
        {
          id: "fee-inclusive",
          lineKey: "fee-inclusive",
          stayDate: null,
          priceMode: "INCLUSIVE",
          feeMinor: 900
        },
        {
          id: "fee-exclusive",
          lineKey: "fee-exclusive",
          stayDate: "2034-02-11",
          priceMode: "EXCLUSIVE",
          feeMinor: 500
        }
      ],
      taxLines: [
        {
          id: "tax-a1-inclusive",
          priceMode: "INCLUSIVE",
          chargeType: "ACCOMMODATION",
          stayDate: "2034-02-10",
          finalFeeLineId: null,
          taxMinor: 400
        },
        {
          id: "tax-e1-inclusive",
          priceMode: "INCLUSIVE",
          chargeType: "EXTRA_GUEST",
          stayDate: "2034-02-10",
          finalFeeLineId: null,
          taxMinor: 50
        },
        {
          id: "tax-a2-inclusive",
          priceMode: "INCLUSIVE",
          chargeType: "ACCOMMODATION",
          stayDate: "2034-02-11",
          finalFeeLineId: null,
          taxMinor: 250
        },
        {
          id: "tax-fee-inclusive",
          priceMode: "INCLUSIVE",
          chargeType: "FEE",
          stayDate: null,
          finalFeeLineId: "fee-inclusive",
          taxMinor: 100
        },
        {
          id: "tax-fee-exclusive-embedded",
          priceMode: "INCLUSIVE",
          chargeType: "FEE",
          stayDate: "2034-02-11",
          finalFeeLineId: "fee-exclusive",
          taxMinor: 100
        },
        {
          id: "tax-a1-exclusive",
          priceMode: "EXCLUSIVE",
          chargeType: "ACCOMMODATION",
          stayDate: "2034-02-10",
          finalFeeLineId: null,
          taxMinor: 300
        },
        {
          id: "tax-a2-exclusive",
          priceMode: "EXCLUSIVE",
          chargeType: "ACCOMMODATION",
          stayDate: "2034-02-11",
          finalFeeLineId: null,
          taxMinor: 200
        }
      ]
    });

    expect(built).toMatchObject({
      allocationVersion: "REVENUE_BASIS_V1",
      acceptedTotalMinor: 10_900,
      considerationMinor: 10_400,
      inclusiveTaxMinor: 900,
      exclusiveTaxMinor: 500,
      taxMinor: 1_400,
      revenueBasisMinor: 9_500
    });
    expect(built.lines).toHaveLength(6);

    expect(
      built.lines.find(
        (line) => line.lineType === "ACCOMMODATION" && line.stayDate === "2034-02-10"
      )
    ).toMatchObject({
      considerationMinor: 4_909,
      inclusiveTaxMinor: 400,
      revenueMinor: 4_509
    });
    expect(
      built.lines.find((line) => line.lineType === "EXTRA_GUEST" && line.stayDate === "2034-02-10")
    ).toMatchObject({
      considerationMinor: 818,
      inclusiveTaxMinor: 50,
      revenueMinor: 768
    });
    expect(
      built.lines.find(
        (line) => line.lineType === "ACCOMMODATION" && line.stayDate === "2034-02-11"
      )
    ).toMatchObject({
      considerationMinor: 3_273,
      inclusiveTaxMinor: 250,
      revenueMinor: 3_023
    });
    expect(built.lines.find((line) => line.sourceFinalFeeLineId === "fee-inclusive")).toMatchObject(
      {
        serviceScope: "STAY",
        considerationMinor: 900,
        inclusiveTaxMinor: 100,
        revenueMinor: 800
      }
    );
    expect(built.lines.find((line) => line.sourceFinalFeeLineId === "fee-exclusive")).toMatchObject(
      {
        serviceScope: "NIGHT",
        considerationMinor: 500,
        inclusiveTaxMinor: 100,
        revenueMinor: 400
      }
    );
  });

  async function scheduleFixture() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    return { fixture, quoted, held };
  }

  it("persists an immutable accepted revenue basis without recognizing revenue or moving money", async () => {
    const { fixture, held } = await scheduleFixture();

    const ledgerBefore = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .execute();

    const result = await db.transaction().execute((trx) =>
      new RevenueRecognitionScheduleService().ensureForReservation(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );

    expect(result.created).toBe(true);
    expect(result.schedule).toMatchObject({
      reservationId: held.reservation.id,
      quoteId: held.reservation.quoteId,
      allocationVersion: "REVENUE_BASIS_V1",
      currencyCode: "INR",
      acceptedTotalMinor: held.reservation.totalMinor,
      considerationMinor: held.reservation.totalMinor,
      inclusiveTaxMinor: 0,
      exclusiveTaxMinor: 0,
      taxMinor: 0,
      revenueBasisMinor: held.reservation.totalMinor,
      lineCount: 4
    });
    expect(result.schedule.lines.map((line) => line.lineType)).toEqual([
      "ACCOMMODATION",
      "EXTRA_GUEST",
      "ACCOMMODATION",
      "EXTRA_GUEST"
    ]);

    const storedReservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", held.reservation.id)
      .executeTakeFirstOrThrow();
    expect(storedReservation.status).toBe("HELD");

    const ledgerAfter = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .execute();
    expect(ledgerAfter).toEqual(ledgerBefore);
  });

  it("returns the same immutable schedule on an exact retry", async () => {
    const { fixture, held } = await scheduleFixture();
    const service = new RevenueRecognitionScheduleService();

    const first = await db.transaction().execute((trx) =>
      service.ensureForReservation(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );
    const second = await db.transaction().execute((trx) =>
      service.ensureForReservation(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.schedule.id).toBe(first.schedule.id);
    expect(second.schedule.lines.map((line) => line.id)).toEqual(
      first.schedule.lines.map((line) => line.id)
    );

    const schedules = await db
      .selectFrom("reservation_revenue_schedules")
      .select("id")
      .where("reservation_id", "=", held.reservation.id)
      .execute();
    expect(schedules).toHaveLength(1);
  });

  it("protects the persisted revenue schedule and lines from mutation", async () => {
    const { fixture, held } = await scheduleFixture();

    const result = await db.transaction().execute((trx) =>
      new RevenueRecognitionScheduleService().ensureForReservation(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );

    await expect(
      db
        .updateTable("reservation_revenue_schedules")
        .set({ revenue_basis_minor: result.schedule.revenueBasisMinor + 1 })
        .where("id", "=", result.schedule.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    const firstLine = result.schedule.lines[0]!;
    await expect(
      db.deleteFrom("reservation_revenue_schedule_lines").where("id", "=", firstLine.id).execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a schedule header that does not match the accepted financial snapshot", async () => {
    const { fixture, held } = await scheduleFixture();
    const financial = await db
      .selectFrom("reservation_financial_snapshots")
      .selectAll()
      .where("reservation_id", "=", held.reservation.id)
      .executeTakeFirstOrThrow();

    await expect(
      db.transaction().execute(async (trx) => {
        await trx
          .insertInto("reservation_revenue_schedules")
          .values({
            id: randomUUID(),
            organization_id: fixture.organizationId,
            property_id: fixture.propertyId,
            reservation_id: held.reservation.id,
            reservation_financial_snapshot_id: financial.id,
            quote_id: held.reservation.quoteId,
            allocation_version: "REVENUE_BASIS_V1",
            currency_code: financial.currency_code,
            accepted_total_minor: financial.total_minor + 1,
            consideration_minor: financial.total_minor + 1,
            inclusive_tax_minor: 0,
            exclusive_tax_minor: 0,
            tax_minor: 0,
            revenue_basis_minor: financial.total_minor + 1,
            line_count: 0,
            source: "integration-test",
            request_id: randomUUID(),
            correlation_id: randomUUID()
          })
          .execute();
      })
    ).rejects.toThrow(/accepted financial snapshot/i);
  });
});

describe("Phase 5E2B2 revenue ledger posting", () => {
  function revenueEvidenceInput(
    fixture: Fixture,
    payment: Awaited<ReturnType<typeof beginPayment>>
  ) {
    return {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      reservationId: payment.reservation.id,
      paymentIntentId: payment.paymentIntent.id,
      provider: "RAZORPAY",
      providerEventId: `evt_${randomUUID()}`,
      providerPaymentId: `pay_${randomUUID()}`,
      providerOrderId: `order_${randomUUID()}`,
      amountMinor: payment.paymentIntent.amountMinor,
      currencyCode: payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE" as const,
      payloadSha256: "6".repeat(64)
    };
  }

  function revenueFrontDeskActor(fixture: Fixture): ActorContext {
    return {
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
  }

  async function confirmedRevenueFixture() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const payment = await beginPayment(fixture, held.reservation.id);
    const evidence = await db
      .transaction()
      .execute((trx) =>
        new VerifiedPaymentEvidenceService().record(
          trx,
          revenueEvidenceInput(fixture, payment),
          metadata()
        )
      );
    const processed = await db.transaction().execute((trx) =>
      new VerifiedPaymentProcessor().process(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id,
          paymentIntentId: payment.paymentIntent.id,
          paymentEvidenceId: evidence.evidence.id
        },
        metadata()
      )
    );
    expect(processed.outcome).toBe("RESERVATION_CONFIRMED");
    return { fixture, held, payment, evidence, processed };
  }

  async function checkedOutRevenueFixture() {
    const ready = await confirmedRevenueFixture();
    const actor = revenueFrontDeskActor(ready.fixture);
    const lifecycle = new StayLifecycleService();

    await db.transaction().execute((trx) =>
      lifecycle.checkIn(
        trx,
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );

    await db.transaction().execute((trx) =>
      lifecycle.checkOut(
        trx,
        actor,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );

    return ready;
  }

  async function postRevenue(
    ready: Awaited<ReturnType<typeof confirmedRevenueFixture>>,
    service = new RevenueLedgerPostingService()
  ) {
    return db.transaction().execute((trx) =>
      service.postForCheckedOutReservation(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );
  }

  it("derives NIGHT and STAY accounting dates from immutable service periods", () => {
    expect(
      revenueRecognitionDateForLine({ serviceScope: "NIGHT", stayDate: "2034-02-10" }, "2034-02-12")
    ).toBe("2034-02-10");
    expect(
      revenueRecognitionDateForLine({ serviceScope: "STAY", stayDate: null }, "2034-02-12")
    ).toBe("2034-02-12");
  });

  it("refuses revenue posting before checkout and does not create a revenue schedule as a side effect", async () => {
    const ready = await confirmedRevenueFixture();

    await expect(postRevenue(ready)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const [schedules, revenueJournals] = await Promise.all([
      db
        .selectFrom("reservation_revenue_schedules")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .execute(),
      db
        .selectFrom("financial_ledger_journals")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .where("journal_type", "=", "REVENUE_RECOGNIZED")
        .execute()
    ]);

    expect(schedules).toHaveLength(0);
    expect(revenueJournals).toHaveLength(0);
  });

  it("posts checked-out stay revenue from positive schedule lines into balanced double-entry journals", async () => {
    const ready = await checkedOutRevenueFixture();
    const result = await postRevenue(ready);

    expect(result.revenueBasisMinor).toBe(ready.held.reservation.totalMinor);
    expect(result.journalCount).toBe(2);
    expect(result.createdJournalCount).toBe(2);

    const checkoutHistory = await db
      .selectFrom("reservation_status_history")
      .selectAll()
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("from_status", "=", "CHECKED_IN")
      .where("to_status", "=", "CHECKED_OUT")
      .where("reason", "=", "FRONT_DESK_CHECK_OUT")
      .executeTakeFirstOrThrow();

    const scheduleLines = await db
      .selectFrom("reservation_revenue_schedule_lines")
      .selectAll()
      .where("schedule_id", "=", result.scheduleId)
      .orderBy("line_number", "asc")
      .execute();
    const positiveLines = scheduleLines.filter((line) => line.revenue_minor > 0);
    expect(positiveLines).toHaveLength(2);

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .selectAll()
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("journal_type", "=", "REVENUE_RECOGNIZED")
      .orderBy("recognition_date", "asc")
      .execute();
    expect(journals).toHaveLength(2);

    for (const journal of journals) {
      expect(journal.payment_intent_id).toBeNull();
      expect(journal.payment_evidence_id).toBeNull();
      expect(journal.refund_finalization_id).toBeNull();
      expect(journal.stay_completion_history_id).toBe(checkoutHistory.id);
      expect(journal.occurred_at.getTime()).toBe(checkoutHistory.created_at.getTime());

      const line = positiveLines.find(
        (candidate) => candidate.id === journal.revenue_schedule_line_id
      );
      expect(line).toBeTruthy();
      expect(journal.amount_minor).toBe(line!.revenue_minor);
      expect(journal.recognition_date).toBe(line!.stay_date);

      const entries = await db
        .selectFrom("financial_ledger_entries")
        .select(["line_number", "account_code", "direction", "amount_minor"])
        .where("journal_id", "=", journal.id)
        .orderBy("line_number", "asc")
        .execute();

      expect(entries).toEqual([
        {
          line_number: 1,
          account_code: "GUEST_FUNDS_HELD",
          direction: "DEBIT",
          amount_minor: journal.amount_minor
        },
        {
          line_number: 2,
          account_code: "STAY_REVENUE",
          direction: "CREDIT",
          amount_minor: journal.amount_minor
        }
      ]);
    }

    const paymentJournal = await db
      .selectFrom("financial_ledger_journals")
      .selectAll()
      .where("payment_evidence_id", "=", ready.evidence.evidence.id)
      .executeTakeFirstOrThrow();
    expect(paymentJournal.journal_type).toBe("PAYMENT_RECEIVED");
    expect(paymentJournal.payment_intent_id).toBe(ready.payment.paymentIntent.id);
    expect(paymentJournal.revenue_schedule_line_id).toBeNull();
    expect(paymentJournal.stay_completion_history_id).toBeNull();
    expect(paymentJournal.recognition_date).toBeNull();
  });

  it("replays exact revenue posting without creating duplicate journals", async () => {
    const ready = await checkedOutRevenueFixture();
    const service = new RevenueLedgerPostingService();
    const first = await postRevenue(ready, service);
    const second = await postRevenue(ready, service);

    expect(first.createdJournalCount).toBe(2);
    expect(second.createdJournalCount).toBe(0);
    expect(second.journalCount).toBe(first.journalCount);
    expect(second.journals.map((journal) => journal.id)).toEqual(
      first.journals.map((journal) => journal.id)
    );

    const journals = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("journal_type", "=", "REVENUE_RECOGNIZED")
      .execute();
    expect(journals).toHaveLength(2);
  });

  it("rejects a checked-out status that lacks the immutable canonical checkout history", async () => {
    const ready = await confirmedRevenueFixture();
    await db
      .updateTable("reservations")
      .set({ status: "CHECKED_OUT" })
      .where("id", "=", ready.held.reservation.id)
      .execute();

    await expect(postRevenue(ready)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const revenueJournals = await db
      .selectFrom("financial_ledger_journals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("journal_type", "=", "REVENUE_RECOGNIZED")
      .execute();
    expect(revenueJournals).toHaveLength(0);
  });

  it("protects posted revenue journals and entries from mutation", async () => {
    const ready = await checkedOutRevenueFixture();
    const result = await postRevenue(ready);
    const journal = result.journals[0]!;

    await expect(
      db
        .updateTable("financial_ledger_journals")
        .set({ amount_minor: journal.amountMinor + 1 })
        .where("id", "=", journal.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .deleteFrom("financial_ledger_entries")
        .where("journal_id", "=", journal.id)
        .where("line_number", "=", 1)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a forged revenue journal whose recognition date disagrees with the immutable schedule line", async () => {
    const ready = await checkedOutRevenueFixture();
    const schedule = await db.transaction().execute((trx) =>
      new RevenueRecognitionScheduleService().ensureForReservation(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );
    const line = schedule.schedule.lines.find((candidate) => candidate.revenueMinor > 0)!;
    const checkoutHistory = await db
      .selectFrom("reservation_status_history")
      .selectAll()
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("to_status", "=", "CHECKED_OUT")
      .executeTakeFirstOrThrow();

    await expect(
      db.transaction().execute(async (trx) => {
        const journalId = randomUUID();
        await trx
          .insertInto("financial_ledger_journals")
          .values({
            id: journalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            payment_intent_id: null,
            journal_type: "REVENUE_RECOGNIZED",
            payment_evidence_id: null,
            refund_finalization_id: null,
            revenue_schedule_line_id: line.id,
            stay_completion_history_id: checkoutHistory.id,
            recognition_date: "2034-02-09",
            amount_minor: line.revenueMinor,
            currency_code: line.currencyCode,
            occurred_at: checkoutHistory.created_at,
            source: "integration-test",
            request_id: randomUUID(),
            correlation_id: randomUUID()
          })
          .execute();
        await trx
          .insertInto("financial_ledger_entries")
          .values([
            {
              id: randomUUID(),
              journal_id: journalId,
              organization_id: ready.fixture.organizationId,
              property_id: ready.fixture.propertyId,
              line_number: 1,
              account_code: "GUEST_FUNDS_HELD",
              direction: "DEBIT",
              amount_minor: line.revenueMinor,
              currency_code: line.currencyCode
            },
            {
              id: randomUUID(),
              journal_id: journalId,
              organization_id: ready.fixture.organizationId,
              property_id: ready.fixture.propertyId,
              line_number: 2,
              account_code: "STAY_REVENUE",
              direction: "CREDIT",
              amount_minor: line.revenueMinor,
              currency_code: line.currencyCode
            }
          ])
          .execute();
      })
    ).rejects.toThrow(/recognition date/i);
  });
});

describe("Phase 5E3 immutable post-stay revenue reversal", () => {
  function reversalEvidenceInput(
    fixture: Fixture,
    payment: Awaited<ReturnType<typeof beginPayment>>
  ) {
    return {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      reservationId: payment.reservation.id,
      paymentIntentId: payment.paymentIntent.id,
      provider: "RAZORPAY",
      providerEventId: `evt_${randomUUID()}`,
      providerPaymentId: `pay_${randomUUID()}`,
      providerOrderId: `order_${randomUUID()}`,
      amountMinor: payment.paymentIntent.amountMinor,
      currencyCode: payment.paymentIntent.currencyCode,
      verificationMethod: "WEBHOOK_SIGNATURE" as const,
      payloadSha256: "7".repeat(64)
    };
  }

  function reversalFrontDeskActor(fixture: Fixture): ActorContext {
    return {
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
  }

  function reversalFinanceActor(fixture: Fixture): ActorContext {
    return {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: ["FINANCE_MANAGER"],
      organizationMemberships: [],
      propertyGrants: []
    };
  }

  async function checkedOutForReversal() {
    const fixture = await createFixture();
    await configureCommercialCore(fixture);
    await setPromotionMode(fixture, "NO_PROMOTIONS");
    const quoted = await createFinalQuote(fixture);
    await createQuoteHold(fixture, quoted.quote.id);
    const held = await createHeldReservation(fixture, quoted.quote.id);
    const payment = await beginPayment(fixture, held.reservation.id);

    const evidence = await db
      .transaction()
      .execute((trx) =>
        new VerifiedPaymentEvidenceService().record(
          trx,
          reversalEvidenceInput(fixture, payment),
          metadata()
        )
      );

    const processed = await db.transaction().execute((trx) =>
      new VerifiedPaymentProcessor().process(
        trx,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id,
          paymentIntentId: payment.paymentIntent.id,
          paymentEvidenceId: evidence.evidence.id
        },
        metadata()
      )
    );
    expect(processed.outcome).toBe("RESERVATION_CONFIRMED");

    const lifecycle = new StayLifecycleService();
    const frontDesk = reversalFrontDeskActor(fixture);

    await db.transaction().execute((trx) =>
      lifecycle.checkIn(
        trx,
        frontDesk,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );

    await db.transaction().execute((trx) =>
      lifecycle.checkOut(
        trx,
        frontDesk,
        {
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: held.reservation.id
        },
        metadata()
      )
    );

    return { fixture, held, payment, evidence };
  }

  async function markPortfolioPropertyLive(fixture: Fixture, name: string) {
    const now = new Date();

    return db
      .updateTable("properties")
      .set({
        name,
        status: "LIVE",
        public_slug: `phase7e1c-${randomUUID()}`,
        approved_at: now,
        live_at: now
      })
      .where("organization_id", "=", fixture.organizationId)
      .where("id", "=", fixture.propertyId)
      .returning(["id", "name", "timezone"])
      .executeTakeFirstOrThrow();
  }

  async function createPortfolioProperty(
    fixture: Fixture,
    options: {
      name: string;
      activeRooms: number;
      live: boolean;
    }
  ) {
    const created = await db.transaction().execute((trx) =>
      new CreatePropertyDraftService().execute(
        trx,
        fixture.actor,
        {
          organizationId: fixture.organizationId,
          name: options.name,
          timezone: "Asia/Kolkata"
        },
        metadata()
      )
    );

    const propertyId = created.property.id;

    if (options.activeRooms > 0) {
      await db
        .updateTable("properties")
        .set({
          property_type: "HOTEL",
          sale_mode: "ROOMS_ONLY"
        })
        .where("organization_id", "=", fixture.organizationId)
        .where("id", "=", propertyId)
        .execute();

      const setup = new PropertySetupService();
      const marker = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();

      const category = await db.transaction().execute((trx) =>
        setup.createRoomCategory(
          trx,
          fixture.actor,
          {
            organizationId: fixture.organizationId,
            propertyId,
            code: `P7C${marker}`,
            name: `${options.name} Rooms`,
            accommodationType: "ROOM",
            description: null,
            baseOccupancy: 2,
            maxAdults: 3,
            maxChildren: 2,
            maxOccupancy: 4,
            sizeSqm: 28,
            bedConfiguration: "1 King Bed",
            extraBedAllowed: true,
            defaultViewLabel: "Portfolio View",
            sortOrder: 1
          },
          metadata()
        )
      );

      for (let index = 1; index <= options.activeRooms; index++) {
        await db.transaction().execute((trx) =>
          setup.createPhysicalUnit(
            trx,
            fixture.actor,
            {
              organizationId: fixture.organizationId,
              propertyId,
              roomCategoryId: category.roomCategory.id,
              structureId: null,
              floorId: null,
              unitCode: `P7C-${marker}-${index}`,
              displayName: `${options.name} Room ${index}`,
              hasView: true,
              viewLabel: "Portfolio View",
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
    }

    if (options.live) {
      const now = new Date();

      await db
        .updateTable("properties")
        .set({
          status: "LIVE",
          public_slug: `phase7e1c-${randomUUID()}`,
          approved_at: now,
          live_at: now
        })
        .where("organization_id", "=", fixture.organizationId)
        .where("id", "=", propertyId)
        .execute();
    }

    return {
      propertyId,
      name: options.name,
      timezone: "Asia/Kolkata"
    };
  }
  async function recognizedForReversal() {
    const ready = await checkedOutForReversal();
    const posted = await db.transaction().execute((trx) =>
      new RevenueLedgerPostingService().postForCheckedOutReservation(
        trx,
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );

    return { ...ready, posted };
  }

  async function reverseOne(
    ready: Awaited<ReturnType<typeof recognizedForReversal>>,
    options: {
      operationId?: string;
      actor?: ActorContext;
      revenueScheduleLineId?: string;
      amountMinor?: number;
      reasonCode?: string;
      note?: string;
    } = {}
  ) {
    const source = ready.posted.journals[0]!;
    const sourceLineId = options.revenueScheduleLineId ?? source.revenueScheduleLineId!;
    const amountMinor = options.amountMinor ?? Math.min(100_000, source.amountMinor);

    return db.transaction().execute((trx) =>
      new RevenueReversalService().ensure(
        trx,
        options.actor ?? reversalFinanceActor(ready.fixture),
        {
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          reservationId: ready.held.reservation.id,
          operationId: options.operationId ?? randomUUID(),
          reasonCode: options.reasonCode ?? "SERVICE_RECOVERY",
          note: options.note ?? "Approved post-stay commercial revenue adjustment.",
          lines: [{ revenueScheduleLineId: sourceLineId, amountMinor }]
        },
        metadata()
      )
    );
  }

  it("Phase 7E1B reports canonical recognized revenue and property-local reversals", async () => {
    const ready = await recognizedForReversal();
    const reversal = await reverseOne(ready);

    const recognizedReport = await new OwnerReportService().recognizedRevenue(
      db,
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        startDate: ready.held.reservation.arrivalDate,
        endDate: ready.held.reservation.departureDate
      }
    );

    expect(recognizedReport).toMatchObject({
      propertyId: ready.fixture.propertyId,
      startDate: "2034-02-10",
      endDate: "2034-02-12",
      timezone: "Asia/Kolkata",
      currencyCode: ready.payment.paymentIntent.currencyCode,
      recognizedRevenueMinor: ready.posted.revenueBasisMinor,
      reversedRevenueMinor: 0,
      netRecognizedRevenueMinor: ready.posted.revenueBasisMinor
    });

    const recognizedByDate = new Map<string, number>();

    for (const journal of ready.posted.journals) {
      expect(journal.journalType).toBe("REVENUE_RECOGNIZED");
      expect(journal.recognitionDate).not.toBeNull();

      const date = journal.recognitionDate!;
      recognizedByDate.set(date, (recognizedByDate.get(date) ?? 0) + journal.amountMinor);
    }

    expect(recognizedReport.days).toEqual([
      {
        date: "2034-02-10",
        recognizedRevenueMinor: recognizedByDate.get("2034-02-10") ?? 0,
        reversedRevenueMinor: 0,
        netRecognizedRevenueMinor: recognizedByDate.get("2034-02-10") ?? 0
      },
      {
        date: "2034-02-11",
        recognizedRevenueMinor: recognizedByDate.get("2034-02-11") ?? 0,
        reversedRevenueMinor: 0,
        netRecognizedRevenueMinor: recognizedByDate.get("2034-02-11") ?? 0
      }
    ]);

    const paymentJournal = await db
      .selectFrom("financial_ledger_journals")
      .select(["journal_type", "amount_minor"])
      .where("payment_evidence_id", "=", ready.evidence.evidence.id)
      .executeTakeFirstOrThrow();

    expect(paymentJournal).toEqual({
      journal_type: "PAYMENT_RECEIVED",
      amount_minor: ready.payment.paymentIntent.amountMinor
    });

    expect(recognizedReport.recognizedRevenueMinor).toBe(ready.payment.paymentIntent.amountMinor);

    const property = await db
      .selectFrom("properties")
      .select("timezone")
      .where("organization_id", "=", ready.fixture.organizationId)
      .where("id", "=", ready.fixture.propertyId)
      .executeTakeFirstOrThrow();

    const reversalJournal = reversal.journals[0]!;
    expect(reversalJournal.journalType).toBe("REVENUE_REVERSED");
    expect(reversalJournal.recognitionDate).toBeNull();

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: property.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(reversalJournal.occurredAt));

    const datePart = (type: "year" | "month" | "day") => {
      const part = parts.find((candidate) => candidate.type === type);
      expect(part).toBeDefined();
      return part!.value;
    };

    const reversalDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;

    const reversalEndDate = new Date(
      new Date(`${reversalDate}T00:00:00.000Z`).getTime() + 86_400_000
    )
      .toISOString()
      .slice(0, 10);

    const reversalReport = await new OwnerReportService().recognizedRevenue(
      db,
      ready.fixture.actor,
      {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        startDate: reversalDate,
        endDate: reversalEndDate
      }
    );

    const recognizedOnReversalDate = ready.posted.journals
      .filter((journal) => journal.recognitionDate === reversalDate)
      .reduce((sum, journal) => sum + journal.amountMinor, 0);

    expect(reversalReport).toMatchObject({
      propertyId: ready.fixture.propertyId,
      startDate: reversalDate,
      endDate: reversalEndDate,
      timezone: property.timezone,
      currencyCode: ready.payment.paymentIntent.currencyCode,
      recognizedRevenueMinor: recognizedOnReversalDate,
      reversedRevenueMinor: reversal.reversal.amountMinor,
      netRecognizedRevenueMinor: recognizedOnReversalDate - reversal.reversal.amountMinor
    });

    expect(reversalReport.days).toEqual([
      {
        date: reversalDate,
        recognizedRevenueMinor: recognizedOnReversalDate,
        reversedRevenueMinor: reversal.reversal.amountMinor,
        netRecognizedRevenueMinor: recognizedOnReversalDate - reversal.reversal.amountMinor
      }
    ]);
  });
  it("Phase 7E1C reports weighted LIVE portfolio occupancy and recognized revenue", async () => {
    const ready = await recognizedForReversal();
    const reversal = await reverseOne(ready);

    const alpha = await markPortfolioPropertyLive(ready.fixture, "Alpha Portfolio Hotel");

    const beta = await createPortfolioProperty(ready.fixture, {
      name: "Beta Portfolio Hotel",
      activeRooms: 3,
      live: true
    });

    await createPortfolioProperty(ready.fixture, {
      name: "Draft Portfolio Hotel",
      activeRooms: 0,
      live: false
    });

    const service = new OwnerReportService();

    const report = await service.portfolioPerformance(db, ready.fixture.actor, {
      organizationId: ready.fixture.organizationId,
      startDate: ready.held.reservation.arrivalDate,
      endDate: ready.held.reservation.departureDate
    });

    expect(report).toMatchObject({
      organizationId: ready.fixture.organizationId,
      startDate: "2034-02-10",
      endDate: "2034-02-12",
      currencyCode: ready.payment.paymentIntent.currencyCode,
      propertyCount: 2,
      currentActivePhysicalRooms: 5,
      capacityRoomNights: 10,
      confirmedRoomNights: 2,
      occupancyBps: 2000,
      recognizedRevenueMinor: ready.posted.revenueBasisMinor,
      reversedRevenueMinor: 0,
      netRecognizedRevenueMinor: ready.posted.revenueBasisMinor
    });

    expect(report.properties).toEqual([
      {
        propertyId: alpha.id,
        name: "Alpha Portfolio Hotel",
        timezone: alpha.timezone,
        currentActivePhysicalRooms: 2,
        capacityRoomNights: 4,
        confirmedRoomNights: 2,
        occupancyBps: 5000,
        recognizedRevenueMinor: ready.posted.revenueBasisMinor,
        reversedRevenueMinor: 0,
        netRecognizedRevenueMinor: ready.posted.revenueBasisMinor
      },
      {
        propertyId: beta.propertyId,
        name: "Beta Portfolio Hotel",
        timezone: beta.timezone,
        currentActivePhysicalRooms: 3,
        capacityRoomNights: 6,
        confirmedRoomNights: 0,
        occupancyBps: 0,
        recognizedRevenueMinor: 0,
        reversedRevenueMinor: 0,
        netRecognizedRevenueMinor: 0
      }
    ]);

    const reversalJournal = reversal.journals[0]!;
    expect(reversalJournal.journalType).toBe("REVENUE_REVERSED");

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: alpha.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(reversalJournal.occurredAt));

    const datePart = (type: "year" | "month" | "day") => {
      const part = parts.find((candidate) => candidate.type === type);
      expect(part).toBeDefined();
      return part!.value;
    };

    const reversalDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;

    const reversalEndDate = new Date(
      new Date(`${reversalDate}T00:00:00.000Z`).getTime() + 86_400_000
    )
      .toISOString()
      .slice(0, 10);

    const recognizedOnReversalDate = ready.posted.journals
      .filter((journal) => journal.recognitionDate === reversalDate)
      .reduce((sum, journal) => sum + journal.amountMinor, 0);

    const reversalReport = await service.portfolioPerformance(db, ready.fixture.actor, {
      organizationId: ready.fixture.organizationId,
      startDate: reversalDate,
      endDate: reversalEndDate
    });

    expect(reversalReport).toMatchObject({
      organizationId: ready.fixture.organizationId,
      currencyCode: ready.payment.paymentIntent.currencyCode,
      propertyCount: 2,
      recognizedRevenueMinor: recognizedOnReversalDate,
      reversedRevenueMinor: reversal.reversal.amountMinor,
      netRecognizedRevenueMinor: recognizedOnReversalDate - reversal.reversal.amountMinor
    });

    const alphaReversal = reversalReport.properties.find(
      (property) => property.propertyId === alpha.id
    );

    expect(alphaReversal).toMatchObject({
      recognizedRevenueMinor: recognizedOnReversalDate,
      reversedRevenueMinor: reversal.reversal.amountMinor,
      netRecognizedRevenueMinor: recognizedOnReversalDate - reversal.reversal.amountMinor
    });

    const propertyOnlyActor: ActorContext = {
      userId: ready.fixture.actor.userId,
      email: ready.fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: ready.fixture.organizationId,
          propertyId: ready.fixture.propertyId,
          role: "MANAGER"
        }
      ]
    };

    await expect(
      service.portfolioPerformance(db, propertyOnlyActor, {
        organizationId: ready.fixture.organizationId,
        startDate: ready.held.reservation.arrivalDate,
        endDate: ready.held.reservation.departureDate
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });
  });
  it("Phase 7E1C returns an empty portfolio for an existing organization with no LIVE properties", async () => {
    const fixture = await createFixture();

    const organization = await db
      .selectFrom("organizations")
      .select("currency_code")
      .where("id", "=", fixture.organizationId)
      .executeTakeFirstOrThrow();

    const report = await new OwnerReportService().portfolioPerformance(db, fixture.actor, {
      organizationId: fixture.organizationId,
      startDate: "2034-02-10",
      endDate: "2034-02-12"
    });

    expect(report).toEqual({
      organizationId: fixture.organizationId,
      startDate: "2034-02-10",
      endDate: "2034-02-12",
      currencyCode: organization.currency_code,
      propertyCount: 0,
      currentActivePhysicalRooms: 0,
      capacityRoomNights: 0,
      confirmedRoomNights: 0,
      occupancyBps: null,
      recognizedRevenueMinor: 0,
      reversedRevenueMinor: 0,
      netRecognizedRevenueMinor: 0,
      properties: []
    });
  });

  it("Phase 7E1C returns not found for a nonexistent organization after organization authorization", async () => {
    const fixture = await createFixture();
    const missingOrganizationId = randomUUID();

    const missingOrganizationActor: ActorContext = {
      ...fixture.actor,
      organizationMemberships: fixture.actor.organizationMemberships.map((membership) => ({
        ...membership,
        organizationId: missingOrganizationId
      })),
      propertyGrants: []
    };

    await expect(
      new OwnerReportService().portfolioPerformance(db, missingOrganizationActor, {
        organizationId: missingOrganizationId,
        startDate: "2034-02-10",
        endDate: "2034-02-12"
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });
  });
  async function insertPhase7E2AuditEvent(
    fixture: Fixture,
    options: {
      id?: string;
      organizationId?: string;
      propertyId?: string | null;
      actorType?: "USER" | "SYSTEM" | "PROVIDER";
      actorUserId?: string | null;
      actorRole?: string | null;
      action?: string;
      entityType?: string;
      entityId?: string;
      before?: Record<string, unknown> | null;
      after?: Record<string, unknown> | null;
      metadata?: Record<string, unknown>;
      reason?: string | null;
      createdAt?: Date;
    } = {}
  ) {
    const request = metadata();
    const auditActorType = options.actorType ?? "USER";

    return db
      .insertInto("audit_events")
      .values({
        id: options.id ?? randomUUID(),
        actor_type: auditActorType,
        actor_user_id:
          options.actorUserId !== undefined
            ? options.actorUserId
            : auditActorType === "USER"
              ? fixture.actor.userId
              : null,
        actor_role:
          options.actorRole !== undefined
            ? options.actorRole
            : auditActorType === "USER"
              ? "OWNER"
              : null,
        organization_id: options.organizationId ?? fixture.organizationId,
        property_id: options.propertyId === undefined ? fixture.propertyId : options.propertyId,
        action: options.action ?? "phase7e2.test",
        entity_type: options.entityType ?? "phase7e2_test",
        entity_id: options.entityId ?? randomUUID(),
        before_json: options.before ?? null,
        after_json: options.after ?? { status: "RECORDED" },
        metadata_json: options.metadata ?? { fixture: "phase7e2" },
        reason: options.reason ?? null,
        source: "phase7e2-integration",
        request_id: request.requestId,
        correlation_id: request.correlationId,
        ip_address: "203.0.113.17",
        user_agent: "phase7e2-sensitive-test-agent",
        created_at: options.createdAt ?? new Date("2040-01-01T00:00:00.000Z")
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  it("Phase 7E2 lists tenant-scoped audit history with filters and stable cursor pagination", async () => {
    const fixture = await createFixture();
    const otherFixture = await createFixture();
    const service = new AuditExplorerService();

    const sameCreatedAt = new Date("2040-03-02T10:00:00.000Z");
    const olderCreatedAt = new Date("2040-03-01T10:00:00.000Z");

    const pageThree = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000303",
      action: "phase7e2.page",
      entityId: "page-three",
      createdAt: sameCreatedAt
    });

    const pageTwo = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000302",
      propertyId: null,
      action: "phase7e2.page",
      entityId: "page-two-organization",
      createdAt: sameCreatedAt
    });

    const pageOne = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000301",
      action: "phase7e2.page",
      entityId: "page-one",
      createdAt: sameCreatedAt
    });

    const pageOlder = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000300",
      actorType: "SYSTEM",
      actorUserId: null,
      actorRole: null,
      action: "phase7e2.page",
      entityId: "page-older",
      createdAt: olderCreatedAt
    });

    await insertPhase7E2AuditEvent(otherFixture, {
      id: "00000000-0000-4000-8000-000000000399",
      action: "phase7e2.page",
      entityId: "cross-organization",
      createdAt: new Date("2040-03-03T10:00:00.000Z")
    });

    const firstPage = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      action: "phase7e2.page",
      entityType: "phase7e2_test",
      limit: 2
    });

    expect(firstPage.organizationId).toBe(fixture.organizationId);
    expect(firstPage.items.map((item) => item.id)).toEqual([pageThree.id, pageTwo.id]);
    expect(firstPage.items[1]!.propertyId).toBeNull();
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      action: "phase7e2.page",
      entityType: "phase7e2_test",
      limit: 2,
      cursor: firstPage.nextCursor!
    });

    expect(secondPage.items.map((item) => item.id)).toEqual([pageOne.id, pageOlder.id]);
    expect(secondPage.nextCursor).toBeNull();

    const pagedIds = [
      ...firstPage.items.map((item) => item.id),
      ...secondPage.items.map((item) => item.id)
    ];

    expect(pagedIds).toEqual([pageThree.id, pageTwo.id, pageOne.id, pageOlder.id]);
    expect(new Set(pagedIds).size).toBe(4);
    expect(pagedIds).not.toContain("00000000-0000-4000-8000-000000000399");

    const propertyOnly = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      action: "phase7e2.page",
      entityType: "phase7e2_test"
    });

    expect(propertyOnly.items.map((item) => item.id)).toEqual([
      pageThree.id,
      pageOne.id,
      pageOlder.id
    ]);
    expect(propertyOnly.items.every((item) => item.propertyId === fixture.propertyId)).toBe(true);

    const filtered = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000350",
      action: "phase7e2.filtered",
      entityType: "phase7e2_filter",
      entityId: "filter-target",
      createdAt: new Date("2040-03-04T10:00:00.000Z")
    });

    const exactFilter = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      actorType: "USER",
      actorUserId: fixture.actor.userId,
      action: "phase7e2.filtered",
      entityType: "phase7e2_filter",
      entityId: "filter-target"
    });

    expect(exactFilter.items.map((item) => item.id)).toEqual([filtered.id]);

    const rangeStart = new Date("2040-04-01T00:00:00.000Z");
    const rangeEnd = new Date("2040-04-02T00:00:00.000Z");

    const includedAtStart = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000401",
      action: "phase7e2.range",
      entityType: "phase7e2_range",
      entityId: "included-at-start",
      createdAt: rangeStart
    });

    await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000402",
      action: "phase7e2.range",
      entityType: "phase7e2_range",
      entityId: "excluded-at-end",
      createdAt: rangeEnd
    });

    const ranged = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      action: "phase7e2.range",
      entityType: "phase7e2_range",
      createdFrom: rangeStart.toISOString(),
      createdBefore: rangeEnd.toISOString()
    });

    expect(ranged.items.map((item) => item.id)).toEqual([includedAtStart.id]);
  });

  it("Phase 7E2 requires organization AUDIT_READ and validates list controls", async () => {
    const fixture = await createFixture();
    const service = new AuditExplorerService();

    const adminActor: ActorContext = {
      ...fixture.actor,
      organizationMemberships: fixture.actor.organizationMemberships.map((membership) => ({
        ...membership,
        role: "ADMIN"
      })),
      propertyGrants: []
    };

    await expect(
      service.list(db, adminActor, {
        organizationId: fixture.organizationId
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    const propertyOnlyActor: ActorContext = {
      userId: fixture.actor.userId,
      email: fixture.actor.email,
      platformRoles: [],
      organizationMemberships: [],
      propertyGrants: [
        {
          grantId: randomUUID(),
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          role: "MANAGER"
        }
      ]
    };

    await expect(
      service.list(db, propertyOnlyActor, {
        organizationId: fixture.organizationId
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    await expect(
      service.list(db, fixture.actor, {
        organizationId: fixture.organizationId,
        cursor: "%%%"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    await expect(
      service.list(db, fixture.actor, {
        organizationId: fixture.organizationId,
        limit: 0
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    await expect(
      service.list(db, fixture.actor, {
        organizationId: fixture.organizationId,
        limit: 101
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    await expect(
      service.list(db, fixture.actor, {
        organizationId: fixture.organizationId,
        createdFrom: "2040-05-02T00:00:00.000Z",
        createdBefore: "2040-05-02T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });
  });

  it("Phase 7E2 returns safe audit detail and hides cross-organization events", async () => {
    const fixture = await createFixture();
    const otherFixture = await createFixture();
    const service = new AuditExplorerService();

    const event = await insertPhase7E2AuditEvent(fixture, {
      id: "00000000-0000-4000-8000-000000000501",
      action: "phase7e2.detail",
      entityType: "phase7e2_detail",
      entityId: "detail-target",
      before: { status: "BEFORE", amountMinor: 100 },
      after: { status: "AFTER", amountMinor: 120 },
      metadata: { channel: "audit-explorer", sequence: 7 },
      reason: "PHASE_7E2_TEST",
      createdAt: new Date("2040-06-01T12:00:00.000Z")
    });

    const detail = await service.get(db, fixture.actor, fixture.organizationId, event.id);

    expect(detail).toEqual({
      id: event.id,
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      actorType: "USER",
      actorUserId: fixture.actor.userId,
      actorRole: "OWNER",
      action: "phase7e2.detail",
      entityType: "phase7e2_detail",
      entityId: "detail-target",
      before: { status: "BEFORE", amountMinor: 100 },
      after: { status: "AFTER", amountMinor: 120 },
      metadata: { channel: "audit-explorer", sequence: 7 },
      reason: "PHASE_7E2_TEST",
      source: "phase7e2-integration",
      requestId: event.request_id,
      correlationId: event.correlation_id,
      createdAt: event.created_at.toISOString()
    });

    expect(detail).not.toHaveProperty("ipAddress");
    expect(detail).not.toHaveProperty("userAgent");

    const otherEvent = await insertPhase7E2AuditEvent(otherFixture, {
      id: "00000000-0000-4000-8000-000000000599",
      action: "phase7e2.cross-org-detail",
      entityType: "phase7e2_detail",
      entityId: "other-organization",
      createdAt: new Date("2040-06-02T12:00:00.000Z")
    });

    await expect(
      service.get(db, fixture.actor, fixture.organizationId, otherEvent.id)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });

    const crossOrganizationList = await service.list(db, fixture.actor, {
      organizationId: fixture.organizationId,
      action: "phase7e2.cross-org-detail",
      entityType: "phase7e2_detail"
    });

    expect(crossOrganizationList.items).toEqual([]);
  });
  function phase7FQualityAuditor(fixture: Fixture): ActorContext {
    return {
      ...fixture.actor,
      platformRoles: ["QUALITY_AUDITOR"]
    };
  }

  async function createPhase7FPublishedStandard(service: QualityAuditService, actor: ActorContext) {
    const code = `Q${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;

    const template = await service.createTemplate(db, actor, {
      code,
      name: `Phase 7F Standard ${code}`,
      request: metadata()
    });

    const version = await service.createTemplateVersion(db, actor, {
      templateId: template.id,
      title: "Phase 7F Property Standard",
      notes: "Permanent integration-test quality standard.",
      request: metadata()
    });

    const items = await service.replaceTemplateItems(db, actor, {
      templateId: template.id,
      versionId: version.id,
      items: [
        {
          code: "FIRE_SAFETY",
          title: "Fire and electrical safety",
          category: "guest-safety",
          checkType: "MANDATORY_PASS",
          sortOrder: 1
        },
        {
          code: "HOUSEKEEPING",
          title: "Housekeeping quality",
          category: "housekeeping",
          checkType: "SCORED_QUALITY_ITEM",
          maxScore: 10,
          sortOrder: 2
        },
        {
          code: "ACCESS_DISCLOSURE",
          title: "Access disclosure",
          category: "accessibility",
          checkType: "INFORMATIONAL_DISCLOSURE",
          sortOrder: 3
        },
        {
          code: "SIGNAGE_IMPROVEMENT",
          title: "Guest signage improvement",
          category: "guest-information",
          checkType: "IMPROVEMENT_RECOMMENDATION",
          sortOrder: 4
        }
      ],
      request: metadata()
    });

    const published = await service.publishTemplateVersion(db, actor, {
      templateId: template.id,
      versionId: version.id,
      request: metadata()
    });

    return { template, version: published, items };
  }

  it("Phase 7F completes a failed quality assessment with exact audit history and no property lifecycle mutation", async () => {
    const fixture = await createFixture();
    const actor = phase7FQualityAuditor(fixture);
    const service = new QualityAuditService();

    const propertyBefore = await db
      .selectFrom("properties")
      .select("status")
      .where("id", "=", fixture.propertyId)
      .executeTakeFirstOrThrow();

    const standard = await createPhase7FPublishedStandard(service, actor);

    const assessment = await service.createAssessment(db, actor, {
      propertyId: fixture.propertyId,
      templateVersionId: standard.version.id,
      triggerType: "SAFETY_INCIDENT",
      triggerReference: "Permanent Phase 7F safety trigger",
      assignedAuditorUserId: actor.userId,
      request: metadata()
    });

    const started = await service.startAssessment(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      request: metadata()
    });

    expect(started.status).toBe("IN_PROGRESS");

    const mandatory = standard.items.find((item) => item.code === "FIRE_SAFETY")!;
    const scored = standard.items.find((item) => item.code === "HOUSEKEEPING")!;
    const disclosure = standard.items.find((item) => item.code === "ACCESS_DISCLOSURE")!;
    const improvement = standard.items.find((item) => item.code === "SIGNAGE_IMPROVEMENT")!;

    await service.recordAssessmentResults(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      results: [
        {
          templateItemId: mandatory.id,
          resultStatus: "FAIL",
          notes: "Mandatory fire-safety requirement failed."
        },
        {
          templateItemId: scored.id,
          resultStatus: "PASS",
          score: 7,
          notes: "Housekeeping score recorded."
        },
        {
          templateItemId: disclosure.id,
          resultStatus: "OBSERVED",
          notes: "Access information verified."
        },
        {
          templateItemId: improvement.id,
          resultStatus: "OBSERVED",
          notes: "Additional signage recommended."
        }
      ],
      request: metadata()
    });

    const completed = await service.completeAssessment(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      request: metadata()
    });

    expect(completed).toMatchObject({
      status: "COMPLETED",
      outcome: "FAIL",
      mandatoryFailureCount: 1,
      scoreBasisPoints: 7000,
      requiresLifecycleReview: true
    });

    const platformList = await service.listPlatformAssessments(db, actor, fixture.propertyId);
    expect(platformList.map((item) => item.id)).toContain(assessment.id);

    const platformDetail = await service.getPlatformAssessment(
      db,
      actor,
      fixture.propertyId,
      assessment.id
    );
    expect(platformDetail.templateItems).toHaveLength(4);
    expect(platformDetail.results).toHaveLength(4);

    const ownerList = await service.listPartnerAssessments(
      db,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId
    );
    expect(ownerList.map((item) => item.id)).toContain(assessment.id);

    const ownerDetail = await service.getPartnerAssessment(
      db,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId,
      assessment.id
    );
    expect(ownerDetail.id).toBe(assessment.id);

    const expectedAuditActions = [
      "QUALITY_TEMPLATE_CREATED",
      "QUALITY_TEMPLATE_VERSION_CREATED",
      "QUALITY_TEMPLATE_ITEMS_REPLACED",
      "QUALITY_TEMPLATE_VERSION_PUBLISHED",
      "QUALITY_ASSESSMENT_CREATED",
      "QUALITY_ASSESSMENT_STARTED",
      "QUALITY_ASSESSMENT_RESULTS_RECORDED",
      "QUALITY_ASSESSMENT_COMPLETED"
    ];

    const auditRows = await db
      .selectFrom("audit_events")
      .select("action")
      .where("actor_user_id", "=", actor.userId)
      .where("action", "in", expectedAuditActions)
      .execute();

    const actions = new Set(auditRows.map((row) => row.action));

    for (const action of expectedAuditActions) {
      expect(actions.has(action)).toBe(true);
    }

    const propertyAfter = await db
      .selectFrom("properties")
      .select("status")
      .where("id", "=", fixture.propertyId)
      .executeTakeFirstOrThrow();

    expect(propertyAfter.status).toBe(propertyBefore.status);
  });

  it("Phase 7F enforces quality authorization, version immutability, trigger taxonomy and exact published-version binding", async () => {
    const fixture = await createFixture();
    const actor = phase7FQualityAuditor(fixture);
    const service = new QualityAuditService();

    await expect(
      service.createTemplate(db, fixture.actor, {
        code: `Q${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
        name: "Owner Must Not Manage Quality",
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    const standard = await createPhase7FPublishedStandard(service, actor);

    await expect(
      service.replaceTemplateItems(db, actor, {
        templateId: standard.template.id,
        versionId: standard.version.id,
        items: [],
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    await expect(
      db
        .updateTable("quality_standard_template_versions")
        .set({ title: "Mutation must fail" })
        .where("id", "=", standard.version.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .updateTable("quality_standard_template_items")
        .set({ title: "Mutation must fail" })
        .where("id", "=", standard.items[0]!.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    const secondVersion = await service.createTemplateVersion(db, actor, {
      templateId: standard.template.id,
      title: "Phase 7F Property Standard Version Two",
      request: metadata()
    });

    expect(secondVersion.versionNumber).toBe(2);
    expect(secondVersion.status).toBe("DRAFT");

    const originalVersion = await db
      .selectFrom("quality_standard_template_versions")
      .select(["version_number", "status"])
      .where("id", "=", standard.version.id)
      .executeTakeFirstOrThrow();

    expect(originalVersion).toEqual({
      version_number: 1,
      status: "PUBLISHED"
    });

    const draftAssessmentId = randomUUID();

    await db
      .insertInto("quality_assessments")
      .values({
        id: draftAssessmentId,
        organization_id: fixture.organizationId,
        property_id: fixture.propertyId,
        template_version_id: secondVersion.id,
        trigger_type: "SCHEDULED_AUDIT",
        created_by_user_id: actor.userId
      })
      .execute();

    await expect(
      service.startAssessment(db, actor, {
        propertyId: fixture.propertyId,
        assessmentId: draftAssessmentId,
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    await expect(
      service.createAssessment(db, actor, {
        propertyId: fixture.propertyId,
        templateVersionId: standard.version.id,
        triggerType: "INVALID_TRIGGER",
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    const approvedTriggers = [
      "SCHEDULED_AUDIT",
      "REPEATED_LOW_REVIEWS",
      "SERIOUS_COMPLAINT",
      "OWNERSHIP_MANAGEMENT_CHANGE",
      "RENOVATION",
      "SAFETY_INCIDENT"
    ] as const;

    const createdTriggers: string[] = [];

    for (const trigger of approvedTriggers) {
      const assessment = await service.createAssessment(db, actor, {
        propertyId: fixture.propertyId,
        templateVersionId: standard.version.id,
        triggerType: trigger,
        request: metadata()
      });
      createdTriggers.push(assessment.triggerType);
    }

    expect(createdTriggers).toEqual(approvedTriggers);
  });

  it("Phase 7F validates result types, requires complete coverage, produces PASS and locks completed history", async () => {
    const fixture = await createFixture();
    const actor = phase7FQualityAuditor(fixture);
    const service = new QualityAuditService();
    const standard = await createPhase7FPublishedStandard(service, actor);

    const assessment = await service.createAssessment(db, actor, {
      propertyId: fixture.propertyId,
      templateVersionId: standard.version.id,
      triggerType: "SCHEDULED_AUDIT",
      request: metadata()
    });

    await service.startAssessment(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      request: metadata()
    });

    const mandatory = standard.items.find((item) => item.code === "FIRE_SAFETY")!;
    const scored = standard.items.find((item) => item.code === "HOUSEKEEPING")!;
    const disclosure = standard.items.find((item) => item.code === "ACCESS_DISCLOSURE")!;
    const improvement = standard.items.find((item) => item.code === "SIGNAGE_IMPROVEMENT")!;

    await service.recordAssessmentResults(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      results: [
        {
          templateItemId: mandatory.id,
          resultStatus: "PASS"
        }
      ],
      request: metadata()
    });

    await expect(
      service.completeAssessment(db, actor, {
        propertyId: fixture.propertyId,
        assessmentId: assessment.id,
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    await expect(
      service.recordAssessmentResults(db, actor, {
        propertyId: fixture.propertyId,
        assessmentId: assessment.id,
        results: [
          {
            templateItemId: mandatory.id,
            resultStatus: "PASS"
          },
          {
            templateItemId: scored.id,
            resultStatus: "PASS"
          }
        ],
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });

    await service.recordAssessmentResults(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      results: [
        {
          templateItemId: mandatory.id,
          resultStatus: "PASS"
        },
        {
          templateItemId: scored.id,
          resultStatus: "PASS",
          score: 10
        },
        {
          templateItemId: disclosure.id,
          resultStatus: "OBSERVED",
          notes: "Disclosure observed."
        },
        {
          templateItemId: improvement.id,
          resultStatus: "NOT_APPLICABLE",
          notes: "No recommendation required."
        }
      ],
      request: metadata()
    });

    const completed = await service.completeAssessment(db, actor, {
      propertyId: fixture.propertyId,
      assessmentId: assessment.id,
      request: metadata()
    });

    expect(completed).toMatchObject({
      status: "COMPLETED",
      outcome: "PASS",
      mandatoryFailureCount: 0,
      scoreBasisPoints: 10000,
      requiresLifecycleReview: false
    });

    await expect(
      service.recordAssessmentResults(db, actor, {
        propertyId: fixture.propertyId,
        assessmentId: assessment.id,
        results: [],
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    await expect(
      db
        .updateTable("quality_assessments")
        .set({ requires_lifecycle_review: true })
        .where("id", "=", assessment.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    const resultRow = await db
      .selectFrom("quality_assessment_results")
      .select("id")
      .where("assessment_id", "=", assessment.id)
      .executeTakeFirstOrThrow();

    await expect(
      db.deleteFrom("quality_assessment_results").where("id", "=", resultRow.id).execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("Phase 7F prevents partner cross-tenant quality leakage while OWNER remains read-only", async () => {
    const fixture = await createFixture();
    const otherFixture = await createFixture();
    const actor = phase7FQualityAuditor(fixture);
    const service = new QualityAuditService();
    const standard = await createPhase7FPublishedStandard(service, actor);

    const assessment = await service.createAssessment(db, actor, {
      propertyId: fixture.propertyId,
      templateVersionId: standard.version.id,
      triggerType: "RENOVATION",
      request: metadata()
    });

    const own = await service.getPartnerAssessment(
      db,
      fixture.actor,
      fixture.organizationId,
      fixture.propertyId,
      assessment.id
    );

    expect(own.id).toBe(assessment.id);

    await expect(
      service.listPartnerAssessments(
        db,
        fixture.actor,
        otherFixture.organizationId,
        otherFixture.propertyId
      )
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    await expect(
      service.getPartnerAssessment(
        db,
        fixture.actor,
        otherFixture.organizationId,
        otherFixture.propertyId,
        assessment.id
      )
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    await expect(
      service.listPartnerAssessments(
        db,
        fixture.actor,
        otherFixture.organizationId,
        fixture.propertyId
      )
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });

    await expect(
      service.createAssessment(db, fixture.actor, {
        propertyId: fixture.propertyId,
        templateVersionId: standard.version.id,
        triggerType: "RENOVATION",
        request: metadata()
      })
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });
  });
  it("requires settlement permission before any revenue reversal can be created", async () => {
    const ready = await recognizedForReversal();

    await expect(reverseOne(ready, { actor: ready.fixture.actor })).rejects.toMatchObject({
      code: "ACCESS_DENIED",
      statusCode: 403
    });

    const reversals = await db
      .selectFrom("reservation_revenue_reversals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(reversals).toHaveLength(0);
  });

  it("refuses reversal when no canonical REVENUE_RECOGNIZED source exists", async () => {
    const ready = await checkedOutForReversal();

    await expect(
      db.transaction().execute((trx) =>
        new RevenueReversalService().ensure(
          trx,
          reversalFinanceActor(ready.fixture),
          {
            organizationId: ready.fixture.organizationId,
            propertyId: ready.fixture.propertyId,
            reservationId: ready.held.reservation.id,
            operationId: randomUUID(),
            reasonCode: "SERVICE_RECOVERY",
            note: "Approved post-stay commercial revenue adjustment.",
            lines: [
              {
                revenueScheduleLineId: randomUUID(),
                amountMinor: 100_000
              }
            ]
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const reversals = await db
      .selectFrom("reservation_revenue_reversals")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(reversals).toHaveLength(0);
  });

  it("posts a partial reversal as DR STAY_REVENUE and CR GUEST_FUNDS_HELD without creating a provider refund", async () => {
    const ready = await recognizedForReversal();
    const result = await reverseOne(ready);

    expect(result.created).toBe(true);
    expect(result.createdJournalCount).toBe(1);
    expect(result.reversal.lineCount).toBe(1);
    expect(result.reversal.amountMinor).toBe(result.reversal.lines[0]!.amountMinor);

    const line = result.reversal.lines[0]!;
    const journal = result.journals[0]!;

    expect(journal).toMatchObject({
      journalType: "REVENUE_REVERSED",
      paymentIntentId: null,
      paymentEvidenceId: null,
      refundFinalizationId: null,
      revenueScheduleLineId: null,
      stayCompletionHistoryId: null,
      recognitionDate: null,
      revenueReversalLineId: line.id,
      amountMinor: line.amountMinor,
      currencyCode: line.currencyCode
    });

    const entries = await db
      .selectFrom("financial_ledger_entries")
      .select(["line_number", "account_code", "direction", "amount_minor"])
      .where("journal_id", "=", journal.id)
      .orderBy("line_number", "asc")
      .execute();

    expect(entries).toEqual([
      {
        line_number: 1,
        account_code: "STAY_REVENUE",
        direction: "DEBIT",
        amount_minor: line.amountMinor
      },
      {
        line_number: 2,
        account_code: "GUEST_FUNDS_HELD",
        direction: "CREDIT",
        amount_minor: line.amountMinor
      }
    ]);

    const providerRefunds = await db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();
    expect(providerRefunds).toHaveLength(0);

    const audit = await db
      .selectFrom("audit_events")
      .select("action")
      .where("entity_type", "=", "reservation_revenue_reversal")
      .where("entity_id", "=", result.reversal.id)
      .executeTakeFirstOrThrow();
    expect(audit.action).toBe("finance.revenue.reversed");

    const outbox = await db
      .selectFrom("outbox_events")
      .select("event_type")
      .where("aggregate_type", "=", "reservation")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "finance.revenue.reversed.v1")
      .executeTakeFirstOrThrow();
    expect(outbox.event_type).toBe("finance.revenue.reversed.v1");
  });

  it("replays the exact reversal operation without duplicating headers, lines or journals", async () => {
    const ready = await recognizedForReversal();
    const operationId = randomUUID();

    const first = await reverseOne(ready, { operationId });
    const second = await reverseOne(ready, { operationId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.createdJournalCount).toBe(0);
    expect(second.reversal.id).toBe(first.reversal.id);
    expect(second.reversal.lines.map((line) => line.id)).toEqual(
      first.reversal.lines.map((line) => line.id)
    );
    expect(second.journals.map((journal) => journal.id)).toEqual(
      first.journals.map((journal) => journal.id)
    );

    const [headers, lines, journals] = await Promise.all([
      db
        .selectFrom("reservation_revenue_reversals")
        .select("id")
        .where("reservation_id", "=", ready.held.reservation.id)
        .execute(),
      db
        .selectFrom("reservation_revenue_reversal_lines")
        .select("id")
        .where("reversal_id", "=", first.reversal.id)
        .execute(),
      db
        .selectFrom("financial_ledger_journals")
        .select("id")
        .where("journal_type", "=", "REVENUE_REVERSED")
        .where("reservation_id", "=", ready.held.reservation.id)
        .execute()
    ]);

    expect(headers).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(journals).toHaveLength(1);
  });

  it("prevents cumulative reversals from exceeding the originally recognized revenue line", async () => {
    const ready = await recognizedForReversal();
    const source = ready.posted.journals.find((journal) => journal.amountMinor > 1)!;
    expect(source).toBeTruthy();

    await reverseOne(ready, {
      revenueScheduleLineId: source.revenueScheduleLineId!,
      amountMinor: source.amountMinor - 1
    });

    await expect(
      reverseOne(ready, {
        revenueScheduleLineId: source.revenueScheduleLineId!,
        amountMinor: 2
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const reversed = await db
      .selectFrom("reservation_revenue_reversal_lines")
      .select("amount_minor")
      .where("revenue_schedule_line_id", "=", source.revenueScheduleLineId!)
      .execute();

    expect(reversed.reduce((sum, line) => sum + line.amount_minor, 0)).toBe(source.amountMinor - 1);
  });

  it("protects reversal headers, lines and reversal ledger journals from mutation", async () => {
    const ready = await recognizedForReversal();
    const result = await reverseOne(ready);
    const line = result.reversal.lines[0]!;
    const journal = result.journals[0]!;

    await expect(
      db
        .updateTable("reservation_revenue_reversals")
        .set({ reason_code: "MUTATION_MUST_FAIL" })
        .where("id", "=", result.reversal.id)
        .execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db.deleteFrom("reservation_revenue_reversal_lines").where("id", "=", line.id).execute()
    ).rejects.toThrow(/immutable/i);

    await expect(
      db
        .updateTable("financial_ledger_journals")
        .set({ amount_minor: journal.amountMinor + 1 })
        .where("id", "=", journal.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("rejects a forged reversal journal whose amount disagrees with the immutable reversal line", async () => {
    const ready = await recognizedForReversal();
    const financeActor = reversalFinanceActor(ready.fixture);
    const source = ready.posted.journals[0]!;
    const amountMinor = Math.min(100_000, source.amountMinor);

    await expect(
      db.transaction().execute(async (trx) => {
        const reversalId = randomUUID();

        const reversal = await trx
          .insertInto("reservation_revenue_reversals")
          .values({
            id: reversalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            operation_id: randomUUID(),
            reason_code: "SERVICE_RECOVERY",
            note: "Forged reversal journal validation test.",
            currency_code: source.currencyCode,
            amount_minor: amountMinor,
            line_count: 1,
            actor_user_id: financeActor.userId,
            source: "integration-test",
            request_id: randomUUID(),
            correlation_id: randomUUID()
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        const reversalLineId = randomUUID();

        await trx
          .insertInto("reservation_revenue_reversal_lines")
          .values({
            id: reversalLineId,
            reversal_id: reversalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            line_number: 1,
            revenue_schedule_line_id: source.revenueScheduleLineId!,
            revenue_recognition_journal_id: source.id,
            amount_minor: amountMinor,
            currency_code: source.currencyCode
          })
          .execute();

        const forgedJournalId = randomUUID();
        const forgedAmount = amountMinor + 1;

        await trx
          .insertInto("financial_ledger_journals")
          .values({
            id: forgedJournalId,
            organization_id: ready.fixture.organizationId,
            property_id: ready.fixture.propertyId,
            reservation_id: ready.held.reservation.id,
            payment_intent_id: null,
            journal_type: "REVENUE_REVERSED",
            payment_evidence_id: null,
            refund_finalization_id: null,
            revenue_schedule_line_id: null,
            stay_completion_history_id: null,
            recognition_date: null,
            revenue_reversal_line_id: reversalLineId,
            amount_minor: forgedAmount,
            currency_code: source.currencyCode,
            occurred_at: reversal.created_at,
            source: "integration-test",
            request_id: randomUUID(),
            correlation_id: randomUUID()
          })
          .execute();

        await trx
          .insertInto("financial_ledger_entries")
          .values([
            {
              id: randomUUID(),
              journal_id: forgedJournalId,
              organization_id: ready.fixture.organizationId,
              property_id: ready.fixture.propertyId,
              line_number: 1,
              account_code: "STAY_REVENUE",
              direction: "DEBIT",
              amount_minor: forgedAmount,
              currency_code: source.currencyCode
            },
            {
              id: randomUUID(),
              journal_id: forgedJournalId,
              organization_id: ready.fixture.organizationId,
              property_id: ready.fixture.propertyId,
              line_number: 2,
              account_code: "GUEST_FUNDS_HELD",
              direction: "CREDIT",
              amount_minor: forgedAmount,
              currency_code: source.currencyCode
            }
          ])
          .execute();
      })
    ).rejects.toThrow(/reversal economics|reversal line/i);
  });
});
