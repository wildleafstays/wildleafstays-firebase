import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type {
  IdentityVerifier,
  VerifiedIdentity
} from "../src/infrastructure/identity/identity-verifier.js";
import { AccessRepository } from "../src/modules/access/infrastructure/access-repository.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { GuestSelfServiceRepository } from "../src/modules/guest/infrastructure/guest-self-service-repository.js";
import { registerGuestSelfServiceRoutes } from "../src/modules/guest/transport/guest-self-service-routes.js";
import { UserRepository } from "../src/modules/identity/infrastructure/user-repository.js";
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
import { registerErrorHandler } from "../src/shared/http/error-handler.js";

const config = loadConfig();
const db = createDatabase(config);

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
      auth_provider: "firebase",
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

async function confirmedReservationFixture(
  cancellationBasisPoints = 0,
  existingGuestActor?: ActorContext
) {
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

  const guestActor = existingGuestActor ?? (await createUser("Guest"));

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

let app: FastifyInstance;
let identityVerifier: HttpIdentityVerifier;

class HttpIdentityVerifier implements IdentityVerifier {
  private readonly identities = new Map<string, VerifiedIdentity>();

  async issueForUser(userId: string): Promise<string> {
    const user = await db
      .selectFrom("users")
      .select(["auth_provider", "auth_subject", "email", "display_name", "email_verified"])
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();

    if (user.auth_provider !== "firebase") {
      throw new Error("Phase 8B HTTP fixture requires firebase-backed test user");
    }

    const token = `phase8b-http-${randomUUID().replaceAll("-", "")}`;

    this.identities.set(token, {
      provider: "firebase",
      subject: user.auth_subject,
      email: user.email,
      displayName: user.display_name,
      emailVerified: user.email_verified
    });

    return token;
  }

  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    const identity = this.identities.get(token);

    if (!identity) {
      throw new Error("Invalid Phase 8B HTTP test identity token");
    }

    return identity;
  }
}

interface CancellationHttpBody {
  reservationId: string;
  status: "CANCELLED";
  cancelledAt: string;
  arrivalAt: string;
  minutesBeforeArrival: number;
  penaltyType: "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS";
  penaltyMinor: number;
  paidMinor: number;
  refundDueMinor: number;
  currencyCode: string;
  refundRequired: boolean;
}

async function issueToken(actor: ActorContext): Promise<string> {
  return identityVerifier.issueForUser(actor.userId);
}

async function cancelViaHttp(input: {
  reservationId: string;
  token?: string;
  idempotencyKey?: string;
}) {
  const headers: Record<string, string> = {};

  if (input.token !== undefined) {
    headers["authorization"] = `Bearer ${input.token}`;
  }

  if (input.idempotencyKey !== undefined) {
    headers["idempotency-key"] = input.idempotencyKey;
  }

  return app.inject({
    method: "POST",
    url: `/v1/guest/reservations/` + `${input.reservationId}/cancel`,
    headers
  });
}

async function cancellationState(ready: Awaited<ReturnType<typeof confirmedReservationFixture>>) {
  const reservationId = ready.held.reservation.id;

  const [reservation, decisions, refunds, audits, outbox, allocation] = await Promise.all([
    db
      .selectFrom("reservations")
      .select("status")
      .where("id", "=", reservationId)
      .executeTakeFirstOrThrow(),

    db
      .selectFrom("reservation_cancellation_decisions")
      .select("id")
      .where("reservation_id", "=", reservationId)
      .execute(),

    db
      .selectFrom("payment_refund_requests")
      .select("id")
      .where("reservation_id", "=", reservationId)
      .where("refund_source", "=", "RESERVATION_CANCELLATION")
      .execute(),

    db
      .selectFrom("audit_events")
      .select("id")
      .where("entity_id", "=", reservationId)
      .where("action", "=", "guest.reservation.cancelled")
      .execute(),

    db
      .selectFrom("outbox_events")
      .select("id")
      .where("aggregate_id", "=", reservationId)
      .where("event_type", "=", "reservation.cancelled.v1")
      .execute(),

    db
      .selectFrom("inventory_allocations")
      .select(["status", "release_reason"])
      .where("id", "=", ready.processed.inventoryAllocationId!)
      .executeTakeFirstOrThrow()
  ]);

  const allocationNights = await db
    .selectFrom("inventory_allocation_nights")
    .select("bucket_id")
    .where("allocation_id", "=", ready.processed.inventoryAllocationId!)
    .execute();

  const bucketIds = [...new Set(allocationNights.map((night) => night.bucket_id))];

  const buckets =
    bucketIds.length === 0
      ? []
      : await db
          .selectFrom("inventory_daily_buckets")
          .select(["id", "confirmed_quantity"])
          .where("id", "in", bucketIds)
          .orderBy("id", "asc")
          .execute();

  return {
    status: reservation.status,
    decisionCount: decisions.length,
    refundCount: refunds.length,
    auditCount: audits.length,
    outboxCount: outbox.length,
    allocation,
    buckets
  };
}

