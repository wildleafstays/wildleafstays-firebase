import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import { InventoryHoldService } from "../../inventory/application/inventory-hold-service.js";
import { InventoryBucketTypes } from "../../inventory/domain/inventory.js";
import { QuoteService } from "../../quotes/application/quote-service.js";
import { stayNightCount } from "../../quotes/application/quote-calculator.js";
import type { QuoteView } from "../../quotes/domain/quote.js";
import type {
  PublicRoomMixHoldResult,
  PublicRoomMixQuoteItemView,
  PublicRoomMixQuoteRequest,
  PublicRoomMixQuoteResult,
  PublicRoomMixQuoteView
} from "../domain/public-room-mix.js";
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";
import { RoomMixRepository } from "../infrastructure/room-mix-repository.js";

const PUBLIC_ROOM_MIX_TTL_SECONDS = 900;
const MAX_ROOM_MIX_ITEMS = 6;
const MAX_ROOM_MIX_UNITS = 20;
const MIN_USEFUL_HOLD_MS = 60_000;

function roomMixReference(): string {
  return `RM-${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`;
}

function safeSum(values: number[], label: string): number {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ConflictError(`${label} exceeds safe integer money limits`);
  }
  return result;
}

function assertExactRoomQuote(quote: QuoteView): void {
  if (
    quote.productType !== "ROOM_CATEGORY" ||
    quote.roomCategoryId === null ||
    quote.commercialStatus !== "COMMERCIAL_RULES_APPLIED" ||
    quote.promotionStatus !== "EVALUATED" ||
    !quote.holdEligible ||
    quote.promotion === null
  ) {
    throw new ConflictError("A room mix requires final hold-eligible room-category quotes");
  }

  if (quote.promotion.discountMinor !== 0 || quote.promotion.lines.length !== 0) {
    throw new ConflictError(
      "Mixed-room checkout is temporarily unavailable when a promotion applies; choose standard pricing"
    );
  }

  const unsafeFee = quote.promotion.finalFeeLines.find(
    (line) =>
      line.applicationBasis !== "PER_UNIT_PER_STAY" &&
      line.applicationBasis !== "PER_UNIT_PER_NIGHT"
  );
  if (unsafeFee) {
    throw new ConflictError(
      "Mixed-room checkout is temporarily unavailable because this property has a booking-level fee",
      {
        feePolicyCode: unsafeFee.feePolicyCode,
        applicationBasis: unsafeFee.applicationBasis
      }
    );
  }
}

function publicItem(quote: QuoteView, itemIndex: number): PublicRoomMixQuoteItemView {
  if (quote.roomCategoryId === null) {
    throw new ConflictError("Room-mix quote item is missing its room category");
  }

  return {
    itemIndex,
    quoteId: quote.id,
    quoteReference: quote.quoteReference,
    rateProductId: quote.rateProductId,
    roomCategoryId: quote.roomCategoryId,
    productLabel: quote.productLabel,
    ratePlanCode: quote.ratePlanCode,
    ratePlanName: quote.ratePlanName,
    mealPlanCode: quote.mealPlanCode,
    quantity: quote.quantity,
    accommodationMinor: quote.accommodationMinor,
    extraGuestMinor: quote.extraGuestMinor,
    feeMinor: quote.feeMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    units: quote.units.map((unit) => ({
      adults: unit.adults,
      childAges: [...unit.childAges]
    }))
  };
}

