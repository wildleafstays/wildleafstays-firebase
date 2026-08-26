import {
  calculateFullPropertyExtraGuestCharge,
  deriveFullPropertySource,
  type DerivedFullPropertyCategoryRate,
  type DerivedFullPropertySource,
  type FullPropertyCategoryRateDay,
  type FullPropertyCategoryRateSource
} from "../../rates/application/derived-full-property-source.js";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import {
  calculateInventoryAvailability,
  type AvailabilityBlockInput,
  type AvailabilityBucketInput,
  type AvailabilityCategoryInput
} from "../../inventory/application/inventory-availability-calculator.js";
import type { SaleMode } from "../../inventory/domain/inventory.js";
import type {
  PublicAvailabilityOptionView,
  PublicAvailabilityReason,
  PublicAvailabilityRequest,
  PublicAvailabilityView
} from "../domain/public-availability.js";
import {
  PublicAvailabilityRepository,
  type PublicAvailabilityCategoryRecord,
  type PublicRateCalendarRecord,
  type PublicRateOfferRecord
} from "../infrastructure/public-availability-repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PUBLIC_STAY_NIGHTS = 30;
const MAX_PUBLIC_UNITS = 20;

interface CalendarDay {
  stayDate: string;
  rateMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
  fullPropertyCategoryRates?: DerivedFullPropertyCategoryRate[];
}

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

function addDays(value: string, days: number): string {
  return formatDate(new Date(parseDate(value).getTime() + days * DAY_MS));
}

function stayDates(arrivalDate: string, departureDate: string): string[] {
  const arrival = parseDate(arrivalDate);
  const departure = parseDate(departureDate);
  const nights = Math.round((departure.getTime() - arrival.getTime()) / DAY_MS);

  if (nights < 1) {
    throw new ValidationError("departureDate must be later than arrivalDate");
  }

  if (nights > MAX_PUBLIC_STAY_NIGHTS) {
    throw new ValidationError(`Public availability cannot exceed ${MAX_PUBLIC_STAY_NIGHTS} nights`);
  }

  return Array.from({ length: nights }, (_, index) =>
    formatDate(new Date(arrival.getTime() + index * DAY_MS))
  );
}

function saleMode(value: string | null): SaleMode {
  if (value === "ROOMS_ONLY" || value === "FULL_PROPERTY_ONLY" || value === "BOTH") {
    return value;
  }

  throw new ValidationError("Property sale mode is not configured for public booking");
}

function validateUnits(input: PublicAvailabilityRequest): void {
  if (input.units.length < 1 || input.units.length > MAX_PUBLIC_UNITS) {
    throw new ValidationError(
      `Public availability requires between 1 and ${MAX_PUBLIC_UNITS} units`
    );
  }

  for (const unit of input.units) {
    if (!Number.isInteger(unit.adults) || unit.adults < 1 || unit.adults > 100) {
      throw new ValidationError("Each unit must contain between 1 and 100 adults");
    }

    if (!Number.isInteger(unit.children) || unit.children < 0 || unit.children > 100) {
      throw new ValidationError("Each unit must contain between 0 and 100 children");
    }
  }
}

function offerMatchesSaleMode(offer: PublicRateOfferRecord, mode: SaleMode): boolean {
  if (offer.product_type === "FULL_PROPERTY") {
    return mode === "FULL_PROPERTY_ONLY" || mode === "BOTH";
  }

  if (offer.product_type === "ROOM_CATEGORY") {
    return mode === "ROOMS_ONLY" || mode === "BOTH";
  }

  return false;
}