function expectNoCancellationMutation(state: Awaited<ReturnType<typeof cancellationState>>): void {
  expect(state.status).toBe("CONFIRMED");
  expect(state.decisionCount).toBe(0);
  expect(state.refundCount).toBe(0);
  expect(state.auditCount).toBe(0);
  expect(state.outboxCount).toBe(0);
  expect(state.allocation.status).toBe("CONFIRMED");
}

beforeAll(async () => {
  app = Fastify({
    logger: false
  });

  app.decorateRequest("actor", null);
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", async (request, reply) => {
    request.correlationId = request.id;

    void reply.header("x-request-id", request.id);

    void reply.header("x-correlation-id", request.correlationId);
  });

  registerErrorHandler(app);

  identityVerifier = new HttpIdentityVerifier();

  await registerGuestSelfServiceRoutes(app, {
    db,
    identityVerifier,
    userRepository: new UserRepository(db),
    accessRepository: new AccessRepository(db)
  });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Phase 8B guest cancellation HTTP and idempotency", () => {
  it("[8B-S4-35] requires authentication and returns 401 without cancellation mutation", async () => {
    const ready = await confirmedReservationFixture(0);

    const response = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      idempotencyKey: `s4-unauth-${randomUUID()}`
    });

    expect(response.statusCode).toBe(401);

    expectNoCancellationMutation(await cancellationState(ready));
  });

  it("[8B-S4-36] rejects missing and malformed idempotency keys with 400 and no mutation", async () => {
    const ready = await confirmedReservationFixture(0);

    const token = await issueToken(ready.guestActor);

    const missing = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token
    });

    expect(missing.statusCode).toBe(400);

    expectNoCancellationMutation(await cancellationState(ready));

    const malformed = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token,
      idempotencyKey: "short"
    });

    expect(malformed.statusCode).toBe(400);

    expectNoCancellationMutation(await cancellationState(ready));
  });

  it("[8B-S4-37/38/42] returns only safe cancellation economics and exact replay creates no duplicate canonical side effects", async () => {
    const ready = await confirmedReservationFixture(0);

    const token = await issueToken(ready.guestActor);

    const key = `s4-replay-${randomUUID()}`;

    const first = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token,
      idempotencyKey: key
    });

    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store, private");

    expect(first.headers["idempotency-replayed"]).toBeUndefined();

    const firstBody = first.json() as CancellationHttpBody;

    expect(firstBody).toMatchObject({
      reservationId: ready.held.reservation.id,
      status: "CANCELLED",
      penaltyMinor: 0,
      refundRequired: true
    });

    expect(firstBody.refundDueMinor).toBe(firstBody.paidMinor);

    expect(Object.keys(firstBody).sort()).toEqual(
      [
        "reservationId",
        "status",
        "cancelledAt",
        "arrivalAt",
        "minutesBeforeArrival",
        "penaltyType",
        "penaltyMinor",
        "paidMinor",
        "refundDueMinor",
        "currencyCode",
        "refundRequired"
      ].sort()
    );

    const unsafeBody = first.json() as Record<string, unknown>;

    for (const forbidden of [
      "refundRequestId",
      "paymentIntentId",
      "paymentEvidenceId",
      "provider",
      "providerPaymentId",
      "cancellationDecisionId"
    ]) {
      expect(unsafeBody).not.toHaveProperty(forbidden);
    }

    const afterFirst = await cancellationState(ready);

    expect(afterFirst.status).toBe("CANCELLED");
    expect(afterFirst.decisionCount).toBe(1);
    expect(afterFirst.refundCount).toBe(1);
    expect(afterFirst.auditCount).toBe(1);
    expect(afterFirst.outboxCount).toBe(1);
    expect(afterFirst.allocation).toEqual({
      status: "RELEASED",
      release_reason: "BOOKING_CANCELLED"
    });

    const cancellationRefund = await db
      .selectFrom("payment_refund_requests")
      .select(["id", "cancellation_decision_id", "reconciliation_case_id", "amount_minor"])
      .where("reservation_id", "=", ready.held.reservation.id)
      .where("refund_source", "=", "RESERVATION_CANCELLATION")
      .executeTakeFirstOrThrow();

    expect(cancellationRefund.cancellation_decision_id).not.toBeNull();

    expect(cancellationRefund.reconciliation_case_id).toBeNull();

    const providerSubmissions = await db
      .selectFrom("payment_refund_submissions")
      .select("id")
      .where("refund_request_id", "=", cancellationRefund.id)
      .execute();

    expect(providerSubmissions).toHaveLength(0);

    const replay = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token,
      idempotencyKey: key
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.headers["cache-control"]).toBe("no-store, private");
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    expect(replay.json()).toEqual(first.json());

    const afterReplay = await cancellationState(ready);

    expect(afterReplay).toEqual(afterFirst);
  });

  it("[8B-S4-39] same guest reusing one key for another reservation receives 409 and second reservation stays untouched", async () => {
    const firstReady = await confirmedReservationFixture(0);

    const secondReady = await confirmedReservationFixture(0, firstReady.guestActor);

    const token = await issueToken(firstReady.guestActor);

    const key = `s4-identity-${randomUUID()}`;

    const first = await cancelViaHttp({
      reservationId: firstReady.held.reservation.id,
      token,
      idempotencyKey: key
    });

    expect(first.statusCode).toBe(200);

    const conflict = await cancelViaHttp({
      reservationId: secondReady.held.reservation.id,
      token,
      idempotencyKey: key
    });

    expect(conflict.statusCode).toBe(409);

    expectNoCancellationMutation(await cancellationState(secondReady));
  });

  it("[8B-S4-20/40] cross-account access is 404 and equal keys remain independent across authenticated users", async () => {
    const guestOneReady = await confirmedReservationFixture(0);

    const guestTwoReady = await confirmedReservationFixture(0);

    const guestOneToken = await issueToken(guestOneReady.guestActor);

    const guestTwoToken = await issueToken(guestTwoReady.guestActor);

    const unauthorized = await cancelViaHttp({
      reservationId: guestOneReady.held.reservation.id,
      token: guestTwoToken,
      idempotencyKey: `s4-cross-${randomUUID()}`
    });

    expect(unauthorized.statusCode).toBe(404);

    expectNoCancellationMutation(await cancellationState(guestOneReady));

    const sharedKey = `s4-shared-${randomUUID()}`;

    const firstUser = await cancelViaHttp({
      reservationId: guestOneReady.held.reservation.id,
      token: guestOneToken,
      idempotencyKey: sharedKey
    });

    expect(firstUser.statusCode).toBe(200);

    const secondUser = await cancelViaHttp({
      reservationId: guestTwoReady.held.reservation.id,
      token: guestTwoToken,
      idempotencyKey: sharedKey
    });

    expect(secondUser.statusCode).toBe(200);
  });

  it("[8B-S4-41] a distinct key after canonical cancellation returns 409 without duplicating cancellation side effects", async () => {
    const ready = await confirmedReservationFixture(0);

    const token = await issueToken(ready.guestActor);

    const first = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token,
      idempotencyKey: `s4-first-${randomUUID()}`
    });

    expect(first.statusCode).toBe(200);

    const canonicalState = await cancellationState(ready);

    const second = await cancelViaHttp({
      reservationId: ready.held.reservation.id,
      token,
      idempotencyKey: `s4-second-${randomUUID()}`
    });

    expect(second.statusCode).toBe(409);

    expect(await cancellationState(ready)).toEqual(canonicalState);
  });
});
