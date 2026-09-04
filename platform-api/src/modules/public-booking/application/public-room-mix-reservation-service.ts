import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import { InventoryHoldService } from "../../inventory/application/inventory-hold-service.js";
import type {
  HeldReservationResult,
  LeadGuestInput,
  LeadGuestSnapshotView
} from "../../reservations/domain/reservation.js";
import { ReservationRepository } from "../../reservations/infrastructure/reservation-repository.js";
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";
import { RoomMixRepository } from "../infrastructure/room-mix-repository.js";

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

export class PublicRoomMixReservationService {
  constructor(
    private readonly properties = new PublicAvailabilityRepository(),
    private readonly roomMixes = new RoomMixRepository(),
    private readonly holds = new InventoryHoldService(),
    private readonly reservations = new ReservationRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async create(
    trx: Transaction<Database>,
    publicSlug: string,
    roomMixQuoteId: string,
    leadGuestInput: LeadGuestInput,
    request: RequestMetadata,
    createdByUserId: string | null
  ): Promise<HeldReservationResult> {
    if (request.source !== "public-api") {
      throw new ValidationError("Room-mix public reservation requires public-api request source");
    }

    const leadGuest = normalizeLeadGuest(leadGuestInput);
    const property = await this.properties.findLivePropertyBySlug(trx, publicSlug.toLowerCase());
    if (!property) throw new NotFoundError("Public property not found");

    const roomMix = await this.roomMixes.findQuoteForUpdate(
      trx,
      property.organization_id,
      property.id,
      roomMixQuoteId
    );
    if (!roomMix) throw new NotFoundError("Mixed-room quote not found");

    const existing = await this.reservations.findByRoomMixQuote(
      trx,
      property.organization_id,
      property.id,
      roomMix.id
    );
    if (existing) {
      const view = await this.reservations.view(trx, existing, this.now());
      if (!sameLeadGuest(view.leadGuest, leadGuest)) {
        throw new ConflictError(
          "This mixed-room quote already has a reservation with a different lead guest",
          { reservationId: existing.id }
        );
      }
      return { created: false, reservation: view };
    }

    const roomMixHold = await this.roomMixes.findHold(
      trx,
      property.organization_id,
      property.id,
      roomMix.id
    );
    if (!roomMixHold) {
      throw new ConflictError(
        "Create the mixed-room inventory hold before creating the reservation",
        { roomMixQuoteId: roomMix.id }
      );
    }

    const holdResult = await this.holds.getHoldSystem(
      trx,
      property.organization_id,
      property.id,
      roomMixHold.inventory_hold_id,
      request
    );
    const hold = holdResult.hold;
    if (hold.status !== "ACTIVE") {
      throw new ConflictError("The mixed-room inventory hold is no longer active", {
        roomMixQuoteId: roomMix.id,
        inventoryHoldId: hold.id,
        holdStatus: hold.status
      });
    }

    const now = this.now();
    const holdExpiresAt = new Date(hold.expiresAt);
    if (roomMix.expires_at <= now || holdExpiresAt <= now || holdExpiresAt > roomMix.expires_at) {
      throw new ConflictError("The mixed-room quote or inventory hold has expired", {
        roomMixQuoteId: roomMix.id,
        roomMixExpiresAt: roomMix.expires_at.toISOString(),
        holdExpiresAt: hold.expiresAt
      });
    }

    const created = await this.reservations.createRoomMixReservation(trx, {
      organizationId: property.organization_id,
      propertyId: property.id,
      reservationReference: reservationReference(),
      roomMixQuoteId: roomMix.id,
      inventoryHoldId: hold.id,
      holdExpiresAt,
      arrivalDate: roomMix.arrival_date,
      departureDate: roomMix.departure_date,
      quantity: roomMix.quantity,
      currencyCode: roomMix.currency_code,
      totalMinor: roomMix.total_minor,
      createdByUserId,
      request
    });

    if (!created) {
      const raced = await this.reservations.findByRoomMixQuote(
        trx,
        property.organization_id,
        property.id,
        roomMix.id
      );
      if (!raced) throw new ConflictError("Mixed-room reservation could not be created");

      const view = await this.reservations.view(trx, raced, this.now());
      if (!sameLeadGuest(view.leadGuest, leadGuest)) {
        throw new ConflictError(
          "This mixed-room quote was concurrently accepted with a different lead guest",
          { reservationId: raced.id }
        );
      }
      return { created: false, reservation: view };
    }

    await this.reservations.createRoomMixFinancialSnapshot(trx, {
      reservation_id: created.id,
      room_mix_quote_id: roomMix.id,
      organization_id: property.organization_id,
      property_id: property.id,
      room_mix_reference: roomMix.room_mix_reference,
      product_label: "Mixed rooms",
      arrival_date: roomMix.arrival_date,
      departure_date: roomMix.departure_date,
      quantity: roomMix.quantity,
      currency_code: roomMix.currency_code,
      gross_accommodation_minor: roomMix.gross_accommodation_minor,
      gross_extra_guest_minor: roomMix.gross_extra_guest_minor,
      accommodation_discount_minor: roomMix.accommodation_discount_minor,
      extra_guest_discount_minor: roomMix.extra_guest_discount_minor,
      discount_minor: roomMix.discount_minor,
      discounted_accommodation_minor: roomMix.discounted_accommodation_minor,
      discounted_extra_guest_minor: roomMix.discounted_extra_guest_minor,
      inclusive_fee_minor: roomMix.inclusive_fee_minor,
      exclusive_fee_minor: roomMix.exclusive_fee_minor,
      fee_minor: roomMix.fee_minor,
      inclusive_tax_minor: roomMix.inclusive_tax_minor,
      exclusive_tax_minor: roomMix.exclusive_tax_minor,
      tax_minor: roomMix.tax_minor,
      total_minor: roomMix.total_minor
    });

    await this.reservations.createLeadGuestSnapshot(trx, {
      reservationId: created.id,
      organizationId: property.organization_id,
      propertyId: property.id,
      guestName: leadGuest.name,
      email: leadGuest.email,
      phone: leadGuest.phone
    });

    await this.reservations.createInitialStatusHistory(trx, {
      reservationId: created.id,
      organizationId: property.organization_id,
      propertyId: property.id,
      actorUserId: createdByUserId,
      request
    });

    const view = await this.reservations.view(trx, created, this.now());

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      actorRole: "PUBLIC_BOOKING",
      organizationId: property.organization_id,
      propertyId: property.id,
      action: "reservation.room_mix.held.created",
      entityType: "reservation",
      entityId: created.id,
      after: {
        reservationId: created.id,
        reservationReference: created.reservation_reference,
        roomMixQuoteId: roomMix.id,
        inventoryHoldId: hold.id,
        status: created.status,
        holdExpiresAt: hold.expiresAt,
        currencyCode: roomMix.currency_code,
        totalMinor: roomMix.total_minor
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "reservation",
      aggregateId: created.id,
      eventType: "reservation.room_mix.held.created.v1",
      payload: {
        reservationId: created.id,
        reservationReference: created.reservation_reference,
        roomMixQuoteId: roomMix.id,
        propertyId: property.id,
        inventoryHoldId: hold.id,
        status: created.status,
        holdExpiresAt: hold.expiresAt,
        currencyCode: roomMix.currency_code,
        totalMinor: roomMix.total_minor
      }
    });

    return { created: true, reservation: view };
  }
}
