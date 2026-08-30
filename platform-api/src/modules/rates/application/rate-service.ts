import {
  deriveFullPropertySource,
  type FullPropertyCategoryRateSource
} from "./derived-full-property-source.js";
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
  if (input.floorRateMinor !== null) {
    money(input.floorRateMinor, "floorRateMinor");
  }

  if (input.ceilingRateMinor !== null) {
    money(input.ceilingRateMinor, "ceilingRateMinor");
  }
  money(input.extraAdultMinor, "extraAdultMinor");
  money(input.extraChildMinor, "extraChildMinor");

  if (
    (input.floorRateMinor !== null && input.floorRateMinor > input.baseRateMinor) ||
    (input.ceilingRateMinor !== null && input.baseRateMinor > input.ceilingRateMinor)
  ) {
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
  if (
    (product.floor_rate_minor !== null && entry.rateMinor < product.floor_rate_minor) ||
    (product.ceiling_rate_minor !== null && entry.rateMinor > product.ceiling_rate_minor)
  ) {
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

  private async propertyContext(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string
  ) {
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

    return this.propertyContext(trx, organizationId, propertyId);
  }

  private async ensureOwnerFullPropertyShell(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      saleMode: string | null;
      preferredRatePlanId: string;
    },
    request: RequestMetadata
  ): Promise<void> {
    if (input.saleMode !== "BOTH" && input.saleMode !== "FULL_PROPERTY_ONLY") {
      return;
    }

    const [categories, plans, products] = await Promise.all([
      this.rates.listActiveRoomCategoryPricingSources(trx, input.organizationId, input.propertyId),
      this.rates.listPlans(trx, input.organizationId, input.propertyId),
      this.rates.listProducts(trx, input.organizationId, input.propertyId)
    ]);

    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const activeFullPropertyProducts = products.filter((product) => {
      const plan = planById.get(product.rate_plan_id);

      return (
        product.product_type === "FULL_PROPERTY" &&
        product.status === "ACTIVE" &&
        plan?.status === "ACTIVE" &&
        plan.meal_plan_code === "EP"
      );
    });

    if (activeFullPropertyProducts.length > 1) {
      throw new ConflictError(
        "More than one active full-property rate identity exists; review the rate setup before continuing"
      );
    }

    if (activeFullPropertyProducts.length === 1) {
      return;
    }

    const activeCategories = categories.filter((category) => category.physical_capacity > 0);
    if (activeCategories.length === 0) {
      return;
    }

    let derivedBaseRateMinor = 0;
    for (const category of activeCategories) {
      const candidates = products.filter((product) => {
        const plan = planById.get(product.rate_plan_id);

        return (
          product.product_type === "ROOM_CATEGORY" &&
          product.room_category_id === category.room_category_id &&
          product.status === "ACTIVE" &&
          plan?.status === "ACTIVE" &&
          plan.meal_plan_code === "EP"
        );
      });

      // The shell becomes public only after every physical-room category has
      // one unambiguous EP source. Until then the owner can keep completing setup.
      if (candidates.length !== 1) {
        return;
      }

      derivedBaseRateMinor += candidates[0]!.base_rate_minor * category.physical_capacity;
    }

    const preferredPlan = planById.get(input.preferredRatePlanId);
    if (
      !preferredPlan ||
      preferredPlan.status !== "ACTIVE" ||
      preferredPlan.meal_plan_code !== "EP"
    ) {
      throw new ConflictError("The full-property identity requires an active EP rate plan");
    }

    // FULL_PROPERTY is an identity only. Public availability, occupancy,
    // pricing and extra-guest charges are always derived from room categories.
    await this.configureRateProduct(
      trx,
      actor,
      {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        ratePlanId: input.preferredRatePlanId,
        productType: "FULL_PROPERTY",
        roomCategoryId: null,
        baseRateMinor: Math.min(MAX_MONEY_MINOR, derivedBaseRateMinor),
        floorRateMinor: null,
        ceilingRateMinor: null,
        includedAdults: 1,
        includedChildren: 0,
        maxAdults: 1,
        maxChildren: 0,
        maxOccupancy: 1,
        extraAdultMinor: 0,
        extraChildMinor: 0,
        expectedVersion: null
      },
      request
    );
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

  async listRateProducts(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<{ rateProducts: RateProductView[] }> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.RATES_READ);
    const products = await this.rates.listProducts(trx, organizationId, propertyId);
    return { rateProducts: products.map(rateProductView) };
  }

  async configureOwnerRoomCategoryBaseRate(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      roomCategoryId: string;
      baseRateMinor: number;
      expectedVersion: number | null;
    },
    request: RequestMetadata
  ): Promise<{ rateProduct: RateProductView }> {
    const ownerProperty = await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.RATES_MANAGE
    );

    money(input.baseRateMinor, "baseRateMinor");

    await this.rates.lockOwnerRateSetup(trx, input.propertyId);

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
      category.base_adults === null ||
      category.base_children === null ||
      category.default_extra_adult_minor === null ||
      category.default_extra_child_minor === null
    ) {
      throw new ConflictError(
        "Complete the room category guest and extra-charge defaults before setting its base rate"
      );
    }

    const plans = await this.rates.listPlans(trx, input.organizationId, input.propertyId);

    const products = await this.rates.listProducts(trx, input.organizationId, input.propertyId);

    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const activeEpProducts = products.filter((product) => {
      const plan = planById.get(product.rate_plan_id);

      return (
        product.product_type === "ROOM_CATEGORY" &&
        product.room_category_id === input.roomCategoryId &&
        product.status === "ACTIVE" &&
        plan?.status === "ACTIVE" &&
        plan.meal_plan_code === "EP"
      );
    });

    if (activeEpProducts.length > 1) {
      throw new ConflictError(
        "More than one active EP rate product exists for this room category; review the existing rate setup before continuing"
      );
    }

    let ratePlanId: string;
    let existingProduct = activeEpProducts[0];

    if (existingProduct) {
      const plan = planById.get(existingProduct.rate_plan_id);

      if (!plan || plan.status !== "ACTIVE" || plan.meal_plan_code !== "EP") {
        throw new ConflictError(
          "The existing room-category rate product is not attached to an active EP plan"
        );
      }

      ratePlanId = plan.id;
    } else {
      const ownerPlans = plans.filter((plan) => plan.code === "OWNER_EP");

      if (ownerPlans.length > 1) {
        throw new ConflictError(
          "Multiple OWNER_EP rate plans exist; review the rate setup before continuing"
        );
      }

      const ownerPlan = ownerPlans[0];

      if (ownerPlan) {
        if (ownerPlan.status !== "ACTIVE" || ownerPlan.meal_plan_code !== "EP") {
          throw new ConflictError("The existing OWNER_EP plan is not an active room-only plan");
        }

        ratePlanId = ownerPlan.id;
      } else {
        const activeEpPlans = plans.filter(
          (plan) => plan.status === "ACTIVE" && plan.meal_plan_code === "EP"
        );

        if (activeEpPlans.length === 1) {
          const activeEpPlan = activeEpPlans[0];

          if (!activeEpPlan) {
            throw new ConflictError(
              "The active EP rate plan disappeared while configuring the category"
            );
          }

          ratePlanId = activeEpPlan.id;
        } else {
          const created = await this.createRatePlan(
            trx,
            actor,
            {
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              code: "OWNER_EP",
              name: "Room Only",
              description: "System-managed room-only plan for the simple owner rates calendar",
              mealPlanCode: "EP"
            },
            request
          );

          ratePlanId = created.ratePlan.id;
        }
      }

      const keyedProduct = products.find(
        (product) =>
          product.rate_plan_id === ratePlanId &&
          product.product_type === "ROOM_CATEGORY" &&
          product.room_category_id === input.roomCategoryId
      );

      if (keyedProduct) {
        if (keyedProduct.status !== "ACTIVE") {
          throw new ConflictError(
            "An inactive EP rate product already exists for this room category; review it before continuing"
          );
        }

        existingProduct = keyedProduct;
      }
    }

    if (existingProduct && input.expectedVersion !== existingProduct.version) {
      throw new ConflictError("Rate product has changed; refresh before updating", {
        currentVersion: existingProduct.version
      });
    }

    if (!existingProduct && input.expectedVersion !== null) {
      throw new ConflictError(
        "The rate product no longer matches the version shown on screen; refresh before continuing"
      );
    }

    const configured = await this.configureRateProduct(
      trx,
      actor,
      {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        ratePlanId,
        productType: "ROOM_CATEGORY",
        roomCategoryId: input.roomCategoryId,
        baseRateMinor: input.baseRateMinor,
        floorRateMinor: null,
        ceilingRateMinor: null,
        includedAdults: category.base_adults,
        includedChildren: category.base_children,
        maxAdults: category.max_adults,
        maxChildren: category.max_children,
        maxOccupancy: category.max_occupancy,
        extraAdultMinor: category.default_extra_adult_minor,
        extraChildMinor: category.default_extra_child_minor,
        expectedVersion: existingProduct?.version ?? null
      },
      request
    );

    await this.ensureOwnerFullPropertyShell(
      trx,
      actor,
      {
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        saleMode: ownerProperty.sale_mode,
        preferredRatePlanId: ratePlanId
      },
      request
    );

    return configured;
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

  private async getUniversalFullPropertyCalendarCore(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    const dates = dateRange(startDate, endDate);

    const shellProduct = await this.rates.findProduct(
      trx,
      organizationId,
      propertyId,
      rateProductId
    );

    if (!shellProduct) {
      throw new NotFoundError("Rate product not found");
    }

    if (shellProduct.product_type !== "FULL_PROPERTY" || shellProduct.status !== "ACTIVE") {
      throw new ConflictError(
        "Universal full-property pricing requires an active full-property rate identity"
      );
    }

    const shellPlan = await this.rates.findPlan(
      trx,
      organizationId,
      propertyId,
      shellProduct.rate_plan_id
    );

    if (!shellPlan || shellPlan.status !== "ACTIVE" || shellPlan.meal_plan_code !== "EP") {
      throw new ConflictError(
        "Universal full-property pricing currently requires an active room-only rate plan"
      );
    }

    const [categories, plans, products] = await Promise.all([
      this.rates.listActiveRoomCategoryPricingSources(trx, organizationId, propertyId),
      this.rates.listPlans(trx, organizationId, propertyId),
      this.rates.listProducts(trx, organizationId, propertyId)
    ]);

    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const categorySources: FullPropertyCategoryRateSource[] = [];

    for (const category of categories) {
      if (category.physical_capacity <= 0) {
        continue;
      }

      if (
        category.base_adults === null ||
        category.base_children === null ||
        category.default_extra_adult_minor === null ||
        category.default_extra_child_minor === null
      ) {
        throw new ConflictError(
          "Every active physical-room category must have guest and extra-charge defaults before full-property pricing can be derived",
          {
            roomCategoryId: category.room_category_id
          }
        );
      }

      const candidates = products.filter((product) => {
        const plan = planById.get(product.rate_plan_id);

        return (
          product.product_type === "ROOM_CATEGORY" &&
          product.room_category_id === category.room_category_id &&
          product.status === "ACTIVE" &&
          plan?.status === "ACTIVE" &&
          plan.meal_plan_code === "EP"
        );
      });

      if (candidates.length !== 1) {
        throw new ConflictError(
          candidates.length === 0
            ? "An active physical-room category is missing its single active EP rate product"
            : "An active physical-room category has more than one active EP rate product",
          {
            roomCategoryId: category.room_category_id,
            candidateCount: candidates.length
          }
        );
      }

      const product = candidates[0]!;

      const overrides = await this.rates.listCalendarDays(trx, product.id, startDate, endDate);

      const overrideByDate = new Map(overrides.map((row) => [row.stay_date, row]));

      const defaultExtraAdultMinor = category.default_extra_adult_minor;
      const defaultExtraChildMinor = category.default_extra_child_minor;

      categorySources.push({
        roomCategoryId: category.room_category_id,
        physicalCapacity: category.physical_capacity,
        includedAdults: category.base_adults,
        includedChildren: category.base_children,
        maxAdults: category.max_adults,
        maxChildren: category.max_children,
        maxOccupancy: category.max_occupancy,
        days: dates.map((stayDate) => {
          const row = overrideByDate.get(stayDate);

          if (!row) {
            return {
              stayDate,
              rateMinor: product.base_rate_minor,
              extraAdultMinor: defaultExtraAdultMinor,
              extraChildMinor: defaultExtraChildMinor,
              minimumStay: 1,
              maximumStay: null,
              closedToArrival: false,
              closedToDeparture: false,
              stopSell: false
            };
          }

          return {
            stayDate,
            rateMinor: row.rate_minor,
            extraAdultMinor: row.extra_adult_minor ?? defaultExtraAdultMinor,
            extraChildMinor: row.extra_child_minor ?? defaultExtraChildMinor,
            minimumStay: row.minimum_stay,
            maximumStay: row.maximum_stay,
            closedToArrival: row.closed_to_arrival,
            closedToDeparture: row.closed_to_departure,
            stopSell: row.stop_sell
          };
        })
      });
    }

    const derived = deriveFullPropertySource(dates, categorySources);

    const firstDerivedDay = derived.days[0];

    if (!firstDerivedDay) {
      throw new ConflictError("Universal full-property calendar contains no derived date");
    }

    const shellView = rateProductView(shellProduct);

    return {
      ratePlan: ratePlanView(shellPlan),
      rateProduct: {
        ...shellView,
        baseRateMinor: firstDerivedDay.rateMinor,
        floorRateMinor: null,
        ceilingRateMinor: null,
        includedAdults: derived.includedAdults,
        includedChildren: derived.includedChildren,
        maxAdults: derived.maxAdults,
        maxChildren: derived.maxChildren,
        maxOccupancy: derived.maxOccupancy,
        extraAdultMinor: 0,
        extraChildMinor: 0
      },
      currencyCode: shellPlan.currency_code,
      startDate,
      endDate,
      days: derived.days.map((day) => ({
        stayDate: day.stayDate,
        rateMinor: day.rateMinor,
        extraAdultMinor: 0,
        extraChildMinor: 0,
        minimumStay: day.minimumStay,
        maximumStay: day.maximumStay,
        closedToArrival: day.closedToArrival,
        closedToDeparture: day.closedToDeparture,
        stopSell: day.stopSell,
        source: "SYSTEM",
        overrideVersion: null,
        fullPropertyCategoryRates: day.categoryRates.map((categoryRate) => ({
          ...categoryRate
        }))
      }))
    };
  }

  private async getCalendarCore(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    const dates = dateRange(startDate, endDate);

    const product = await this.rates.findProduct(trx, organizationId, propertyId, rateProductId);
    if (!product) {
      throw new NotFoundError("Rate product not found");
    }
    const plan = await this.rates.findPlan(trx, organizationId, propertyId, product.rate_plan_id);
    if (!plan) {
      throw new ConflictError("Rate product is missing its rate plan");
    }

    const category = product.room_category_id
      ? await this.rates.findRoomCategory(trx, organizationId, propertyId, product.room_category_id)
      : null;
    const canonicalProduct: RateProductRecord = category
      ? {
          ...product,
          included_adults: category.base_adults ?? product.included_adults,
          included_children: category.base_children ?? product.included_children,
          max_adults: category.max_adults,
          max_children: category.max_children,
          max_occupancy: category.max_occupancy,
          extra_adult_minor: category.default_extra_adult_minor ?? product.extra_adult_minor,
          extra_child_minor: category.default_extra_child_minor ?? product.extra_child_minor
        }
      : product;

    const overrides = await this.rates.listCalendarDays(trx, rateProductId, startDate, endDate);
    const byDate = new Map(overrides.map((row) => [row.stay_date, row]));

    const days: RateCalendarDayView[] = dates.map((stayDate) => {
      const row = byDate.get(stayDate);
      if (!row) {
        return {
          stayDate,
          rateMinor: canonicalProduct.base_rate_minor,
          extraAdultMinor: canonicalProduct.extra_adult_minor,
          extraChildMinor: canonicalProduct.extra_child_minor,
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
        extraAdultMinor: row.extra_adult_minor ?? canonicalProduct.extra_adult_minor,
        extraChildMinor: row.extra_child_minor ?? canonicalProduct.extra_child_minor,
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
      rateProduct: rateProductView(canonicalProduct),
      currencyCode: plan.currency_code,
      startDate,
      endDate,
      days
    };
  }

  async getQuoteCalendar(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    await this.property(trx, actor, organizationId, propertyId, Permissions.RATES_READ);

    const product = await this.rates.findProduct(trx, organizationId, propertyId, rateProductId);

    if (!product) {
      throw new NotFoundError("Rate product not found");
    }

    return product.product_type === "FULL_PROPERTY"
      ? this.getUniversalFullPropertyCalendarCore(
          trx,
          organizationId,
          propertyId,
          rateProductId,
          startDate,
          endDate
        )
      : this.getCalendarCore(trx, organizationId, propertyId, rateProductId, startDate, endDate);
  }

  async getQuoteCalendarSystem(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    await this.propertyContext(trx, organizationId, propertyId);

    const product = await this.rates.findProduct(trx, organizationId, propertyId, rateProductId);

    if (!product) {
      throw new NotFoundError("Rate product not found");
    }

    return product.product_type === "FULL_PROPERTY"
      ? this.getUniversalFullPropertyCalendarCore(
          trx,
          organizationId,
          propertyId,
          rateProductId,
          startDate,
          endDate
        )
      : this.getCalendarCore(trx, organizationId, propertyId, rateProductId, startDate, endDate);
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
    return this.getCalendarCore(trx, organizationId, propertyId, rateProductId, startDate, endDate);
  }

  async getCalendarSystem(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    rateProductId: string,
    startDate: string,
    endDate: string
  ): Promise<RateCalendarView> {
    await this.propertyContext(trx, organizationId, propertyId);
    return this.getCalendarCore(trx, organizationId, propertyId, rateProductId, startDate, endDate);
  }
}
