import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type {
  ConfigureRateProductInput,
  CreateRatePlanInput,
  MealPlanCode,
  RateCalendarDayView,
  RateCalendarView,
  RatePlanView,
  RateProductType,
  RateProductView,
  SetRateCalendarDayInput
} from "../domain/rates.js";
import {
  RateRepository,
  type RateCalendarDayRecord,
  type RatePlanRecord,
  type RateProductRecord
} from "../infrastructure/rate-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CALENDAR_DAYS = 366;
const MAX_MONEY_MINOR = 100_000_000;

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("Dates must use YYYY-MM-DD format");
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ValidationError("Invalid calendar date", { value });
  }
  return parsed;
}

function formatDate(value: Date): string {
  return [
    value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0")
  ].join("-");
}

function dateRange(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const count = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (count <= 0) {
    throw new ValidationError("endDate must be later than startDate");
  }
  if (count > MAX_CALENDAR_DAYS) {
    throw new ValidationError(`Rate calendar range cannot exceed ${MAX_CALENDAR_DAYS} days`);
  }
  return Array.from({ length: count }, (_, index) =>
    formatDate(new Date(start.getTime() + index * DAY_MS))
  );
}

function money(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_MONEY_MINOR) {
    throw new ValidationError(`${field} must be an integer between 0 and ${MAX_MONEY_MINOR}`);
  }
}

function ratePlanView(plan: RatePlanRecord): RatePlanView {
  return {
    id: plan.id,
    propertyId: plan.property_id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    mealPlanCode: plan.meal_plan_code as MealPlanCode,
    currencyCode: plan.currency_code,
    status: plan.status as "ACTIVE" | "INACTIVE",
    version: plan.version
  };
}

function rateProductView(product: RateProductRecord): RateProductView {
  return {
    id: product.id,
    ratePlanId: product.rate_plan_id,
    productType: product.product_type as RateProductType,
    roomCategoryId: product.room_category_id,
    baseRateMinor: product.base_rate_minor,
    floorRateMinor: product.floor_rate_minor,
    ceilingRateMinor: product.ceiling_rate_minor,
    includedAdults: product.included_adults,
    includedChildren: product.included_children,
    maxAdults: product.max_adults,
    maxChildren: product.max_children,
    maxOccupancy: product.max_occupancy,
    extraAdultMinor: product.extra_adult_minor,
    extraChildMinor: product.extra_child_minor,
    status: product.status as "ACTIVE" | "INACTIVE",
    version: product.version
  };
}

function validateProductNumbers(input: ConfigureRateProductInput): void {
  money(input.baseRateMinor, "baseRateMinor");
  money(input.floorRateMinor, "floorRateMinor");
  money(input.ceilingRateMinor, "ceilingRateMinor");
  money(input.extraAdultMinor, "extraAdultMinor");
  money(input.extraChildMinor, "extraChildMinor");

  if (input.floorRateMinor > input.baseRateMinor || input.baseRateMinor > input.ceilingRateMinor) {
    throw new ValidationError("Rate guardrails must satisfy floor <= base <= ceiling");
  }

  const integerFields = [
    ["includedAdults", input.includedAdults],
    ["includedChildren", input.includedChildren],
    ["maxAdults", input.maxAdults],
    ["maxChildren", input.maxChildren],
    ["maxOccupancy", input.maxOccupancy]
  ] as const;

  for (const [field, value] of integerFields) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new ValidationError(`${field} must be an integer between 0 and 100`);
    }
  }

  if (input.includedAdults < 1 || input.maxAdults < 1 || input.maxOccupancy < 1) {
    throw new ValidationError("Adult and occupancy limits must allow at least one adult");
  }
  if (input.includedAdults > input.maxAdults || input.includedChildren > input.maxChildren) {
    throw new ValidationError("Included occupancy cannot exceed maximum occupancy");
  }
  if (input.includedAdults + input.includedChildren > input.maxOccupancy) {
    throw new ValidationError("Included guests cannot exceed maxOccupancy");
  }
  if (input.maxOccupancy > input.maxAdults + input.maxChildren) {
    throw new ValidationError("maxOccupancy exceeds the configured adult/child capacity");
  }
}

