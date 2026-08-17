import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { InventoryHoldService } from "../../inventory/application/inventory-hold-service.js";
import { QuoteHoldRepository } from "../../quotes/infrastructure/quote-hold-repository.js";
import { QuoteRepository } from "../../quotes/infrastructure/quote-repository.js";
import type {
  HeldReservationResult,
  LeadGuestInput,
  LeadGuestSnapshotView
} from "../domain/reservation.js";
import { ReservationRepository } from "../infrastructure/reservation-repository.js";

function reservationReference(): string {
  return `R-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

function normalizeLeadGuest(input: LeadGuestInput): LeadGuestSnapshotView {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 160) {
    throw new ValidationError("Lead guest name must contain between 1 and 160 characters");
  }

  const email = input.email?.trim().toLowerCase() || null;
  if (email !== null && (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new ValidationError("Lead guest email is invalid");
  }

  const phone = input.phone?.trim().replace(/[\s()-]/g, "") || null;
  if (phone !== null && !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new ValidationError("Lead guest phone must use E.164 format, for example +919876543210");
  }

  if (email === null && phone === null) {
    throw new ValidationError("Lead guest requires at least an email address or phone number");
  }

  return { name, email, phone };
}

function sameLeadGuest(a: LeadGuestSnapshotView, b: LeadGuestSnapshotView): boolean {
  return a.name === b.name && a.email === b.email && a.phone === b.phone;
}

export class HeldReservationService {
  constructor(
    private readonly reservations = new ReservationRepository(),
    private readonly quotes = new QuoteRepository(),
    private readonly quoteHolds = new QuoteHoldRepository(),
    private readonly holds = new InventoryHoldService(),
    private readonly authorization = new AuthorizationService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async createFromQuoteHold(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
      leadGuest: LeadGuestInput;
    },
    request: RequestMetadata
  ): Promise<HeldReservationResult> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const leadGuest = normalizeLeadGuest(input.leadGuest);

    const lockedQuote = await this.quoteHolds.lockQuote(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (!lockedQuote) {
      throw new NotFoundError("Quote not found");
    }

    const quote = await this.quotes.find(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (!quote) {
      throw new NotFoundError("Quote not found");
    }

    const existing = await this.reservations.findByQuote(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (existing) {
      const view = await this.reservations.view(trx, existing, this.now());
      if (!sameLeadGuest(view.leadGuest, leadGuest)) {
        throw new ConflictError(
          "This quote already has a reservation with a different immutable lead-guest snapshot",
          { reservationId: existing.id }
        );
      }
      return { created: false, reservation: view };
    }

    if (
      quote.commercialStatus !== "COMMERCIAL_RULES_APPLIED" ||
      quote.promotionStatus !== "EVALUATED" ||
      !quote.holdEligible ||
      quote.promotion === null
    ) {
      throw new ConflictError(
        "Only a final commercially evaluated quote can create a reservation",
        {
          quoteId: quote.id,
          commercialStatus: quote.commercialStatus,
          promotionStatus: quote.promotionStatus,
          holdEligible: quote.holdEligible
        }
      );
    }

    const quoteHold = await this.quoteHolds.findByQuote(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (!quoteHold) {
      throw new ConflictError(
        "Create an inventory hold from this quote before creating a reservation",
        {
          quoteId: quote.id
        }
      );
    }

    const holdResult = await this.holds.getHold(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      quoteHold.inventory_hold_id,
      request,
      Permissions.RESERVATION_MANAGE
    );
    const hold = holdResult.hold;

    if (hold.status !== "ACTIVE") {
      throw new ConflictError("The quote-linked inventory hold is no longer active", {
        quoteId: quote.id,
        inventoryHoldId: hold.id,
        holdStatus: hold.status
      });
    }

    const now = this.now();
    const holdExpiresAt = new Date(hold.expiresAt);
    const quoteExpiresAt = new Date(quote.expiresAt);
    if (holdExpiresAt <= now || quoteExpiresAt <= now || holdExpiresAt > quoteExpiresAt) {
      throw new ConflictError("The quote or its linked inventory hold has expired", {
        quoteId: quote.id,
        quoteExpiresAt: quote.expiresAt,
        holdExpiresAt: hold.expiresAt
      });
    }

    const created = await this.reservations.createReservation(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationReference: reservationReference(),
      quoteId: quote.id,
      quoteInventoryHoldId: quoteHold.id,
      inventoryHoldId: hold.id,
      holdExpiresAt,
      arrivalDate: quote.arrivalDate,
      departureDate: quote.departureDate,
      productType: quote.productType,
      roomCategoryId: quote.roomCategoryId,
      quantity: quote.quantity,
      currencyCode: quote.currencyCode,
      totalMinor: quote.totalMinor,
      createdByUserId: actor.userId,
      request
    });

    if (!created) {
      const raced = await this.reservations.findByQuote(
        trx,
        input.organizationId,
        input.propertyId,
        input.quoteId
      );
      if (!raced) {
        throw new ConflictError("Reservation could not be created");
      }

      const view = await this.reservations.view(trx, raced, this.now());
      if (!sameLeadGuest(view.leadGuest, leadGuest)) {
        throw new ConflictError(
          "This quote was concurrently accepted with a different lead-guest snapshot",
          { reservationId: raced.id }
        );
      }
      return { created: false, reservation: view };
    }

    const accommodationDiscountMinor =
      quote.accommodationMinor - quote.discountedAccommodationMinor;
    const extraGuestDiscountMinor = quote.extraGuestMinor - quote.discountedExtraGuestMinor;

    await this.reservations.createFinancialSnapshot(trx, {
      reservation_id: created.id,
      quote_id: quote.id,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      quote_reference: quote.quoteReference,
      rate_plan_id: quote.ratePlanId,
      rate_plan_code: quote.ratePlanCode,
      rate_plan_name: quote.ratePlanName,
      meal_plan_code: quote.mealPlanCode,
      rate_product_id: quote.rateProductId,
      rate_product_version: quote.rateProductVersion,
      product_type: quote.productType,
      product_label: quote.productLabel,
      room_category_id: quote.roomCategoryId,
      arrival_date: quote.arrivalDate,
      departure_date: quote.departureDate,
      quantity: quote.quantity,
      commercial_status: "COMMERCIAL_RULES_APPLIED",
      promotion_status: "EVALUATED",
      currency_code: quote.currencyCode,
      gross_accommodation_minor: quote.accommodationMinor,
      gross_extra_guest_minor: quote.extraGuestMinor,
      accommodation_discount_minor: accommodationDiscountMinor,
      extra_guest_discount_minor: extraGuestDiscountMinor,
      discount_minor: quote.discountMinor,
      discounted_accommodation_minor: quote.discountedAccommodationMinor,
      discounted_extra_guest_minor: quote.discountedExtraGuestMinor,
      inclusive_fee_minor: quote.inclusiveFeeMinor,
      exclusive_fee_minor: quote.exclusiveFeeMinor,
      fee_minor: quote.feeMinor,
      inclusive_tax_minor: quote.inclusiveTaxMinor,
      exclusive_tax_minor: quote.exclusiveTaxMinor,
      tax_minor: quote.taxMinor,
      total_minor: quote.totalMinor
    });

    await this.reservations.createLeadGuestSnapshot(trx, {
      reservationId: created.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      guestName: leadGuest.name,
      email: leadGuest.email,
      phone: leadGuest.phone
    });

    await this.reservations.createInitialStatusHistory(trx, {
      reservationId: created.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      actorUserId: actor.userId,
      request
    });

    const view = await this.reservations.view(trx, created, this.now());

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "reservation.held.created",
      entityType: "reservation",
      entityId: created.id,
      after: {
        reservationId: created.id,
        reservationReference: created.reservation_reference,
        quoteId: quote.id,
        inventoryHoldId: hold.id,
        status: created.status,
        holdExpiresAt: hold.expiresAt,
        currencyCode: quote.currencyCode,
        totalMinor: quote.totalMinor
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "reservation",
      aggregateId: created.id,
      eventType: "reservation.held.created.v1",
      payload: {
        reservationId: created.id,
        reservationReference: created.reservation_reference,
        quoteId: quote.id,
        propertyId: input.propertyId,
        inventoryHoldId: hold.id,
        status: created.status,
        holdExpiresAt: hold.expiresAt,
        currencyCode: quote.currencyCode,
        totalMinor: quote.totalMinor
      }
    });

    return { created: true, reservation: view };
  }

  async getReservation(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<{ reservation: Awaited<ReturnType<ReservationRepository["view"]>> }> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId,
      propertyId
    });

    const reservation = await this.reservations.findById(
      trx,
      organizationId,
      propertyId,
      reservationId
    );
    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    return { reservation: await this.reservations.view(trx, reservation, this.now()) };
  }
}
