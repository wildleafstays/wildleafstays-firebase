import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";
import type { InventoryAvailabilityResult } from "../../inventory/domain/inventory.js";
import type { RateCalendarView } from "../../rates/domain/rates.js";
import type {
  CreateQuoteInput,
  QuoteCalculation,
  QuoteNightSnapshot,
  QuoteUnitSnapshot
} from "../domain/quote.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_STAY_NIGHTS = 365;

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

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  const next = new Date(date.getTime() + days * DAY_MS);
  return [
    next.getUTCFullYear().toString().padStart(4, "0"),
    (next.getUTCMonth() + 1).toString().padStart(2, "0"),
    next.getUTCDate().toString().padStart(2, "0")
  ].join("-");
}

export function stayNightCount(arrivalDate: string, departureDate: string): number {
  const start = parseDate(arrivalDate);
  const end = parseDate(departureDate);
  const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (nights < 1) {
    throw new ValidationError("departureDate must be later than arrivalDate");
  }
  if (nights > MAX_STAY_NIGHTS) {
    throw new ValidationError(`Stay cannot exceed ${MAX_STAY_NIGHTS} nights`);
  }
  return nights;
}

function validateUnits(input: CreateQuoteInput, calendar: RateCalendarView): QuoteUnitSnapshot[] {
  const product = calendar.rateProduct;
  const quantity = input.units.length;

  if (quantity < 1 || quantity > 20) {
    throw new ValidationError("Quote must contain between 1 and 20 sellable units");
  }

  if (product.productType === "FULL_PROPERTY" && quantity !== 1) {
    throw new ValidationError("Full-property quotes must contain exactly one occupancy unit");
  }

  return input.units.map((unit, index) => {
    if (!Number.isInteger(unit.adults) || unit.adults < 1 || unit.adults > 100) {
      throw new ValidationError("Each quoted unit must contain at least one adult");
    }
    if (!Array.isArray(unit.childAges) || unit.childAges.length > 100) {
      throw new ValidationError("childAges must be an array");
    }
    for (const age of unit.childAges) {
      if (!Number.isInteger(age) || age < 0 || age > 17) {
        throw new ValidationError("Child ages must be whole years from 0 to 17");
      }
    }

    const children = unit.childAges.length;
    if (unit.adults > product.maxAdults) {
      throw new ValidationError("Adult occupancy exceeds the selected rate product", {
        unitIndex: index + 1,
        adults: unit.adults,
        maxAdults: product.maxAdults
      });
    }
    if (children > product.maxChildren) {
      throw new ValidationError("Child occupancy exceeds the selected rate product", {
        unitIndex: index + 1,
        children,
        maxChildren: product.maxChildren
      });
    }
    if (unit.adults + children > product.maxOccupancy) {
      throw new ValidationError("Total occupancy exceeds the selected rate product", {
        unitIndex: index + 1,
        occupancy: unit.adults + children,
        maxOccupancy: product.maxOccupancy
      });
    }

    return {
      unitIndex: index + 1,
      adults: unit.adults,
      childAges: [...unit.childAges],
      includedAdults: product.includedAdults,
      includedChildren: product.includedChildren,
      maxAdults: product.maxAdults,
      maxChildren: product.maxChildren,
      maxOccupancy: product.maxOccupancy,
      extraAdults: Math.max(0, unit.adults - product.includedAdults),
      extraChildren: Math.max(0, children - product.includedChildren)
    };
  });
}

function sellableQuantityForDate(
  input: CreateQuoteInput,
  calendar: RateCalendarView,
  availability: InventoryAvailabilityResult,
  stayDate: string
): number {
  const day = availability.days.find((item) => item.date === stayDate);
  if (!day) {
    throw new ConflictError("Canonical inventory is missing a quoted stay date", { stayDate });
  }

  if (calendar.rateProduct.productType === "FULL_PROPERTY") {
    if (!day.fullProperty) {
      throw new ConflictError("Full-property inventory is not available for this property", {
        stayDate
      });
    }
    return day.fullProperty.sellableQuantity;
  }

  const roomCategoryId = calendar.rateProduct.roomCategoryId;
  if (!roomCategoryId) {
    throw new ConflictError("Room-category rate product is missing its room category");
  }
  const category = day.roomCategories.find((item) => item.roomCategoryId === roomCategoryId);
  if (!category) {
    throw new ConflictError("Room-category inventory is missing for the quoted product", {
      stayDate,
      roomCategoryId
    });
  }
  return category.sellableQuantity;
}

function productLabel(
  calendar: RateCalendarView,
  availability: InventoryAvailabilityResult
): string {
  if (calendar.rateProduct.productType === "FULL_PROPERTY") {
    return "Full Property";
  }
  const roomCategoryId = calendar.rateProduct.roomCategoryId;
  if (!roomCategoryId) return "Room Category";
  for (const day of availability.days) {
    const category = day.roomCategories.find((item) => item.roomCategoryId === roomCategoryId);
    if (category) return category.roomCategoryName;
  }
  return "Room Category";
}