function validateCalendarEntry(entry: SetRateCalendarDayInput, product: RateProductRecord): void {
  parseDate(entry.stayDate);
  money(entry.rateMinor, "rateMinor");
  if (entry.rateMinor < product.floor_rate_minor || entry.rateMinor > product.ceiling_rate_minor) {
    throw new ValidationError("Daily rate is outside the product floor/ceiling guardrails", {
      stayDate: entry.stayDate,
      floorRateMinor: product.floor_rate_minor,
      ceilingRateMinor: product.ceiling_rate_minor
    });
  }

  if (entry.extraAdultMinor !== null) {
    money(entry.extraAdultMinor, "extraAdultMinor");
  }
  if (entry.extraChildMinor !== null) {
    money(entry.extraChildMinor, "extraChildMinor");
  }

  if (!Number.isInteger(entry.minimumStay) || entry.minimumStay < 1 || entry.minimumStay > 365) {
    throw new ValidationError("minimumStay must be between 1 and 365");
  }
  if (
    entry.maximumStay !== null &&
    (!Number.isInteger(entry.maximumStay) ||
      entry.maximumStay < entry.minimumStay ||
      entry.maximumStay > 365)
  ) {
    throw new ValidationError("maximumStay must be null or between minimumStay and 365");
  }
  if (
    entry.expectedVersion !== null &&
    (!Number.isInteger(entry.expectedVersion) || entry.expectedVersion < 1)
  ) {
    throw new ValidationError("expectedVersion must be null or a positive integer");
  }
}

export class RateService {
  constructor(
    private readonly rates = new RateRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async property(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.RATES_READ | typeof Permissions.RATES_MANAGE
  ) {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });

