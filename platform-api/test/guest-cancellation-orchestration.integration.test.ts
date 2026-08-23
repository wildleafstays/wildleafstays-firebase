import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { FinancialLedgerRepository } from "../src/modules/finance/infrastructure/financial-ledger-repository.js";
import { GuestCancellationService } from "../src/modules/guest/application/guest-cancellation-service.js";
import { GuestSelfServiceRepository } from "../src/modules/guest/infrastructure/guest-self-service-repository.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { PaymentRefundRequestService } from "../src/modules/payments/application/payment-refund-request-service.js";
import { VerifiedPaymentEvidenceService } from "../src/modules/payments/application/verified-payment-evidence-service.js";
import { VerifiedPaymentProcessor } from "../src/modules/payments/application/verified-payment-processor.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { QuoteHoldService } from "../src/modules/quotes/application/quote-hold-service.js";
import { QuoteService } from "../src/modules/quotes/application/quote-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import { BeginPaymentService } from "../src/modules/reservations/application/begin-payment-service.js";
import { HeldReservationService } from "../src/modules/reservations/application/held-reservation-service.js";

const config = loadConfig();
const db = createDatabase(config);

const CANCELLED_AT = new Date("2034-02-09T08:30:00.000Z");

const ARRIVAL_AT = new Date("2034-02-10T08:30:00.000Z");

afterAll(async () => {
  await db.destroy();
});

function metadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "phase-8b-slice3-integration-test",
    ipAddress: null,
    userAgent: null
  };
}

async function createUser(label: string): Promise<ActorContext> {
  const subject = `phase8b-s3-${label}-${randomUUID()}`;

  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: `Phase 8B ${label}`,
      email_verified: true,
      status: "ACTIVE"
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    userId: user.id,
    email: user.email,
    platformRoles: [],
    organizationMemberships: [],
    propertyGrants: []
  };
}

interface PropertyFixture {
  owner: ActorContext;
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  rateProductId: string;
}