function calendarDay(
  offer: PublicRateOfferRecord,
  override: PublicRateCalendarRecord | undefined,
  stayDate: string
): CalendarDay {
  if (!override) {
    return {
      stayDate,
      rateMinor: offer.base_rate_minor,
      extraAdultMinor: offer.extra_adult_minor,
      extraChildMinor: offer.extra_child_minor,
      minimumStay: 1,
      maximumStay: null,
      closedToArrival: false,
      closedToDeparture: false,
      stopSell: false
    };
  }

  return {
    stayDate,
    rateMinor: override.rate_minor,
    extraAdultMinor: override.extra_adult_minor ?? offer.extra_adult_minor,
    extraChildMinor: override.extra_child_minor ?? offer.extra_child_minor,
    minimumStay: override.minimum_stay,
    maximumStay: override.maximum_stay,
    closedToArrival: override.closed_to_arrival,
    closedToDeparture: override.closed_to_departure,
    stopSell: override.stop_sell
  };
}

function fullPropertyCategoryDay(
  offer: PublicRateOfferRecord,
  category: PublicAvailabilityCategoryRecord,
  override: PublicRateCalendarRecord | undefined,
  stayDate: string
): FullPropertyCategoryRateDay {
  if (category.default_extra_adult_minor === null || category.default_extra_child_minor === null) {
    throw new ConflictError(
      "Room-category extra-guest defaults are required for full-property pricing",
      {
        roomCategoryId: category.id
      }
    );
  }

  if (!override) {
    return {
      stayDate,
      rateMinor: offer.base_rate_minor,
      extraAdultMinor: category.default_extra_adult_minor,
      extraChildMinor: category.default_extra_child_minor,
      minimumStay: 1,
      maximumStay: null,
      closedToArrival: false,
      closedToDeparture: false,
      stopSell: false
    };
  }

  return {
    stayDate,
    rateMinor: override.rate_minor,
    extraAdultMinor: override.extra_adult_minor ?? category.default_extra_adult_minor,
    extraChildMinor: override.extra_child_minor ?? category.default_extra_child_minor,
    minimumStay: override.minimum_stay,
    maximumStay: override.maximum_stay,
    closedToArrival: override.closed_to_arrival,
    closedToDeparture: override.closed_to_departure,
    stopSell: override.stop_sell
  };
}

function buildPublicFullPropertySource(
  categories: PublicAvailabilityCategoryRecord[],
  offers: PublicRateOfferRecord[],
  calendarRows: Map<string, PublicRateCalendarRecord>,
  calendarDates: string[]
): DerivedFullPropertySource {
  const sources: FullPropertyCategoryRateSource[] = [];

  for (const category of categories) {
    if (category.capacity <= 0) {
      continue;
    }

    if (
      category.base_adults === null ||
      category.base_children === null ||
      category.default_extra_adult_minor === null ||
      category.default_extra_child_minor === null
    ) {
      throw new ConflictError(
        "Every active physical-room category must have guest and extra-charge defaults before full-property availability can be derived",
        {
          roomCategoryId: category.id
        }
      );
    }

    const candidates = offers.filter(
      (offer) =>
        offer.product_type === "ROOM_CATEGORY" &&
        offer.room_category_id === category.id &&
        offer.meal_plan_code === "EP"
    );

    if (candidates.length !== 1) {
      throw new ConflictError(
        candidates.length === 0
          ? "An active physical-room category is missing its single active EP rate product"
          : "An active physical-room category has more than one active EP rate product",
        {
          roomCategoryId: category.id,
          candidateCount: candidates.length
        }
      );
    }

    const offer = candidates[0]!;

    sources.push({
      roomCategoryId: category.id,
      physicalCapacity: category.capacity,
      includedAdults: category.base_adults,
      includedChildren: category.base_children,
      maxAdults: category.max_adults,
      maxChildren: category.max_children,
      maxOccupancy: category.max_occupancy,
      days: calendarDates.map((stayDate) =>
        fullPropertyCategoryDay(
          offer,
          category,
          calendarRows.get(`${offer.rate_product_id}:${stayDate}`),
          stayDate
        )
      )
    });
  }

  return deriveFullPropertySource(calendarDates, sources);
}