    const property = await this.rates.findPropertyContext(trx, organizationId, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Rates cannot be managed for an archived property");
    }
    if (
      property.sale_mode !== "ROOMS_ONLY" &&
      property.sale_mode !== "FULL_PROPERTY_ONLY" &&
      property.sale_mode !== "BOTH"
    ) {
      throw new ConflictError("Property sale mode must be configured before rates");
    }
    return property;
  }

  async createRatePlan(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateRatePlanInput,
    request: RequestMetadata
  ): Promise<{ ratePlan: RatePlanView }> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.RATES_MANAGE
    );

    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,30}$/.test(code)) {
      throw new ValidationError("Rate plan code must use 2-30 letters, numbers, _ or -");
    }
    const name = input.name.trim();
    if (name.length < 2 || name.length > 120) {
      throw new ValidationError("Rate plan name must contain 2 to 120 characters");
    }
    const description = input.description?.trim() || null;
    if (description && description.length > 2000) {
      throw new ValidationError("Rate plan description cannot exceed 2000 characters");
    }

    const plan = await this.rates.createPlan(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      code,
      name,
      description,
      mealPlanCode: input.mealPlanCode,
      currencyCode: property.currency_code,
      createdByUserId: actor.userId
    });

    const view = ratePlanView(plan);
    await this.rates.recordEvent(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      ratePlanId: plan.id,
      rateProductId: null,
      stayDate: null,
      eventType: "RATE_PLAN_CREATED",
      details: view,
      actorUserId: actor.userId,
      request
    });
    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "rates.plan.created",
      entityType: "rate_plan",
      entityId: plan.id,
      after: view,
      request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: "rate_plan",
      aggregateId: plan.id,
      eventType: "rates.plan.created.v1",
      payload: view
    });

    return { ratePlan: view };
  }

  async listRatePlans(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<{ ratePlans: RatePlanView[] }> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.RATES_READ);
    const plans = await this.rates.listPlans(trx, organizationId, propertyId);
    return { ratePlans: plans.map(ratePlanView) };
  }

  async configureRateProduct(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: ConfigureRateProductInput,
    request: RequestMetadata
  ): Promise<{ rateProduct: RateProductView }> {
    const property = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.RATES_MANAGE
    );
    validateProductNumbers(input);

    const plan = await this.rates.findPlan(
      trx,
      input.organizationId,
      input.propertyId,
      input.ratePlanId
    );
    if (!plan) {
      throw new NotFoundError("Rate plan not found");
    }
    if (plan.status !== "ACTIVE") {
      throw new ConflictError("Inactive rate plans cannot be configured");
    }

    if (input.productType === "ROOM_CATEGORY") {
      if (property.sale_mode === "FULL_PROPERTY_ONLY") {
        throw new ValidationError("This property is not configured for room-category sales");
      }
      if (!input.roomCategoryId) {
        throw new ValidationError("roomCategoryId is required for room-category pricing");
      }

      const category = await this.rates.findRoomCategory(
        trx,
        input.organizationId,
        input.propertyId,
        input.roomCategoryId
      );
      if (!category || category.status !== "ACTIVE") {
        throw new NotFoundError("Active room category not found");
      }

      if (
        input.maxAdults > category.max_adults ||
        input.maxChildren > category.max_children ||
        input.maxOccupancy > category.max_occupancy
      ) {
        throw new ValidationError("Rate product occupancy cannot exceed room-category capacity");
      }
    } else {
      if (property.sale_mode === "ROOMS_ONLY") {
        throw new ValidationError("This property is not configured for full-property sales");
      }
      if (input.roomCategoryId !== null) {
        throw new ValidationError("roomCategoryId must be null for full-property pricing");
      }
    }

    const existing = await this.rates.findProductByKeyForUpdate(
      trx,
      input.ratePlanId,
      input.productType,
      input.roomCategoryId
    );

    let product: RateProductRecord;
    let eventType: "RATE_PRODUCT_CREATED" | "RATE_PRODUCT_UPDATED";
    let before: JsonObject | null = null;

    if (!existing) {
      if (input.expectedVersion !== null) {
        throw new ConflictError("Rate product does not exist at expectedVersion", {
          expectedVersion: input.expectedVersion
        });
      }

      product = await this.rates.createProduct(trx, {
        organization_id: input.organizationId,
        property_id: input.propertyId,
        rate_plan_id: input.ratePlanId,
        product_type: input.productType,
        room_category_id: input.roomCategoryId,
        base_rate_minor: input.baseRateMinor,
        floor_rate_minor: input.floorRateMinor,
        ceiling_rate_minor: input.ceilingRateMinor,
        included_adults: input.includedAdults,
        included_children: input.includedChildren,
        max_adults: input.maxAdults,
        max_children: input.maxChildren,
        max_occupancy: input.maxOccupancy,
        extra_adult_minor: input.extraAdultMinor,
        extra_child_minor: input.extraChildMinor,
        created_by_user_id: actor.userId,
        updated_by_user_id: actor.userId
      });
      eventType = "RATE_PRODUCT_CREATED";
    } else {
      if (input.expectedVersion === null || input.expectedVersion !== existing.version) {
        throw new ConflictError("Rate product has changed; refresh before updating", {
          currentVersion: existing.version
        });
      }
      before = rateProductView(existing);
      const updated = await this.rates.updateProduct(trx, existing.id, existing.version, {
        baseRateMinor: input.baseRateMinor,
        floorRateMinor: input.floorRateMinor,
        ceilingRateMinor: input.ceilingRateMinor,
        includedAdults: input.includedAdults,
        includedChildren: input.includedChildren,
        maxAdults: input.maxAdults,
        maxChildren: input.maxChildren,
        maxOccupancy: input.maxOccupancy,
        extraAdultMinor: input.extraAdultMinor,
        extraChildMinor: input.extraChildMinor,
        updatedByUserId: actor.userId
      });
      if (!updated) {
        throw new ConflictError("Rate product update lost an optimistic concurrency race");
      }
      product = updated;
      eventType = "RATE_PRODUCT_UPDATED";
    }

    const view = rateProductView(product);
    await this.rates.recordEvent(trx, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      ratePlanId: input.ratePlanId,
      rateProductId: product.id,
      stayDate: null,
      eventType,
      details: { before, after: view },
      actorUserId: actor.userId,
      request
    });
    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action:
        eventType === "RATE_PRODUCT_CREATED" ? "rates.product.created" : "rates.product.updated",
      entityType: "rate_product",
      entityId: product.id,
      before,
      after: view,
      request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: "rate_product",
      aggregateId: product.id,
      eventType:
        eventType === "RATE_PRODUCT_CREATED"
          ? "rates.product.created.v1"
          : "rates.product.updated.v1",
      payload: view
    });

    return { rateProduct: view };
  }

  async setCalendarDays(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    entries: SetRateCalendarDayInput[],
    request: RequestMetadata
  ): Promise<{ updated: RateCalendarDayView[] }> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.RATES_MANAGE);

    if (entries.length < 1 || entries.length > MAX_CALENDAR_DAYS) {
      throw new ValidationError(`Calendar update must contain 1-${MAX_CALENDAR_DAYS} days`);
    }
    const uniqueDates = new Set(entries.map((entry) => entry.stayDate));
    if (uniqueDates.size !== entries.length) {
      throw new ValidationError("Calendar update contains duplicate stayDate entries");
    }

    const product = await this.rates.findProduct(trx, organizationId, propertyId, rateProductId);
    if (!product) {
      throw new NotFoundError("Rate product not found");
    }

    for (const entry of entries) {
      validateCalendarEntry(entry, product);
    }

    const updated: RateCalendarDayView[] = [];

    for (const entry of [...entries].sort((a, b) => a.stayDate.localeCompare(b.stayDate))) {
      const existing = await this.rates.findCalendarDayForUpdate(
        trx,
        rateProductId,
        entry.stayDate
      );

      let row: RateCalendarDayRecord;
      let eventType: "RATE_CALENDAR_DAY_CREATED" | "RATE_CALENDAR_DAY_UPDATED";
      let before: JsonObject | null = null;

      if (!existing) {
        if (entry.expectedVersion !== null) {
          throw new ConflictError("Rate calendar day does not exist at expectedVersion", {
            stayDate: entry.stayDate,
            expectedVersion: entry.expectedVersion
          });
        }
        row = await this.rates.createCalendarDay(trx, {
          organizationId,
          propertyId,
          rateProductId,
          stayDate: entry.stayDate,
          rateMinor: entry.rateMinor,
          extraAdultMinor: entry.extraAdultMinor,
          extraChildMinor: entry.extraChildMinor,
          minimumStay: entry.minimumStay,
          maximumStay: entry.maximumStay,
          closedToArrival: entry.closedToArrival,
          closedToDeparture: entry.closedToDeparture,
          stopSell: entry.stopSell,
          source: entry.source,
          updatedByUserId: actor.userId
        });
        eventType = "RATE_CALENDAR_DAY_CREATED";
      } else {
        if (entry.expectedVersion === null || entry.expectedVersion !== existing.version) {
          throw new ConflictError("Rate calendar day has changed; refresh before updating", {
            stayDate: entry.stayDate,
            currentVersion: existing.version
          });
        }
        before = existing as unknown as JsonObject;
        const changed = await this.rates.updateCalendarDay(trx, existing.id, existing.version, {
          rateMinor: entry.rateMinor,
          extraAdultMinor: entry.extraAdultMinor,
          extraChildMinor: entry.extraChildMinor,
          minimumStay: entry.minimumStay,
          maximumStay: entry.maximumStay,
          closedToArrival: entry.closedToArrival,
          closedToDeparture: entry.closedToDeparture,
          stopSell: entry.stopSell,
          source: entry.source,
          updatedByUserId: actor.userId
        });
        if (!changed) {
          throw new ConflictError("Rate calendar update lost an optimistic concurrency race");
        }
        row = changed;
        eventType = "RATE_CALENDAR_DAY_UPDATED";
      }

      const view: RateCalendarDayView = {
        stayDate: row.stay_date,
        rateMinor: row.rate_minor,
        extraAdultMinor: row.extra_adult_minor ?? product.extra_adult_minor,
        extraChildMinor: row.extra_child_minor ?? product.extra_child_minor,
        minimumStay: row.minimum_stay,
        maximumStay: row.maximum_stay,
        closedToArrival: row.closed_to_arrival,
        closedToDeparture: row.closed_to_departure,
        stopSell: row.stop_sell,
        source: row.source as "MANUAL" | "REVENUE" | "SYSTEM",
        overrideVersion: row.version
      };
      updated.push(view);

      await this.rates.recordEvent(trx, {
        organizationId,
        propertyId,
        ratePlanId: product.rate_plan_id,
        rateProductId,
        stayDate: row.stay_date,
        eventType,
        details: { before, after: view },
        actorUserId: actor.userId,
        request
      });
    }

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "rates.calendar.updated",
      entityType: "rate_product",
      entityId: rateProductId,
      metadata: { updatedDates: updated.map((day) => day.stayDate) },
      request
    });
    await new OutboxService(trx).enqueue({
      aggregateType: "rate_product",
      aggregateId: rateProductId,
      eventType: "rates.calendar.updated.v1",
      payload: {
        rateProductId,
        dates: updated.map((day) => day.stayDate)
      }
    });

    return { updated };
  }

  async getCalendar(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.RATES_READ);
    const dates = dateRange(startDate, endDate);

    const product = await this.rates.findProduct(trx, organizationId, propertyId, rateProductId);
    if (!product) {
      throw new NotFoundError("Rate product not found");
    }
    const plan = await this.rates.findPlan(trx, organizationId, propertyId, product.rate_plan_id);
    if (!plan) {
      throw new ConflictError("Rate product is missing its rate plan");
    }

    const overrides = await this.rates.listCalendarDays(trx, rateProductId, startDate, endDate);
    const byDate = new Map(overrides.map((row) => [row.stay_date, row]));

    const days: RateCalendarDayView[] = dates.map((stayDate) => {
      const row = byDate.get(stayDate);
      if (!row) {
        return {
          stayDate,
          rateMinor: product.base_rate_minor,
          extraAdultMinor: product.extra_adult_minor,
          extraChildMinor: product.extra_child_minor,
          minimumStay: 1,
          maximumStay: null,
          closedToArrival: false,
          closedToDeparture: false,
          stopSell: false,
          source: "BASE",
          overrideVersion: null
        };
      }
      return {
        stayDate,
        rateMinor: row.rate_minor,
        extraAdultMinor: row.extra_adult_minor ?? product.extra_adult_minor,
        extraChildMinor: row.extra_child_minor ?? product.extra_child_minor,
        minimumStay: row.minimum_stay,
        maximumStay: row.maximum_stay,
        closedToArrival: row.closed_to_arrival,
        closedToDeparture: row.closed_to_departure,
        stopSell: row.stop_sell,
        source: row.source as "MANUAL" | "REVENUE" | "SYSTEM",
        overrideVersion: row.version
      };
    });

    return {
      ratePlan: ratePlanView(plan),
      rateProduct: rateProductView(product),
      currencyCode: plan.currency_code,
      startDate,
      endDate,
      days
    };
  }
}
