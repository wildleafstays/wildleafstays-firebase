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
import { InventoryBucketTypes } from "../../inventory/domain/inventory.js";
import type { QuoteHoldResult, QuoteHoldView } from "../domain/quote-hold.js";
import {
  QuoteHoldRepository,
  type QuoteInventoryHoldRecord
} from "../infrastructure/quote-hold-repository.js";
import { QuoteRepository } from "../infrastructure/quote-repository.js";

const MIN_USEFUL_HOLD_MS = 60_000;
const MAX_HOLD_TTL_SECONDS = 30 * 60;

function quoteHoldView(
  link: QuoteInventoryHoldRecord,
  quoteReference: string,
  hold: QuoteHoldView["hold"]
): QuoteHoldView {
  return {
    id: link.id,
    quoteId: link.quote_id,
    quoteReference,
    inventoryHoldId: link.inventory_hold_id,
    linkedAt: link.created_at.toISOString(),
    hold
  };
}

export class QuoteHoldService {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly links = new QuoteHoldRepository(),
    private readonly quotes = new QuoteRepository(),
    private readonly holds = new InventoryHoldService(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async createFromQuoteCore(
    trx: Transaction<Database>,
    actor: ActorContext | null,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
    },
    request: RequestMetadata,
    requiredSource: string | null
  ): Promise<QuoteHoldResult> {
    const lockedQuote = await this.links.lockQuote(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (!lockedQuote) {
      throw new NotFoundError("Quote not found");
    }

    if (requiredSource !== null && lockedQuote.source !== requiredSource) {
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

    const existingLink = await this.links.findByQuote(
      trx,
      input.organizationId,
      input.propertyId,
      input.quoteId
    );
    if (existingLink) {
      const existingHold = actor
        ? await this.holds.getHold(
            trx,
            actor,
            input.organizationId,
            input.propertyId,
            existingLink.inventory_hold_id,
            request,
            Permissions.RESERVATION_MANAGE
          )
        : await this.holds.getHoldSystem(
            trx,
            input.organizationId,
            input.propertyId,
            existingLink.inventory_hold_id,
            request
          );

      if (existingHold.hold.status !== "ACTIVE") {
        throw new ConflictError(
          "This quote is already linked to a closed inventory hold; create a fresh quote",
          {
            quoteId: quote.id,
            inventoryHoldId: existingHold.hold.id,
            holdStatus: existingHold.hold.status
          }
        );
      }

      return {
        created: false,
        quoteHold: quoteHoldView(existingLink, quote.quoteReference, existingHold.hold)
      };
    }

    if (quote.promotionStatus !== "EVALUATED" || !quote.holdEligible) {
      throw new ConflictError(
        "Quote is not commercially complete and cannot be converted to an inventory hold",
        {
          quoteId: quote.id,
          commercialStatus: quote.commercialStatus,
          promotionStatus: quote.promotionStatus,
          holdEligible: quote.holdEligible
        }
      );
    }

    const now = this.now();
    const quoteExpiry = new Date(quote.expiresAt);
    const remainingMs = quoteExpiry.getTime() - now.getTime();
    if (!Number.isFinite(quoteExpiry.getTime()) || remainingMs <= 0) {
      throw new ConflictError("Quote has expired; create a fresh quote", {
        quoteId: quote.id,
        expiresAt: quote.expiresAt
      });
    }
    if (remainingMs < MIN_USEFUL_HOLD_MS) {
      throw new ConflictError("Quote is too close to expiry to start a safe inventory hold", {
        quoteId: quote.id,
        expiresAt: quote.expiresAt,
        remainingMilliseconds: remainingMs
      });
    }

    const items =
      quote.productType === "FULL_PROPERTY"
        ? [
            {
              bucketType: InventoryBucketTypes.FULL_PROPERTY,
              roomCategoryId: null,
              quantity: 1
            }
          ]
        : quote.roomCategoryId
          ? [
              {
                bucketType: InventoryBucketTypes.ROOM_CATEGORY,
                roomCategoryId: quote.roomCategoryId,
                quantity: quote.quantity
              }
            ]
          : null;

    if (!items) {
      throw new ConflictError(
        "Room-category quote is missing its immutable room category snapshot",
        {
          quoteId: quote.id
        }
      );
    }

    const ttlSeconds = Math.min(MAX_HOLD_TTL_SECONDS, Math.ceil(remainingMs / 1000));
    const holdResult = actor
      ? await this.holds.createHold(
          trx,
          actor,
          {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            startDate: quote.arrivalDate,
            endDate: quote.departureDate,
            ttlSeconds,
            clientReference: quote.quoteReference,
            items
          },
          request,
          Permissions.RESERVATION_MANAGE,
          quoteExpiry
        )
      : await this.holds.createHoldSystem(
          trx,
          {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            startDate: quote.arrivalDate,
            endDate: quote.departureDate,
            ttlSeconds,
            clientReference: quote.quoteReference,
            items
          },
          request,
          quoteExpiry
        );

    const link = await this.links.createLink(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      quoteId: quote.id,
      inventoryHoldId: holdResult.hold.id,
      linkedByUserId: actor?.userId ?? null,
      request
    });

    const view = quoteHoldView(link, quote.quoteReference, holdResult.hold);

    await new AuditService(trx).record({
      actor,
      actorType: actor ? "USER" : "SYSTEM",
      actorRole: actor ? null : "PUBLIC_BOOKING",
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "quote.hold.created",
      entityType: "quote_inventory_hold",
      entityId: link.id,
      after: {
        quoteId: quote.id,
        quoteReference: quote.quoteReference,
        inventoryHoldId: holdResult.hold.id,
        holdExpiresAt: holdResult.hold.expiresAt,
        quoteExpiresAt: quote.expiresAt,
        totalMinor: quote.totalMinor,
        currencyCode: quote.currencyCode
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "quote",
      aggregateId: quote.id,
      eventType: "quote.hold.created.v1",
      payload: {
        quoteId: quote.id,
        quoteReference: quote.quoteReference,
        propertyId: quote.propertyId,
        inventoryHoldId: holdResult.hold.id,
        holdExpiresAt: holdResult.hold.expiresAt,
        quoteExpiresAt: quote.expiresAt,
        totalMinor: quote.totalMinor,
        currencyCode: quote.currencyCode
      }
    });

    return { created: true, quoteHold: view };
  }

  async createFromQuote(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
    },
    request: RequestMetadata
  ): Promise<QuoteHoldResult> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    return this.createFromQuoteCore(trx, actor, input, request, null);
  }

  async createFromQuoteSystem(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
    },
    request: RequestMetadata
  ): Promise<QuoteHoldResult> {
    if (request.source !== "public-api") {
      throw new ValidationError("System quote hold creation requires public-api request source");
    }

    return this.createFromQuoteCore(trx, null, input, request, "public-api");
  }
}