function pushReason(reasons: PublicAvailabilityReason[], reason: PublicAvailabilityReason): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function optionForOffer(
  offer: PublicRateOfferRecord,
  mode: SaleMode,
  input: PublicAvailabilityRequest,
  dates: string[],
  calendarRows: Map<string, PublicRateCalendarRecord>,
  inventory: ReturnType<typeof calculateInventoryAvailability>,
  derivedFullProperty: DerivedFullPropertySource | null
): PublicAvailabilityOptionView | null {
  if (!offerMatchesSaleMode(offer, mode)) {
    return null;
  }

  if (
    offer.product_type === "ROOM_CATEGORY" &&
    (!offer.room_category_id || !offer.room_category_name || !offer.room_category_code)
  ) {
    return null;
  }

  if (offer.product_type !== "ROOM_CATEGORY" && offer.product_type !== "FULL_PROPERTY") {
    return null;
  }

  if (offer.product_type === "FULL_PROPERTY" && offer.meal_plan_code !== "EP") {
    return null;
  }

  if (offer.product_type === "FULL_PROPERTY" && !derivedFullProperty) {
    return null;
  }

  const reasons: PublicAvailabilityReason[] = [];

  const requestedUnits = offer.product_type === "FULL_PROPERTY" ? 1 : input.units.length;

  if (offer.product_type === "FULL_PROPERTY" && input.units.length !== 1) {
    pushReason(reasons, "FULL_PROPERTY_SINGLE_UNIT_ONLY");
  }

  const includedAdults =
    offer.product_type === "FULL_PROPERTY"
      ? derivedFullProperty!.includedAdults
      : offer.included_adults;

  const includedChildren =
    offer.product_type === "FULL_PROPERTY"
      ? derivedFullProperty!.includedChildren
      : offer.included_children;

  const maxAdults =
    offer.product_type === "FULL_PROPERTY" ? derivedFullProperty!.maxAdults : offer.max_adults;

  const maxChildren =
    offer.product_type === "FULL_PROPERTY" ? derivedFullProperty!.maxChildren : offer.max_children;

  const maxOccupancy =
    offer.product_type === "FULL_PROPERTY"
      ? derivedFullProperty!.maxOccupancy
      : offer.max_occupancy;

  for (const unit of input.units) {
    if (
      unit.adults > maxAdults ||
      unit.children > maxChildren ||
      unit.adults + unit.children > maxOccupancy
    ) {
      pushReason(reasons, "OCCUPANCY_EXCEEDED");
    }
  }

  const calendarDates = [...dates, input.departureDate];

  const calendar: CalendarDay[] =
    offer.product_type === "FULL_PROPERTY"
      ? derivedFullProperty!.days.map((day) => ({
          stayDate: day.stayDate,
          rateMinor: day.rateMinor,
          extraAdultMinor: 0,
          extraChildMinor: 0,
          minimumStay: day.minimumStay,
          maximumStay: day.maximumStay,
          closedToArrival: day.closedToArrival,
          closedToDeparture: day.closedToDeparture,
          stopSell: day.stopSell,
          fullPropertyCategoryRates: day.categoryRates
        }))
      : calendarDates.map((stayDate) =>
          calendarDay(offer, calendarRows.get(`${offer.rate_product_id}:${stayDate}`), stayDate)
        );

  const arrivalDay = calendar[0]!;
  const departureDay = calendar[calendar.length - 1]!;
  const stayCalendar = calendar.slice(0, dates.length);
  const nights = dates.length;

  if (arrivalDay.closedToArrival) {
    pushReason(reasons, "ARRIVAL_CLOSED");
  }

  if (departureDay.closedToDeparture) {
    pushReason(reasons, "DEPARTURE_CLOSED");
  }

  if (nights < arrivalDay.minimumStay) {
    pushReason(reasons, "MINIMUM_STAY");
  }

  if (arrivalDay.maximumStay !== null && nights > arrivalDay.maximumStay) {
    pushReason(reasons, "MAXIMUM_STAY");
  }

  if (stayCalendar.some((day) => day.stopSell)) {
    pushReason(reasons, "RATE_STOP_SELL");
  }

  for (const stayDate of dates) {
    const day = inventory.days.find((item) => item.date === stayDate);

    if (!day) {
      pushReason(reasons, "INVENTORY_UNAVAILABLE");
      continue;
    }

    const sellableQuantity =
      offer.product_type === "FULL_PROPERTY"
        ? (day.fullProperty?.sellableQuantity ?? 0)
        : (day.roomCategories.find((category) => category.roomCategoryId === offer.room_category_id)
            ?.sellableQuantity ?? 0);

    if (sellableQuantity < requestedUnits) {
      pushReason(reasons, "INVENTORY_UNAVAILABLE");
    }
  }

  const extraAdults = input.units.reduce(
    (sum, unit) => sum + Math.max(0, unit.adults - includedAdults),
    0
  );

  const extraChildren = input.units.reduce(
    (sum, unit) => sum + Math.max(0, unit.children - includedChildren),
    0
  );

  const accommodationMinor = stayCalendar.reduce(
    (sum, day) => sum + day.rateMinor * requestedUnits,
    0
  );

  const extraGuestMinor = stayCalendar.reduce((sum, day) => {
    if (offer.product_type === "FULL_PROPERTY") {
      if (!day.fullPropertyCategoryRates) {
        throw new ConflictError(
          "Derived full-property category rates are missing from public availability",
          {
            stayDate: day.stayDate
          }
        );
      }

      return (
        sum +
        calculateFullPropertyExtraGuestCharge(
          day.fullPropertyCategoryRates,
          extraAdults,
          extraChildren
        ).totalMinor
      );
    }

    return sum + day.extraAdultMinor * extraAdults + day.extraChildMinor * extraChildren;
  }, 0);

  const nightlyFromMinor = Math.min(...stayCalendar.map((day) => day.rateMinor));

  return {
    rateProductId: offer.rate_product_id,
    productType: offer.product_type,
    roomCategoryId: offer.room_category_id,
    roomCategoryCode: offer.room_category_code,
    roomCategoryName: offer.room_category_name,
    ratePlanCode: offer.rate_plan_code,
    ratePlanName: offer.rate_plan_name,
    mealPlanCode: offer.meal_plan_code,
    currencyCode: offer.currency_code,
    requestedUnits,
    available: reasons.length === 0,
    unavailableReasons: reasons,
    nightlyFromMinor,
    accommodationMinor,
    extraGuestMinor,
    estimatedTotalMinor: accommodationMinor + extraGuestMinor,
    minimumStay: arrivalDay.minimumStay,
    maximumStay: arrivalDay.maximumStay
  };
}

