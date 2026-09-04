import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { Database } from "../src/infrastructure/database/types.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { CommercialRuleService } from "../src/modules/commercial/application/commercial-rule-service.js";
import { PromotionRuleService } from "../src/modules/commercial/application/promotion-rule-service.js";
import { PaymentVerificationMethods } from "../src/modules/payments/domain/payment-evidence.js";
import { PaymentProcessingOutcomes } from "../src/modules/payments/domain/payment-processing.js";
import { PaymentEvidenceRepository } from "../src/modules/payments/infrastructure/payment-evidence-repository.js";
import { VerifiedPaymentProcessor } from "../src/modules/payments/application/verified-payment-processor.js";
import { CreateOrganizationService } from "../src/modules/organizations/application/create-organization-service.js";
import { PublicRoomMixReservationService } from "../src/modules/public-booking/application/public-room-mix-reservation-service.js";
import { PublicRoomMixService } from "../src/modules/public-booking/application/public-room-mix-service.js";
import { CreatePropertyDraftService } from "../src/modules/properties/application/create-property-draft-service.js";
import { PropertySetupService } from "../src/modules/property-setup/application/property-setup-service.js";
import { RateService } from "../src/modules/rates/application/rate-service.js";
import { BeginPaymentService } from "../src/modules/reservations/application/begin-payment-service.js";

const config = loadConfig();
const db = createDatabase(config);

class RollbackAfterAssertions extends Error {}

function metadata(source: string) {
  return {
    requestId: randomUUID(),
    correlationId: randomUUID(),
    source,
    ipAddress: null,
    userAgent: null
  };
}

interface Fixture {
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

async function createCategory(
  trx: Transaction<Database>,
  fixture: Pick<Fixture, "actor" | "organizationId" | "propertyId">,
  input: {
    code: string;
    name: string;
    maxAdults: number;
    maxChildren: number;
    maxOccupancy: number;
    sortOrder: number;
  }
): Promise<string> {
  const setup = new PropertySetupService();
  const created = await setup.createRoomCategory(
    trx,
    fixture.actor,
    {
      organizationId: fixture.organizationId,
      propertyId: fixture.propertyId,
      code: input.code,
      name: input.name,
      accommodationType: "ROOM",
      description: `${input.name} mixed-checkout test category`,
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
    metadata("integration-test")
  );

  for (let index = 1; index <= 2; index += 1) {
    await setup.createPhysicalUnit(
      trx,
      fixture.actor,
      {
        organizationId: fixture.organizationId,
        propertyId: fixture.propertyId,
        roomCategoryId: created.roomCategory.id,
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
      metadata("integration-test")
    );
  }

  return created.roomCategory.id;
}

async function createFixture(trx: Transaction<Database>): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const user = await trx
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

  const organization = await new CreateOrganizationService().execute(
    trx,
    baseActor,
    {
      legalName: `Room Mix Organization ${suffix}`,
      tradingName: "Wildleaf Room Mix",
      organizationType: "PRIVATE_LIMITED",
      countryCode: "IN",
      currencyCode: "INR"
    },
    metadata("integration-test")
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

  const property = await new CreatePropertyDraftService().execute(
    trx,
    actor,
    {
      organizationId: organization.organizationId,
      name: `Room Mix Property ${suffix}`,
      timezone: "Asia/Kolkata"
    },
    metadata("integration-test")
  );

  const propertyId = property.property.id;
  const publicSlug = `room-mix-${suffix}`;
  await trx
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

  const categoryScope = {
    actor,
    organizationId: organization.organizationId,
    propertyId
  };

  const deluxeCategoryId = await createCategory(trx, categoryScope, {
    code: `DLX-${suffix.slice(0, 4)}`,
    name: "Deluxe Room",
    maxAdults: 2,
    maxChildren: 0,
    maxOccupancy: 2,
    sortOrder: 1
  });
  const superCategoryId = await createCategory(trx, categoryScope, {
    code: `SDLX-${suffix.slice(0, 4)}`,
    name: "Super Deluxe",
    maxAdults: 2,
    maxChildren: 2,
    maxOccupancy: 3,
    sortOrder: 2
  });

  const rates = new RateService();
  const plan = await rates.createRatePlan(
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
    metadata("integration-test")
  );

  const deluxeProduct = await rates.configureRateProduct(
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
    metadata("integration-test")
  );

  const superProduct = await rates.configureRateProduct(
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
    metadata("integration-test")
  );

  const fixture: Fixture = {
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

  const commercial = new CommercialRuleService();
  const effectiveFrom = "2035-01-01";
  await commercial.setPropertyCommercialSettings(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
      effectiveFrom,
      taxMode: "NO_TAX",
      feeMode: "NO_FEES",
      expectedVersion: 0
    },
    metadata("integration-test")
  );
  await commercial.setGuestAgePolicy(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
      effectiveFrom,
      infantMaxAge: 5,
      childMaxAge: 12,
      infantsCountTowardsOccupancy: false,
      infantsCountTowardsChildLimit: false,
      infantsChargeAsChildren: false,
      expectedVersion: 0
    },
    metadata("integration-test")
  );

  const cancellation = await commercial.createCancellationPolicy(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
      code: "MIX-FLEX",
      name: "Mixed Room Flexible",
      description: null
    },
    metadata("integration-test")
  );
  await commercial.createCancellationPolicyVersion(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
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
    metadata("integration-test")
  );
  await commercial.createCancellationAssignment(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
      ratePlanId: fixture.ratePlanId,
      cancellationPolicyId: cancellation.policy.id,
      effectiveFrom
    },
    metadata("integration-test")
  );
  await new PromotionRuleService().setSettings(
    trx,
    actor,
    {
      organizationId: fixture.organizationId,
      propertyId,
      effectiveFrom: "2000-01-01",
      promotionMode: "NO_PROMOTIONS",
      expectedVersion: 0
    },
    metadata("integration-test")
  );