async function createPropertyFixture(): Promise<PropertyFixture> {
  const ownerBase = await createUser("Owner");

  const organization = await db.transaction().execute((trx) =>
    new CreateOrganizationService().execute(
      trx,
      ownerBase,
      {
        legalName: `Phase 8B Slice 3 Org ${randomUUID()}`,
        tradingName: null,
        organizationType: "PRIVATE_LIMITED",
        countryCode: "IN",
        currencyCode: "INR"
      },
      metadata()
    )
  );

  const owner: ActorContext = {
    ...ownerBase,
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
      owner,
      {
        organizationId: organization.organizationId,
        name: `Phase 8B Slice 3 Property ${randomUUID()}`,
        timezone: "Asia/Kolkata"
      },
      metadata()
    )
  );

  await db
    .updateTable("properties")
    .set({
      property_type: "HOTEL",
      sale_mode: "ROOMS_ONLY"
    })
    .where("id", "=", property.property.id)
    .execute();

  const setup = new PropertySetupService();

  const category = await db.transaction().execute((trx) =>
    setup.createRoomCategory(
      trx,
      owner,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: `DLX-${randomUUID().slice(0, 6)}`,
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
        owner,
        {
          organizationId: organization.organizationId,
          propertyId: property.property.id,
          roomCategoryId: category.roomCategory.id,
          structureId: null,
          floorId: null,
          unitCode: `S3-${index}-${randomUUID().slice(0, 6)}`,
          displayName: `Slice 3 Room ${index}`,
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
      owner,
      {
        organizationId: organization.organizationId,
        propertyId: property.property.id,
        code: `EP-${randomUUID().slice(0, 8)}`,
        name: "Flexible",
        description: null,
        mealPlanCode: "EP"
      },
      metadata()
    )
  );

  const rateProduct = await db.transaction().execute((trx) =>
    new RateService().configureRateProduct(
      trx,
      owner,
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
    owner,
    organizationId: organization.organizationId,
    propertyId: property.property.id,
    ratePlanId: ratePlan.ratePlan.id,
    rateProductId: rateProduct.rateProduct.id
  };
}

async function configureCommercialCore(
  fixture: PropertyFixture,
  cancellationBasisPoints: number
): Promise<void> {
  const service = new CommercialRuleService();

  const effectiveFrom = "2034-01-01";

  await db.transaction().execute((trx) =>
    service.setPropertyCommercialSettings(
      trx,
      fixture.owner,
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
    service.setGuestAgePolicy(
      trx,
      fixture.owner,
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
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        code: `FLEX-${randomUUID().slice(0, 8)}`,
        name: "Flexible Cancellation",
        description: null
      },
      metadata()
    )
  );

  await db.transaction().execute((trx) =>
    service.createCancellationPolicyVersion(
      trx,
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        cancellationPolicyId: cancellation.policy.id,
        effectiveFrom,
        arrivalLocalTime: "14:00",
        policyText: "Phase 8B immutable cancellation policy.",
        tiers: [
          {
            triggerType: "CANCELLATION",
            minimumMinutesBeforeArrival: 0,
            penaltyType: "PERCENTAGE_OF_STAY",
            penaltyValue: cancellationBasisPoints
          },
          {
            triggerType: "NO_SHOW",
            minimumMinutesBeforeArrival: null,
            penaltyType: "PERCENTAGE_OF_STAY",
            penaltyValue: 10_000
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
      fixture.owner,
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
      fixture.owner,
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

async function confirmedReservationFixture(cancellationBasisPoints = 0) {
  const fixture = await createPropertyFixture();

  await configureCommercialCore(fixture, cancellationBasisPoints);

  const quote = await db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        rateProductId: fixture.rateProductId,
        arrivalDate: "2034-02-10",
        departureDate: "2034-02-12",
        ttlSeconds: 900,
        promotionCode: null,
        units: [
          {
            adults: 2,
            childAges: []
          }
        ]
      },
      metadata()
    )
  );

  const quoteHold = await db.transaction().execute((trx) =>
    new QuoteHoldService().createFromQuote(
      trx,
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId: quote.quote.id
      },
      metadata()
    )
  );

  const held = await db.transaction().execute((trx) =>
    new HeldReservationService().createFromQuoteHold(
      trx,
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId: quote.quote.id,
        leadGuest: {
          name: "Phase 8B Guest",
          email: "phase8b-s3@example.invalid",
          phone: "+919876543210"
        }
      },
      metadata()
    )
  );

  const payment = await db.transaction().execute((trx) =>
    new BeginPaymentService().beginPayment(
      trx,
      fixture.owner,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        reservationId: held.reservation.id
      },
      metadata()
    )
  );

  const evidence = await db.transaction().execute((trx) =>
    new VerifiedPaymentEvidenceService().record(
      trx,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        reservationId: held.reservation.id,
        paymentIntentId: payment.paymentIntent.id,
        provider: "RAZORPAY",
        providerEventId: `evt_${randomUUID()}`,
        providerPaymentId: `pay_${randomUUID()}`,
        providerOrderId: `order_${randomUUID()}`,
        amountMinor: payment.paymentIntent.amountMinor,
        currencyCode: payment.paymentIntent.currencyCode,
        verificationMethod: "WEBHOOK_SIGNATURE",
        payloadSha256: "c".repeat(64)
      },
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

  if (!processed.inventoryAllocationId) {
    throw new Error("Expected canonical confirmed allocation");
  }

  const guestActor = await createUser("Guest");

  await db.transaction().execute((trx) =>
    new GuestSelfServiceRepository().insertReservationLinkIfAbsent(trx, {
      reservationId: held.reservation.id,
      userId: guestActor.userId,
      linkSource: "AUTHENTICATED_CHECKOUT"
    })
  );

  return {
    fixture,
    quote,
    quoteHold,
    held,
    payment,
    evidence,
    processed,
    guestActor
  };
}

function serviceAt(
  now: Date,
  overrides: ConstructorParameters<typeof GuestCancellationService>[0] = {}
): GuestCancellationService {
  return new GuestCancellationService({
    ...overrides,
    now: () => new Date(now)
  });
}

describe("Phase 8B atomic guest cancellation orchestration", () => {
  it("atomically cancels CONFIRMED reservation and creates exact cancellation-backed refund obligation", async () => {
    const ready = await confirmedReservationFixture(0);

    const result = await db.transaction().execute((trx) =>
      serviceAt(CANCELLED_AT).cancel(
        trx,
        ready.guestActor,
        {
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );

    expect(result.status).toBe("CANCELLED");
    expect(result.arrivalAt).toBe(ARRIVAL_AT.toISOString());
    expect(result.minutesBeforeArrival).toBe(1_440);
    expect(result.penaltyMinor).toBe(0);
    expect(result.refundDueMinor).toBe(result.paidMinor);
    expect(result.refundRequired).toBe(true);
    expect(result.refundRequestId).not.toBeNull();

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CANCELLED");

    const decision = await db
      .selectFrom("reservation_cancellation_decisions")
      .selectAll()
      .where("reservation_id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(decision.guest_user_id).toBe(ready.guestActor.userId);
    expect(decision.penalty_minor).toBe(0);
    expect(decision.refund_due_minor).toBe(decision.paid_minor);

    const allocation = await db
      .selectFrom("inventory_allocations")
      .select(["status", "release_reason"])
      .where("id", "=", ready.processed.inventoryAllocationId!)
      .executeTakeFirstOrThrow();

    expect(allocation.status).toBe("RELEASED");
    expect(allocation.release_reason).toBe("BOOKING_CANCELLED");

    const histories = await db
      .selectFrom("reservation_status_history")
      .select(["from_status", "to_status", "reason", "actor_user_id"])
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("reason", "=", "GUEST_CANCELLATION")
      .execute();

    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({
      from_status: "CONFIRMED",
      to_status: "CANCELLED",
      reason: "GUEST_CANCELLATION",
      actor_user_id: ready.guestActor.userId
    });

    const refund = await db
      .selectFrom("payment_refund_requests")
      .selectAll()
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("refund_source", "=", "RESERVATION_CANCELLATION")
      .executeTakeFirstOrThrow();

    expect(refund.id).toBe(result.refundRequestId);
    expect(refund.reconciliation_case_id).toBeNull();
    expect(refund.cancellation_decision_id).toBe(decision.id);
    expect(refund.amount_minor).toBe(decision.refund_due_minor);
    expect(refund.payment_intent_id).toBe(decision.payment_intent_id);
    expect(refund.payment_evidence_id).toBe(decision.payment_evidence_id);
    expect(refund.provider).toBe(decision.provider);
    expect(refund.provider_payment_id).toBe(decision.provider_payment_id);

    const guestAudits = await db
      .selectFrom("audit_events")
      .select("id")
      .where("entity_id", "=", ready.held.reservation.id)
      .where("action", "=", "guest.reservation.cancelled")
      .execute();

    expect(guestAudits).toHaveLength(1);

    const reservationEvents = await db
      .selectFrom("outbox_events")
      .select("id")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "reservation.cancelled.v1")
      .execute();

    expect(reservationEvents).toHaveLength(1);
  });

  it("creates no refund obligation when immutable cancellation penalty consumes the full paid amount", async () => {
    const ready = await confirmedReservationFixture(10_000);

    const result = await db.transaction().execute((trx) =>
      serviceAt(CANCELLED_AT).cancel(
        trx,
        ready.guestActor,
        {
          reservationId: ready.held.reservation.id
        },
        metadata()
      )
    );

    expect(result.status).toBe("CANCELLED");
    expect(result.penaltyMinor).toBe(result.paidMinor);
    expect(result.refundDueMinor).toBe(0);
    expect(result.refundRequired).toBe(false);
    expect(result.refundRequestId).toBeNull();

    const refunds = await db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(refunds).toHaveLength(0);
  });

  it("returns NOT_FOUND for another authenticated account without a guest reservation link", async () => {
    const ready = await confirmedReservationFixture(0);

    const otherGuest = await createUser("OtherGuest");

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(CANCELLED_AT).cancel(
          trx,
          otherGuest,
          {
            reservationId: ready.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");
  });

  it("rejects an owned reservation outside CONFIRMED state before cancellation mutation", async () => {
    const ready = await confirmedReservationFixture(0);

    await db
      .updateTable("reservations")
      .set({
        status: "CHECKED_IN"
      })
      .where("id", "=", ready.held.reservation.id)
      .execute();

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(CANCELLED_AT).cancel(
          trx,
          ready.guestActor,
          {
            reservationId: ready.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const decisions = await db
      .selectFrom("reservation_cancellation_decisions")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(decisions).toHaveLength(0);
  });

  it("rejects cancellation exactly at or after the canonical arrival instant", async () => {
    const exact = await confirmedReservationFixture(0);

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(ARRIVAL_AT).cancel(
          trx,
          exact.guestActor,
          {
            reservationId: exact.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    const after = await confirmedReservationFixture(0);

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(new Date(ARRIVAL_AT.getTime() + 60_000)).cancel(
          trx,
          after.guestActor,
          {
            reservationId: after.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("fails closed when recognized revenue is reported for a confirmed reservation", async () => {
    const ready = await confirmedReservationFixture(0);

    const ledger = new FinancialLedgerRepository();

    ledger.findRecognizedRevenueForReservationForUpdate = async () => [{} as never];

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(CANCELLED_AT, { ledger }).cancel(
          trx,
          ready.guestActor,
          {
            reservationId: ready.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409,
      details: {
        manualReviewRequired: true
      }
    });

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");

    const decisions = await db
      .selectFrom("reservation_cancellation_decisions")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(decisions).toHaveLength(0);
  });

  it("rolls back decision inventory status history and other cancellation mutations when a late refund step fails", async () => {
    const ready = await confirmedReservationFixture(0);

    const allocationBefore = await db
      .selectFrom("inventory_allocations")
      .select(["status", "release_reason"])
      .where("id", "=", ready.processed.inventoryAllocationId!)
      .executeTakeFirstOrThrow();

    const nights = await db
      .selectFrom("inventory_allocation_nights")
      .select(["bucket_id", "quantity"])
      .where("allocation_id", "=", ready.processed.inventoryAllocationId!)
      .execute();

    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))];

    const bucketsBefore = await db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "confirmed_quantity"])
      .where("id", "in", bucketIds)
      .execute();

    const forcedRefundFailure = new PaymentRefundRequestService();

    forcedRefundFailure.ensureForCancellationDecision = async () => {
      throw new Error("FORCED_LATE_CANCELLATION_FAILURE");
    };

    await expect(
      db.transaction().execute((trx) =>
        serviceAt(CANCELLED_AT, {
          refundRequests: forcedRefundFailure
        }).cancel(
          trx,
          ready.guestActor,
          {
            reservationId: ready.held.reservation.id
          },
          metadata()
        )
      )
    ).rejects.toThrow("FORCED_LATE_CANCELLATION_FAILURE");

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");

    const decisions = await db
      .selectFrom("reservation_cancellation_decisions")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(decisions).toHaveLength(0);

    const allocationAfter = await db
      .selectFrom("inventory_allocations")
      .select(["status", "release_reason"])
      .where("id", "=", ready.processed.inventoryAllocationId!)
      .executeTakeFirstOrThrow();

    expect(allocationAfter).toEqual(allocationBefore);

    const bucketsAfter = await db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "confirmed_quantity"])
      .where("id", "in", bucketIds)
      .execute();

    expect([...bucketsAfter].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...bucketsBefore].sort((a, b) => a.id.localeCompare(b.id))
    );

    const histories = await db
      .selectFrom("reservation_status_history")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("reason", "=", "GUEST_CANCELLATION")
      .execute();

    expect(histories).toHaveLength(0);

    const refunds = await db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("reservation_id", "=", ready.held.reservation.id)
      .execute();

    expect(refunds).toHaveLength(0);

    const audits = await db
      .selectFrom("audit_events")
      .select("id")
      .where("entity_id", "=", ready.held.reservation.id)
      .where("action", "=", "guest.reservation.cancelled")
      .execute();

    expect(audits).toHaveLength(0);

    const outbox = await db
      .selectFrom("outbox_events")
      .select("id")
      .where("aggregate_id", "=", ready.held.reservation.id)
      .where("event_type", "=", "reservation.cancelled.v1")
      .execute();

    expect(outbox).toHaveLength(0);
  });
});
