import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { CommercialQuoteResolver } from "../../commercial/application/commercial-quote-resolver.js";
import { InventoryHoldService } from "../../inventory/application/inventory-hold-service.js";
import { InventoryService } from "../../inventory/application/inventory-service.js";
import { RateService } from "../../rates/application/rate-service.js";
import type { CreateQuoteInput, QuoteCalculation, QuoteView } from "../domain/quote.js";
import { QuoteRepository } from "../infrastructure/quote-repository.js";
import { calculateCommercialQuote } from "./commercial-quote-calculator.js";
import { addDays, calculateQuote, stayNightCount } from "./quote-calculator.js";

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 1800;

function quoteReference(): string {
  return `Q-${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`;
}

export class QuoteService {
  constructor(
    private readonly repository = new QuoteRepository(),
    private readonly authorization = new AuthorizationService(),
    private readonly rates = new RateService(),
    private readonly inventory = new InventoryService(),
    private readonly holds = new InventoryHoldService(),
    private readonly commercial = new CommercialQuoteResolver()
  ) {}

  async createQuote(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateQuoteInput,
    request: RequestMetadata
  ): Promise<{ quote: QuoteView }> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    stayNightCount(input.arrivalDate, input.departureDate);

    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < MIN_TTL_SECONDS ||
      input.ttlSeconds > MAX_TTL_SECONDS
    ) {
      throw new ValidationError(
        `Quote ttlSeconds must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}`
      );
    }

    await this.holds.expireDueForProperty(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      request
    );

    const calendar = await this.rates.getCalendar(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      input.rateProductId,
      input.arrivalDate,
      addDays(input.departureDate, 1)
    );

    const availability = await this.inventory.getAvailability(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      input.arrivalDate,
      input.departureDate
    );

    const stayDates = calendar.days
      .filter((day) => day.stayDate >= input.arrivalDate && day.stayDate < input.departureDate)
      .map((day) => day.stayDate);

    const commercialContext = await this.commercial.resolve(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      ratePlanId: calendar.ratePlan.id,
      rateProductId: calendar.rateProduct.id,
      stayDates
    });

    const baseCalculation = calculateQuote(
      input,
      calendar,
      availability,
      commercialContext?.guestAgePolicy ?? null
    );

    const calculation: QuoteCalculation = commercialContext
      ? {
          ...baseCalculation,
          commercial: calculateCommercialQuote(baseCalculation, commercialContext)
        }
      : baseCalculation;

    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

    const quote = await this.repository.create(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      quoteReference: quoteReference(),
      arrivalDate: input.arrivalDate,
      departureDate: input.departureDate,
      expiresAt,
      createdByUserId: actor.userId,
      request,
      calculation
    });

    await this.repository.recordEvent(trx, {
      quoteId: quote.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      eventType: "QUOTE_CREATED",
      details: {
        quoteReference: quote.quoteReference,
        commercialStatus: quote.commercialStatus,
        promotionStatus: quote.promotionStatus,
        holdEligible: quote.holdEligible,
        totalMinor: quote.totalMinor,
        taxMinor: quote.taxMinor,
        feeMinor: quote.feeMinor,
        currencyCode: quote.currencyCode,
        expiresAt: quote.expiresAt
      },
      actorUserId: actor.userId,
      request
    });

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "quote.created",
      entityType: "quote",
      entityId: quote.id,
      after: quote,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "quote",
      aggregateId: quote.id,
      eventType: "quote.created.v1",
      payload: {
        quoteId: quote.id,
        propertyId: input.propertyId,
        quoteReference: quote.quoteReference,
        commercialStatus: quote.commercialStatus,
        promotionStatus: quote.promotionStatus,
        holdEligible: quote.holdEligible,
        expiresAt: quote.expiresAt
      }
    });

    return { quote };
  }

  async getQuote(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    quoteId: string
  ): Promise<{ quote: QuoteView }> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId,
      propertyId
    });

    const quote = await this.repository.find(trx, organizationId, propertyId, quoteId);
    if (!quote) {
      throw new NotFoundError("Quote not found");
    }
    return { quote };
  }
}