export function calculateQuote(
  input: CreateQuoteInput,
  calendar: RateCalendarView,
  availability: InventoryAvailabilityResult
): QuoteCalculation {
  const nights = stayNightCount(input.arrivalDate, input.departureDate);

  if (calendar.startDate !== input.arrivalDate) {
    throw new ConflictError("Rate calendar does not start on quote arrival date");
  }
  if (
    availability.startDate !== input.arrivalDate ||
    availability.endDate !== input.departureDate
  ) {
    throw new ConflictError("Inventory snapshot does not match quote dates");
  }
  if (calendar.rateProduct.status !== "ACTIVE" || calendar.ratePlan.status !== "ACTIVE") {
    throw new ConflictError("Inactive rate products cannot be quoted");
  }

  const stayDays = calendar.days.filter((day) => day.stayDate < input.departureDate);
  if (stayDays.length !== nights) {
    throw new ConflictError("Rate calendar is incomplete for the requested stay");
  }
  const arrivalDay = stayDays[0];
  if (!arrivalDay) {
    throw new ConflictError("Arrival rate is missing");
  }
  const departureDay = calendar.days.find((day) => day.stayDate === input.departureDate);
  if (!departureDay) {
    throw new ConflictError("Departure restriction snapshot is missing");
  }

  if (arrivalDay.closedToArrival) {
    throw new ConflictError("Selected rate is closed to arrival on the requested date", {
      arrivalDate: input.arrivalDate
    });
  }
  if (departureDay.closedToDeparture) {
    throw new ConflictError("Selected rate is closed to departure on the requested date", {
      departureDate: input.departureDate
    });
  }
  if (nights < arrivalDay.minimumStay) {
    throw new ConflictError("Selected rate requires a longer minimum stay", {
      minimumStay: arrivalDay.minimumStay,
      requestedNights: nights
    });
  }
  if (arrivalDay.maximumStay !== null && nights > arrivalDay.maximumStay) {
    throw new ConflictError("Selected rate does not permit a stay this long", {
      maximumStay: arrivalDay.maximumStay,
      requestedNights: nights
    });
  }

  const units = validateUnits(input, calendar);
  const quantity = units.length;
  const extraAdults = units.reduce((sum, unit) => sum + unit.extraAdults, 0);
  const extraChildren = units.reduce((sum, unit) => sum + unit.extraChildren, 0);

  const quoteNights: QuoteNightSnapshot[] = [];
  let accommodationMinor = 0;
  let extraGuestMinor = 0;

  for (const day of stayDays) {
    if (day.stopSell) {
      throw new ConflictError("Selected rate is stopped for sale on a requested night", {
        stayDate: day.stayDate
      });
    }

    const sellableQuantity = sellableQuantityForDate(input, calendar, availability, day.stayDate);
    if (sellableQuantity < quantity) {
      throw new ConflictError("Requested inventory is no longer available", {
        stayDate: day.stayDate,
        requestedQuantity: quantity,
        sellableQuantity
      });
    }

    const accommodation = day.rateMinor * quantity;
    const extraAdult = day.extraAdultMinor * extraAdults;
    const extraChild = day.extraChildMinor * extraChildren;
    const extras = extraAdult + extraChild;
    const nightTotal = accommodation + extras;

    accommodationMinor += accommodation;
    extraGuestMinor += extras;

    quoteNights.push({
      stayDate: day.stayDate,
      nightlyUnitRateMinor: day.rateMinor,
      accommodationMinor: accommodation,
      extraAdultMinor: extraAdult,
      extraChildMinor: extraChild,
      extraGuestMinor: extras,
      nightTotalMinor: nightTotal,
      sellableQuantitySnapshot: sellableQuantity,
      rateSource: day.source,
      rateOverrideVersion: day.overrideVersion,
      minimumStay: day.minimumStay,
      maximumStay: day.maximumStay,
      closedToArrival: day.closedToArrival,
      closedToDeparture: day.closedToDeparture,
      stopSell: day.stopSell
    });
  }

  const totalMinor = accommodationMinor + extraGuestMinor;

  return {
    ratePlanId: calendar.ratePlan.id,
    ratePlanCode: calendar.ratePlan.code,
    ratePlanName: calendar.ratePlan.name,
    mealPlanCode: calendar.ratePlan.mealPlanCode,
    rateProductId: calendar.rateProduct.id,
    rateProductVersion: calendar.rateProduct.version,
    productType: calendar.rateProduct.productType,
    productLabel: productLabel(calendar, availability),
    roomCategoryId: calendar.rateProduct.roomCategoryId,
    quantity,
    currencyCode: calendar.currencyCode,
    accommodationMinor,
    extraGuestMinor,
    taxMinor: 0,
    feeMinor: 0,
    totalMinor,
    arrivalClosedToArrival: arrivalDay.closedToArrival,
    departureClosedToDeparture: departureDay.closedToDeparture,
    minimumStaySnapshot: arrivalDay.minimumStay,
    maximumStaySnapshot: arrivalDay.maximumStay,
    commercialStatus: "PRE_TAX_ONLY",
    holdEligible: false,
    units,
    nights: quoteNights
  };
}