  await trx
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

afterAll(async () => {
  await db.destroy();
});

describe("Atomic room-mix booking core", () => {
  it("confirms both room categories through one reservation and one payment", async () => {
    let rolledBackRoomMixQuoteId: string | null = null;

    try {
      await db.transaction().execute(async (trx) => {
        const fixture = await createFixture(trx);
        const publicRequest = metadata("public-api");

        const quoted = await new PublicRoomMixService().createQuote(
          trx,
          fixture.publicSlug,
          {
            arrivalDate: "2036-03-10",
            departureDate: "2036-03-11",
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
          },
          publicRequest
        );
        const roomMixQuote = quoted.roomMixQuote;
        rolledBackRoomMixQuoteId = roomMixQuote.id;

        expect(roomMixQuote).toMatchObject({
          quantity: 2,
          currencyCode: "INR",
          totalMinor: 1_050_000,
          checkoutSupported: true
        });
        expect(roomMixQuote.items.map((item) => item.roomCategoryId).sort()).toEqual(
          [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
        );

        const firstHold = await new PublicRoomMixService().createHold(
          trx,
          fixture.publicSlug,
          roomMixQuote.id,
          publicRequest
        );
        const repeatedHold = await new PublicRoomMixService().createHold(
          trx,
          fixture.publicSlug,
          roomMixQuote.id,
          publicRequest
        );

        expect(firstHold.created).toBe(true);
        expect(repeatedHold.created).toBe(false);
        expect(repeatedHold.hold.id).toBe(firstHold.hold.id);
        expect(firstHold.hold.items).toHaveLength(2);
        expect(firstHold.hold.items.map((item) => item.roomCategoryId).sort()).toEqual(
          [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
        );

        const reservations = new PublicRoomMixReservationService();
        const firstReservation = await reservations.create(
          trx,
          fixture.publicSlug,
          roomMixQuote.id,
          {
            name: "Vishal Room Mix Guest",
            email: "room.mix.guest@example.com",
            phone: null
          },
          publicRequest,
          null
        );
        const repeatedReservation = await reservations.create(
          trx,
          fixture.publicSlug,
          roomMixQuote.id,
          {
            name: "Vishal Room Mix Guest",
            email: "room.mix.guest@example.com",
            phone: null
          },
          publicRequest,
          null
        );

        expect(firstReservation.created).toBe(true);
        expect(repeatedReservation.created).toBe(false);
        expect(repeatedReservation.reservation.id).toBe(firstReservation.reservation.id);
        expect(firstReservation.reservation).toMatchObject({
          quoteId: null,
          roomMixQuoteId: roomMixQuote.id,
          productType: "ROOM_MIX",
          quantity: 2,
          currencyCode: "INR",
          totalMinor: 1_050_000,
          status: "HELD"
        });

        const payments = new BeginPaymentService();
        const firstPayment = await payments.beginPaymentSystem(
          trx,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            reservationId: firstReservation.reservation.id
          },
          publicRequest
        );
        const repeatedPayment = await payments.beginPaymentSystem(
          trx,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            reservationId: firstReservation.reservation.id
          },
          publicRequest
        );

        expect(firstPayment.created).toBe(true);
        expect(repeatedPayment.created).toBe(false);
        expect(repeatedPayment.paymentIntent.id).toBe(firstPayment.paymentIntent.id);
        expect(firstPayment.paymentIntent).toMatchObject({
          reservationId: firstReservation.reservation.id,
          amountMinor: roomMixQuote.totalMinor,
          currencyCode: "INR",
          status: "PENDING"
        });

        const evidence = await new PaymentEvidenceRepository().create(trx, {
          paymentIntentId: firstPayment.paymentIntent.id,
          organizationId: fixture.organizationId,
          propertyId: fixture.propertyId,
          reservationId: firstReservation.reservation.id,
          provider: "RAZORPAY",
          providerEventId: `evt_${randomUUID().replaceAll("-", "")}`,
          providerPaymentId: `pay_${randomUUID().replaceAll("-", "")}`,
          providerOrderId: `order_${randomUUID().replaceAll("-", "")}`,
          amountMinor: roomMixQuote.totalMinor,
          currencyCode: "INR",
          verificationMethod: PaymentVerificationMethods.PROVIDER_API,
          payloadSha256: "a".repeat(64),
          request: publicRequest
        });
        expect(evidence).toBeDefined();

        const processed = await new VerifiedPaymentProcessor().process(
          trx,
          {
            organizationId: fixture.organizationId,
            propertyId: fixture.propertyId,
            reservationId: firstReservation.reservation.id,
            paymentIntentId: firstPayment.paymentIntent.id,
            paymentEvidenceId: evidence!.id,
            providerCapturedAt: new Date()
          },
          publicRequest
        );

        expect(processed.outcome).toBe(PaymentProcessingOutcomes.RESERVATION_CONFIRMED);
        expect(processed.reconciliationCaseId).toBeNull();
        expect(processed.inventoryAllocationId).not.toBeNull();

        const reservation = await trx
          .selectFrom("reservations")
          .select(["status", "quote_id", "room_mix_quote_id", "inventory_hold_id"])
          .where("id", "=", firstReservation.reservation.id)
          .executeTakeFirstOrThrow();
        expect(reservation).toMatchObject({
          status: "CONFIRMED",
          quote_id: null,
          room_mix_quote_id: roomMixQuote.id,
          inventory_hold_id: firstHold.hold.id
        });

        const mixedFinancial = await trx
          .selectFrom("reservation_room_mix_financial_snapshots")
          .selectAll()
          .where("reservation_id", "=", firstReservation.reservation.id)
          .executeTakeFirstOrThrow();
        const standardFinancial = await trx
          .selectFrom("reservation_financial_snapshots")
          .select("id")
          .where("reservation_id", "=", firstReservation.reservation.id)
          .executeTakeFirst();

        expect(mixedFinancial).toMatchObject({
          room_mix_quote_id: roomMixQuote.id,
          quantity: 2,
          total_minor: roomMixQuote.totalMinor
        });
        expect(standardFinancial).toBeUndefined();

        const allocationItems = await trx
          .selectFrom("inventory_allocation_items")
          .select(["room_category_id", "quantity"])
          .where("allocation_id", "=", processed.inventoryAllocationId!)
          .execute();

        expect(allocationItems).toHaveLength(2);
        expect(allocationItems.map((item) => item.room_category_id).sort()).toEqual(
          [fixture.deluxeCategoryId, fixture.superCategoryId].sort()
        );
        expect(allocationItems.every((item) => item.quantity === 1)).toBe(true);

        throw new RollbackAfterAssertions();
      });
    } catch (error) {
      if (!(error instanceof RollbackAfterAssertions)) throw error;
    }

    expect(rolledBackRoomMixQuoteId).not.toBeNull();
    const persisted = await db
      .selectFrom("room_mix_quotes")
      .select("id")
      .where("id", "=", rolledBackRoomMixQuoteId!)
      .executeTakeFirst();
    expect(persisted).toBeUndefined();
  });
});