export class PublicRoomMixService {
  constructor(
    private readonly properties = new PublicAvailabilityRepository(),
    private readonly quotes = new QuoteService(),
    private readonly holds = new InventoryHoldService(),
    private readonly roomMixes = new RoomMixRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  private async liveProperty(
    trx: Transaction<Database>,
    publicSlug: string
  ): Promise<{ id: string; organization_id: string }> {
    const property = await this.properties.findLivePropertyBySlug(trx, publicSlug.toLowerCase());
    if (!property) throw new NotFoundError("Public property not found");
    return property;
  }

  async createQuote(
    trx: Transaction<Database>,
    publicSlug: string,
    input: PublicRoomMixQuoteRequest,
    request: RequestMetadata
  ): Promise<PublicRoomMixQuoteResult> {
    stayNightCount(input.arrivalDate, input.departureDate);

    if (input.items.length < 2 || input.items.length > MAX_ROOM_MIX_ITEMS) {
      throw new ValidationError(
        `A mixed-room quote requires between 2 and ${MAX_ROOM_MIX_ITEMS} room-category items`
      );
    }

    const totalUnits = input.items.reduce((sum, item) => sum + item.units.length, 0);
    if (totalUnits < 2 || totalUnits > MAX_ROOM_MIX_UNITS) {
      throw new ValidationError(
        `A mixed-room quote requires between 2 and ${MAX_ROOM_MIX_UNITS} rooms`
      );
    }

    if (input.items.some((item) => item.units.length < 1)) {
      throw new ValidationError("Every mixed-room quote item must contain at least one room");
    }

    const property = await this.liveProperty(trx, publicSlug);
    const childQuotes: QuoteView[] = [];

    for (const item of input.items) {
      const created = await this.quotes.createSystemQuote(
        trx,
        {
          organizationId: property.organization_id,
          propertyId: property.id,
          rateProductId: item.rateProductId,
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          ttlSeconds: PUBLIC_ROOM_MIX_TTL_SECONDS,
          promotionCode: null,
          units: item.units.map((unit) => ({
            adults: unit.adults,
            childAges: [...unit.childAges]
          }))
        },
        request
      );

      assertExactRoomQuote(created.quote);
      childQuotes.push(created.quote);
    }

    const roomCategoryIds = new Set(childQuotes.map((quote) => quote.roomCategoryId));
    if (roomCategoryIds.size < 2) {
      throw new ValidationError(
        "Use the standard room quote for multiple rooms of the same category"
      );
    }

    const currencies = new Set(childQuotes.map((quote) => quote.currencyCode));
    if (currencies.size !== 1) {
      throw new ConflictError("All rooms in a mixed booking must use the same currency");
    }

    const expiresAt = new Date(
      Math.min(...childQuotes.map((quote) => new Date(quote.expiresAt).getTime()))
    );
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= this.now()) {
      throw new ConflictError("Mixed-room quote expired before it could be finalized");
    }

    const aggregate = {
      grossAccommodationMinor: safeSum(
        childQuotes.map((quote) => quote.accommodationMinor),
        "Mixed-room accommodation"
      ),
      grossExtraGuestMinor: safeSum(
        childQuotes.map((quote) => quote.extraGuestMinor),
        "Mixed-room extra guest charges"
      ),
      accommodationDiscountMinor: safeSum(
        childQuotes.map((quote) => quote.accommodationMinor - quote.discountedAccommodationMinor),
        "Mixed-room accommodation discount"
      ),
      extraGuestDiscountMinor: safeSum(
        childQuotes.map((quote) => quote.extraGuestMinor - quote.discountedExtraGuestMinor),
        "Mixed-room extra guest discount"
      ),
      discountMinor: safeSum(
        childQuotes.map((quote) => quote.discountMinor),
        "Mixed-room discount"
      ),
      discountedAccommodationMinor: safeSum(
        childQuotes.map((quote) => quote.discountedAccommodationMinor),
        "Mixed-room discounted accommodation"
      ),
      discountedExtraGuestMinor: safeSum(
        childQuotes.map((quote) => quote.discountedExtraGuestMinor),
        "Mixed-room discounted extra guest charges"
      ),
      inclusiveFeeMinor: safeSum(
        childQuotes.map((quote) => quote.inclusiveFeeMinor),
        "Mixed-room inclusive fees"
      ),
      exclusiveFeeMinor: safeSum(
        childQuotes.map((quote) => quote.exclusiveFeeMinor),
        "Mixed-room exclusive fees"
      ),
      feeMinor: safeSum(
        childQuotes.map((quote) => quote.feeMinor),
        "Mixed-room fees"
      ),
      inclusiveTaxMinor: safeSum(
        childQuotes.map((quote) => quote.inclusiveTaxMinor),
        "Mixed-room inclusive tax"
      ),
      exclusiveTaxMinor: safeSum(
        childQuotes.map((quote) => quote.exclusiveTaxMinor),
        "Mixed-room exclusive tax"
      ),
      taxMinor: safeSum(
        childQuotes.map((quote) => quote.taxMinor),
        "Mixed-room tax"
      ),
      totalMinor: safeSum(
        childQuotes.map((quote) => quote.totalMinor),
        "Mixed-room total"
      )
    };

    const root = await this.roomMixes.createQuote(trx, {
      organization_id: property.organization_id,
      property_id: property.id,
      room_mix_reference: roomMixReference(),
      arrival_date: input.arrivalDate,
      departure_date: input.departureDate,
      quantity: totalUnits,
      currency_code: childQuotes[0]!.currencyCode,
      gross_accommodation_minor: aggregate.grossAccommodationMinor,
      gross_extra_guest_minor: aggregate.grossExtraGuestMinor,
      accommodation_discount_minor: aggregate.accommodationDiscountMinor,
      extra_guest_discount_minor: aggregate.extraGuestDiscountMinor,
      discount_minor: aggregate.discountMinor,
      discounted_accommodation_minor: aggregate.discountedAccommodationMinor,
      discounted_extra_guest_minor: aggregate.discountedExtraGuestMinor,
      inclusive_fee_minor: aggregate.inclusiveFeeMinor,
      exclusive_fee_minor: aggregate.exclusiveFeeMinor,
      fee_minor: aggregate.feeMinor,
      inclusive_tax_minor: aggregate.inclusiveTaxMinor,
      exclusive_tax_minor: aggregate.exclusiveTaxMinor,
      tax_minor: aggregate.taxMinor,
      total_minor: aggregate.totalMinor,
      expires_at: expiresAt,
      source: request.source,
      request_id: request.requestId,
      correlation_id: request.correlationId
    });

    const items: PublicRoomMixQuoteItemView[] = [];
    for (const [index, quote] of childQuotes.entries()) {
      if (quote.roomCategoryId === null) {
        throw new ConflictError("Room-mix quote item lost its room-category identity");
      }

      await this.roomMixes.createQuoteItem(trx, {
        room_mix_quote_id: root.id,
        organization_id: property.organization_id,
        property_id: property.id,
        item_index: index + 1,
        quote_id: quote.id,
        quote_reference: quote.quoteReference,
        rate_product_id: quote.rateProductId,
        room_category_id: quote.roomCategoryId,
        quantity: quote.quantity,
        total_minor: quote.totalMinor
      });
      items.push(publicItem(quote, index + 1));
    }

    const view: PublicRoomMixQuoteView = {
      id: root.id,
      roomMixReference: root.room_mix_reference,
      arrivalDate: root.arrival_date,
      departureDate: root.departure_date,
      quantity: root.quantity,
      currencyCode: root.currency_code,
      grossAccommodationMinor: root.gross_accommodation_minor,
      grossExtraGuestMinor: root.gross_extra_guest_minor,
      discountMinor: root.discount_minor,
      feeMinor: root.fee_minor,
      taxMinor: root.tax_minor,
      totalMinor: root.total_minor,
      expiresAt: root.expires_at.toISOString(),
      holdEligible: true,
      checkoutSupported: true,
      items
    };

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      actorRole: "PUBLIC_BOOKING",
      organizationId: property.organization_id,
      propertyId: property.id,
      action: "room_mix.quote.created",
      entityType: "room_mix_quote",
      entityId: root.id,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "room_mix_quote",
      aggregateId: root.id,
      eventType: "room_mix.quote.created.v1",
      payload: {
        roomMixQuoteId: root.id,
        roomMixReference: root.room_mix_reference,
        propertyId: property.id,
        quantity: root.quantity,
        totalMinor: root.total_minor,
        currencyCode: root.currency_code,
        expiresAt: root.expires_at.toISOString()
      }
    });

    return { roomMixQuote: view };
  }

  async createHold(
    trx: Transaction<Database>,
    publicSlug: string,
    roomMixQuoteId: string,
    request: RequestMetadata
  ): Promise<PublicRoomMixHoldResult> {
    const property = await this.liveProperty(trx, publicSlug);
    const root = await this.roomMixes.findQuoteForUpdate(
      trx,
      property.organization_id,
      property.id,
      roomMixQuoteId
    );
    if (!root) throw new NotFoundError("Mixed-room quote not found");

    const existing = await this.roomMixes.findHold(
      trx,
      property.organization_id,
      property.id,
      roomMixQuoteId
    );
    if (existing) {
      const hold = await this.holds.getHoldSystem(
        trx,
        property.organization_id,
        property.id,
        existing.inventory_hold_id,
        request
      );
      if (hold.hold.status !== "ACTIVE") {
        throw new ConflictError("Mixed-room quote is already linked to a closed inventory hold");
      }
      return {
        created: false,
        roomMixQuoteId: root.id,
        roomMixReference: root.room_mix_reference,
        hold: {
          id: hold.hold.id,
          status: "ACTIVE",
          startDate: hold.hold.startDate,
          endDate: hold.hold.endDate,
          expiresAt: hold.hold.expiresAt,
          items: hold.hold.items.map((item) => {
            if (item.bucketType !== "ROOM_CATEGORY" || item.roomCategoryId === null) {
              throw new ConflictError("Mixed-room hold contains an invalid inventory item");
            }
            return {
              bucketType: "ROOM_CATEGORY",
              roomCategoryId: item.roomCategoryId,
              quantity: item.quantity
            };
          })
        }
      };
    }

    const now = this.now();
    const remainingMs = root.expires_at.getTime() - now.getTime();
    if (remainingMs < MIN_USEFUL_HOLD_MS) {
      throw new ConflictError("Mixed-room quote is expired or too close to expiry");
    }

    const items = await this.roomMixes.listQuoteItems(trx, root.id);
    if (items.length < 2) {
      throw new ConflictError("Mixed-room quote has incomplete item snapshots");
    }

    const holdResult = await this.holds.createHoldSystem(
      trx,
      {
        organizationId: property.organization_id,
        propertyId: property.id,
        startDate: root.arrival_date,
        endDate: root.departure_date,
        ttlSeconds: Math.min(1800, Math.floor(remainingMs / 1000)),
        clientReference: root.room_mix_reference,
        items: items.map((item) => ({
          bucketType: InventoryBucketTypes.ROOM_CATEGORY,
          roomCategoryId: item.room_category_id,
          quantity: item.quantity
        }))
      },
      request,
      root.expires_at
    );

    await this.roomMixes.createHold(trx, {
      roomMixQuoteId: root.id,
      inventoryHoldId: holdResult.hold.id,
      organizationId: property.organization_id,
      propertyId: property.id,
      request
    });

    const result: PublicRoomMixHoldResult = {
      created: true,
      roomMixQuoteId: root.id,
      roomMixReference: root.room_mix_reference,
      hold: {
        id: holdResult.hold.id,
        status: "ACTIVE",
        startDate: holdResult.hold.startDate,
        endDate: holdResult.hold.endDate,
        expiresAt: holdResult.hold.expiresAt,
        items: holdResult.hold.items.map((item) => {
          if (item.bucketType !== "ROOM_CATEGORY" || item.roomCategoryId === null) {
            throw new ConflictError("Mixed-room hold contains an invalid inventory item");
          }
          return {
            bucketType: "ROOM_CATEGORY",
            roomCategoryId: item.roomCategoryId,
            quantity: item.quantity
          };
        })
      }
    };

    await new AuditService(trx).record({
      actor: null,
      actorType: "SYSTEM",
      actorRole: "PUBLIC_BOOKING",
      organizationId: property.organization_id,
      propertyId: property.id,
      action: "room_mix.hold.created",
      entityType: "room_mix_inventory_hold",
      entityId: holdResult.hold.id,
      after: result,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "room_mix_quote",
      aggregateId: root.id,
      eventType: "room_mix.hold.created.v1",
      payload: {
        roomMixQuoteId: root.id,
        roomMixReference: root.room_mix_reference,
        propertyId: property.id,
        inventoryHoldId: holdResult.hold.id,
        expiresAt: holdResult.hold.expiresAt
      }
    });

    return result;
  }
}
