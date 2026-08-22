import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { calculateGuestCancellationEconomics } from "../src/modules/guest/application/guest-cancellation-economics.js";
import { GuestCancellationInventoryService } from "../src/modules/guest/application/guest-cancellation-inventory-service.js";
import { GuestCancellationPaymentProofService } from "../src/modules/guest/application/guest-cancellation-payment-proof.js";
import { GuestCancellationRepository } from "../src/modules/guest/infrastructure/guest-cancellation-repository.js";
import { InventoryAllocationService } from "../src/modules/inventory/application/inventory-allocation-service.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
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

afterAll(async () => {
  await db.destroy();
});

function metadata() {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source: "phase-8b-slice2-integration-test",
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
  const subject = `phase8b-s2-${randomUUID()}`;

  const user = await db
    .insertInto("users")
    .values({
      id: randomUUID(),
      auth_provider: "test",
      auth_subject: subject,
      email: `${subject}@example.invalid`,
      display_name: "Phase 8B Slice 2 Guest",
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
        legalName: `Phase 8B Slice 2 Org ${randomUUID()}`,
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
        name: `Phase 8B Slice 2 Property ${randomUUID()}`,
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
          unitCode: `S2-${index}-${randomUUID().slice(0, 6)}`,
          displayName: `Slice 2 Room ${index}`,
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

async function configureCommercialCore(fixture: Fixture) {
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
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        cancellationPolicyId: cancellation.policy.id,
        effectiveFrom,
        arrivalLocalTime: "14:00",
        policyText: "Phase 8B immutable cancellation snapshot.",
        tiers: [
          {
            triggerType: "CANCELLATION",
            minimumMinutesBeforeArrival: 0,
            penaltyType: "PERCENTAGE_OF_STAY",
            penaltyValue: 10_000
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

async function confirmedReservationFixture() {
  const fixture = await createFixture();
  await configureCommercialCore(fixture);

  const quote = await db.transaction().execute((trx) =>
    new QuoteService().createQuote(
      trx,
      fixture.actor,
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
      fixture.actor,
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
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        quoteId: quote.quote.id,
        leadGuest: {
          name: "Phase 8B Guest",
          email: "phase8b@example.invalid",
          phone: "+919876543210"
        }
      },
      metadata()
    )
  );

  const payment = await db.transaction().execute((trx) =>
    new BeginPaymentService().beginPayment(
      trx,
      fixture.actor,
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
        payloadSha256: "b".repeat(64)
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
    throw new Error("Expected canonical confirmed reservation inventory allocation");
  }

  return {
    fixture,
    quote,
    quoteHold,
    held,
    payment,
    evidence,
    processed
  };
}

describe("Phase 8B guest cancellation internal foundation", () => {
  it("loads immutable booked economics and persists one immutable decision without changing reservation state", async () => {
    const ready = await confirmedReservationFixture();
    const repository = new GuestCancellationRepository();

    const booked = await db.transaction().execute((trx) =>
      repository.loadBookedEconomics(trx, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        quoteId: ready.quote.quote.id
      })
    );

    expect(booked).toBeDefined();

    if (!booked) {
      throw new Error("Expected immutable booked cancellation economics");
    }

    const economics = calculateGuestCancellationEconomics({
      acceptedTotalMinor: ready.held.reservation.totalMinor,
      minutesBeforeArrival: 1_440,
      tiers: booked.tiers.map((row) => ({
        id: row.id,
        triggerType: row.trigger_type,
        minimumMinutesBeforeArrival: row.minimum_minutes_before_arrival,
        penaltyType: row.penalty_type,
        penaltyValue: row.penalty_value
      })),
      nights: booked.nights.map((row) => ({
        stayDate: row.stay_date,
        nightTotalMinor: row.night_total_minor
      }))
    });

    const proof = await db.transaction().execute((trx) =>
      new GuestCancellationPaymentProofService().loadCanonical(trx, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        acceptedTotalMinor: ready.held.reservation.totalMinor,
        currencyCode: ready.held.reservation.currencyCode
      })
    );

    const request = metadata();

    const first = await db.transaction().execute((trx) =>
      repository.insertDecision(trx, {
        reservationId: ready.held.reservation.id,
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        guestUserId: ready.fixture.actor.userId,
        quoteId: ready.quote.quote.id,
        quoteCancellationSnapshotId: booked.snapshot.id,
        quoteCancellationTierSnapshotId: economics.tierSnapshotId,
        paymentIntentId: proof.paymentIntentId,
        paymentEvidenceId: proof.paymentEvidenceId,
        cancelledAt: new Date("2034-02-09T08:30:00.000Z"),
        arrivalAt: new Date("2034-02-10T08:30:00.000Z"),
        minutesBeforeArrival: 1_440,
        tierMinimumMinutesBeforeArrival: economics.tierMinimumMinutesBeforeArrival,
        penaltyType: economics.penaltyType,
        penaltyValue: economics.penaltyValue,
        acceptedTotalMinor: ready.held.reservation.totalMinor,
        paidMinor: proof.paidMinor,
        penaltyMinor: economics.penaltyMinor,
        refundDueMinor: Math.max(0, proof.paidMinor - economics.penaltyMinor),
        currencyCode: proof.currencyCode,
        provider: proof.provider,
        providerPaymentId: proof.providerPaymentId,
        request
      })
    );

    expect(first).toBeDefined();

    const second = await db.transaction().execute((trx) =>
      repository.insertDecision(trx, {
        reservationId: ready.held.reservation.id,
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        guestUserId: ready.fixture.actor.userId,
        quoteId: ready.quote.quote.id,
        quoteCancellationSnapshotId: booked.snapshot.id,
        quoteCancellationTierSnapshotId: economics.tierSnapshotId,
        paymentIntentId: proof.paymentIntentId,
        paymentEvidenceId: proof.paymentEvidenceId,
        cancelledAt: new Date("2034-02-09T08:30:00.000Z"),
        arrivalAt: new Date("2034-02-10T08:30:00.000Z"),
        minutesBeforeArrival: 1_440,
        tierMinimumMinutesBeforeArrival: economics.tierMinimumMinutesBeforeArrival,
        penaltyType: economics.penaltyType,
        penaltyValue: economics.penaltyValue,
        acceptedTotalMinor: ready.held.reservation.totalMinor,
        paidMinor: proof.paidMinor,
        penaltyMinor: economics.penaltyMinor,
        refundDueMinor: Math.max(0, proof.paidMinor - economics.penaltyMinor),
        currencyCode: proof.currencyCode,
        provider: proof.provider,
        providerPaymentId: proof.providerPaymentId,
        request
      })
    );

    expect(second).toBeUndefined();

    const stored = await db
      .transaction()
      .execute((trx) =>
        repository.findExistingDecision(
          trx,
          ready.fixture.organizationId,
          ready.fixture.propertyId,
          ready.held.reservation.id
        )
      );

    expect(stored?.id).toBe(first?.id);

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");

    await expect(
      db
        .updateTable("reservation_cancellation_decisions")
        .set({
          penalty_minor: economics.penaltyMinor === 0 ? 1 : economics.penaltyMinor - 1
        })
        .where("id", "=", first!.id)
        .execute()
    ).rejects.toThrow(/immutable/i);
  });

  it("validates canonical successful payment identity and rejects a different reservation payment", async () => {
    const first = await confirmedReservationFixture();
    const second = await confirmedReservationFixture();

    const service = new GuestCancellationPaymentProofService();

    const proof = await db.transaction().execute((trx) =>
      service.loadCanonical(trx, {
        organizationId: first.fixture.organizationId,
        propertyId: first.fixture.propertyId,
        reservationId: first.held.reservation.id,
        acceptedTotalMinor: first.held.reservation.totalMinor,
        currencyCode: first.held.reservation.currencyCode
      })
    );

    expect(proof.paymentIntentId).toBe(first.payment.paymentIntent.id);

    expect(proof.paymentEvidenceId).toBe(first.evidence.evidence.id);

    expect(proof.inventoryAllocationId).toBe(first.processed.inventoryAllocationId);

    await expect(
      db.transaction().execute((trx) =>
        service.loadCanonical(trx, {
          organizationId: first.fixture.organizationId,
          propertyId: first.fixture.propertyId,
          reservationId: first.held.reservation.id,
          acceptedTotalMinor: first.held.reservation.totalMinor,
          currencyCode: first.held.reservation.currencyCode,
          expectedPaymentIntentId: second.payment.paymentIntent.id
        })
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });

    await expect(
      db.transaction().execute((trx) =>
        service.loadCanonical(trx, {
          organizationId: first.fixture.organizationId,
          propertyId: first.fixture.propertyId,
          reservationId: first.held.reservation.id,
          acceptedTotalMinor: first.held.reservation.totalMinor + 1,
          currencyCode: first.held.reservation.currencyCode
        })
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("releases reservation-owned confirmed inventory exactly once for BOOKING_CANCELLED", async () => {
    const ready = await confirmedReservationFixture();

    const allocationId = ready.processed.inventoryAllocationId;

    if (!allocationId) {
      throw new Error("Expected confirmed allocation id");
    }

    const nights = await db
      .selectFrom("inventory_allocation_nights")
      .select(["bucket_id", "quantity", "stay_date"])
      .where("allocation_id", "=", allocationId)
      .orderBy("stay_date", "asc")
      .execute();

    const bucketIds = [...new Set(nights.map((night) => night.bucket_id))];

    const beforeBuckets = await db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "confirmed_quantity"])
      .where("id", "in", bucketIds)
      .execute();

    const beforeById = new Map(beforeBuckets.map((row) => [row.id, row.confirmed_quantity]));

    const service = new GuestCancellationInventoryService();

    const first = await db.transaction().execute((trx) =>
      service.releaseConfirmedAllocation(trx, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        reservationInventoryHoldId: ready.held.reservation.inventoryHoldId,
        inventoryAllocationId: allocationId,
        actorUserId: ready.fixture.actor.userId,
        request: metadata()
      })
    );

    expect(first.released).toBe(true);
    expect(first.allocation.status).toBe("RELEASED");
    expect(first.allocation.release_reason).toBe("BOOKING_CANCELLED");

    const afterFirst = await db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "confirmed_quantity"])
      .where("id", "in", bucketIds)
      .execute();

    for (const bucket of afterFirst) {
      const expectedDecrease = nights
        .filter((night) => night.bucket_id === bucket.id)
        .reduce((sum, night) => sum + night.quantity, 0);

      expect(bucket.confirmed_quantity).toBe((beforeById.get(bucket.id) ?? 0) - expectedDecrease);
    }

    const eventCountAfterFirst = await db
      .selectFrom("inventory_events")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("organization_id", "=", ready.fixture.organizationId)
      .where("property_id", "=", ready.fixture.propertyId)
      .where("event_type", "=", "ALLOCATION_RELEASED")
      .executeTakeFirstOrThrow();

    expect(Number(eventCountAfterFirst.count)).toBe(nights.length);

    const second = await db.transaction().execute((trx) =>
      service.releaseConfirmedAllocation(trx, {
        organizationId: ready.fixture.organizationId,
        propertyId: ready.fixture.propertyId,
        reservationId: ready.held.reservation.id,
        reservationInventoryHoldId: ready.held.reservation.inventoryHoldId,
        inventoryAllocationId: allocationId,
        actorUserId: ready.fixture.actor.userId,
        request: metadata()
      })
    );

    expect(second.released).toBe(false);

    const afterReplay = await db
      .selectFrom("inventory_daily_buckets")
      .select(["id", "confirmed_quantity"])
      .where("id", "in", bucketIds)
      .execute();

    expect([...afterReplay].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...afterFirst].sort((a, b) => a.id.localeCompare(b.id))
    );

    const eventCountAfterReplay = await db
      .selectFrom("inventory_events")
      .select(({ fn }) => fn.count<number>("id").as("count"))
      .where("organization_id", "=", ready.fixture.organizationId)
      .where("property_id", "=", ready.fixture.propertyId)
      .where("event_type", "=", "ALLOCATION_RELEASED")
      .executeTakeFirstOrThrow();

    expect(Number(eventCountAfterReplay.count)).toBe(nights.length);

    const reservation = await db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", ready.held.reservation.id)
      .executeTakeFirstOrThrow();

    expect(reservation.status).toBe("CONFIRMED");
  });

  it("keeps the generic allocation command blocked for reservation-owned inventory", async () => {
    const ready = await confirmedReservationFixture();

    if (!ready.processed.inventoryAllocationId) {
      throw new Error("Expected confirmed allocation id");
    }

    await expect(
      db
        .transaction()
        .execute((trx) =>
          new InventoryAllocationService().releaseAllocation(
            trx,
            ready.fixture.actor,
            ready.fixture.organizationId,
            ready.fixture.propertyId,
            ready.processed.inventoryAllocationId!,
            "generic-command-must-remain-blocked",
            metadata()
          )
        )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });
});