export class PublicAvailabilityService {
  constructor(
    private readonly repository = new PublicAvailabilityRepository(),
    private readonly now: () => Date = () => new Date()
  ) {}

  async search(
    db: Kysely<Database>,
    publicSlug: string,
    input: PublicAvailabilityRequest
  ): Promise<PublicAvailabilityView> {
    validateUnits(input);

    const dates = stayDates(input.arrivalDate, input.departureDate);

    const property = await this.repository.findLivePropertyBySlug(db, publicSlug.toLowerCase());

    if (!property) {
      throw new NotFoundError("Public property not found");
    }

    const mode = saleMode(property.sale_mode);
    const organizationId = property.organization_id;
    const propertyId = property.id;

    const [categories, buckets, blocks, expiredHolds, offers] = await Promise.all([
      this.repository.listRoomCategoryCapacities(db, organizationId, propertyId),
      this.repository.listBuckets(
        db,
        organizationId,
        propertyId,
        input.arrivalDate,
        input.departureDate
      ),
      this.repository.listBlocks(
        db,
        organizationId,
        propertyId,
        input.arrivalDate,
        input.departureDate
      ),
      this.repository.listExpiredHoldQuantities(
        db,
        organizationId,
        propertyId,
        input.arrivalDate,
        input.departureDate,
        this.now()
      ),
      this.repository.listActiveRateOffers(db, organizationId, propertyId)
    ]);

    const rateProductIds = offers
      .filter((offer) => offer.product_type === "ROOM_CATEGORY")
      .map((offer) => offer.rate_product_id);

    const calendarRows = await this.repository.listCalendarDays(
      db,
      rateProductIds,
      input.arrivalDate,
      addDays(input.departureDate, 1)
    );

    const expiredByBucket = new Map(expiredHolds.map((row) => [row.bucket_id, row.quantity]));

    const categoryInputs: AvailabilityCategoryInput[] = categories.map((category) => ({
      id: category.id,
      code: category.code,
      name: category.name,
      capacity: category.capacity
    }));

    const bucketInputs: AvailabilityBucketInput[] = buckets.map((bucket) => ({
      bucketType: bucket.bucket_type === "FULL_PROPERTY" ? "FULL_PROPERTY" : "ROOM_CATEGORY",
      roomCategoryId: bucket.room_category_id,
      stayDate: bucket.stay_date,
      heldQuantity: Math.max(0, bucket.held_quantity - (expiredByBucket.get(bucket.id) ?? 0)),
      confirmedQuantity: bucket.confirmed_quantity,
      capacityOverride: bucket.capacity_override,
      overbookingLimit: bucket.overbooking_limit,
      stopSell: bucket.stop_sell
    }));

    const blockInputs: AvailabilityBlockInput[] = blocks.map((block) => ({
      scopeType:
        block.scope_type === "PROPERTY"
          ? "PROPERTY"
          : block.scope_type === "PHYSICAL_UNIT"
            ? "PHYSICAL_UNIT"
            : "ROOM_CATEGORY",
      roomCategoryId: block.room_category_id,
      physicalUnitId: block.physical_unit_id,
      startDate: block.start_date,
      endDate: block.end_date,
      quantity: block.quantity
    }));

    const inventory = calculateInventoryAvailability({
      propertyId,
      saleMode: mode,
      startDate: input.arrivalDate,
      endDate: input.departureDate,
      dates,
      categories: categoryInputs,
      buckets: bucketInputs,
      blocks: blockInputs,
      missingBucketMode: "VIRTUAL"
    });

    const calendarMap = new Map(
      calendarRows.map((row) => [`${row.rate_product_id}:${row.stay_date}`, row])
    );

    const needsFullProperty = offers.some(
      (offer) =>
        offer.product_type === "FULL_PROPERTY" &&
        offer.meal_plan_code === "EP" &&
        offerMatchesSaleMode(offer, mode)
    );

    const derivedFullProperty = needsFullProperty
      ? buildPublicFullPropertySource(categories, offers, calendarMap, [
          ...dates,
          input.departureDate
        ])
      : null;

    const options = offers
      .map((offer) =>
        optionForOffer(offer, mode, input, dates, calendarMap, inventory, derivedFullProperty)
      )
      .filter((option): option is PublicAvailabilityOptionView => option !== null)
      .sort((left, right) => {
        if (left.available !== right.available) {
          return left.available ? -1 : 1;
        }

        if (left.estimatedTotalMinor !== right.estimatedTotalMinor) {
          return left.estimatedTotalMinor - right.estimatedTotalMinor;
        }

        return left.rateProductId.localeCompare(right.rateProductId);
      });

    return {
      property: {
        publicSlug: property.public_slug,
        name: property.name,
        saleMode: mode
      },
      search: {
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        nights: dates.length,
        units: input.units.map((unit) => ({
          ...unit
        }))
      },
      pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY",
      exactCommercialPriceIncluded: false,
      options
    };
  }
}
