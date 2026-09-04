import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import { PublicAvailabilityService } from "./public-availability-service.js";
import { PublicCatalogService } from "./public-catalog-service.js";
import type { PublicAvailabilityView } from "../domain/public-availability.js";
import type { PublicRoomCategoryView } from "../domain/public-catalog.js";
import type {
  PublicRecommendedRoomItem,
  PublicRecommendedRoomUnit,
  PublicRoomRecommendation,
  PublicRoomRecommendationRequest,
  PublicRoomRecommendationView
} from "../domain/public-room-recommendation.js";

const MAX_RECOMMENDATION_ROOMS = 6;
const MAX_RECOMMENDATION_CANDIDATES = 80;
const MAX_RECOMMENDATIONS = 5;

interface RoomChoice {
  category: PublicRoomCategoryView;
  adults: number;
  children: number;
  key: string;
}

interface CandidatePlan {
  choices: RoomChoice[];
  key: string;
  occupancySlack: number;
}

interface PricedCandidate {
  candidate: CandidatePlan;
  items: PublicRecommendedRoomItem[];
  currencyCode: string;
  estimatedTotalMinor: number;
}

function validateRequest(input: PublicRoomRecommendationRequest): number {
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 20) {
    throw new ValidationError("Smart room recommendations require between 1 and 20 adults");
  }
  if (!Number.isInteger(input.children) || input.children < 0 || input.children > 20) {
    throw new ValidationError("Smart room recommendations require between 0 and 20 children");
  }

  const requestedMaxRooms = input.maxRooms ?? Math.min(input.adults, 4);
  if (
    !Number.isInteger(requestedMaxRooms) ||
    requestedMaxRooms < 1 ||
    requestedMaxRooms > MAX_RECOMMENDATION_ROOMS
  ) {
    throw new ValidationError(
      `maxRooms must be between 1 and ${MAX_RECOMMENDATION_ROOMS}`
    );
  }

  return Math.min(requestedMaxRooms, input.adults);
}

function choiceKey(categoryId: string, adults: number, children: number): string {
  return `${categoryId}:${adults}:${children}`;
}

function canonicalPlanKey(choices: RoomChoice[]): string {
  return [...choices]
    .map((choice) => choice.key)
    .sort()
    .join("|");
}

function recommendationId(key: string): string {
  return `ROOM-MIX-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

function buildChoices(
  categories: PublicRoomCategoryView[],
  adults: number,
  children: number
): RoomChoice[] {
  const choices: RoomChoice[] = [];

  for (const category of categories) {
    for (let roomAdults = 1; roomAdults <= Math.min(category.maxAdults, adults); roomAdults += 1) {
      for (
        let roomChildren = 0;
        roomChildren <= Math.min(category.maxChildren, children);
        roomChildren += 1
      ) {
        if (roomAdults + roomChildren > category.maxOccupancy) continue;
        choices.push({
          category,
          adults: roomAdults,
          children: roomChildren,
          key: choiceKey(category.roomCategoryId, roomAdults, roomChildren)
        });
      }
    }
  }

  return choices.sort((left, right) => left.key.localeCompare(right.key));
}

function enumerateCandidates(
  categories: PublicRoomCategoryView[],
  adults: number,
  children: number,
  maxRooms: number
): CandidatePlan[] {
  const choices = buildChoices(categories, adults, children);
  const seen = new Set<string>();
  const candidates: CandidatePlan[] = [];

  function visit(
    remainingAdults: number,
    remainingChildren: number,
    startIndex: number,
    selected: RoomChoice[]
  ): void {
    if (candidates.length >= MAX_RECOMMENDATION_CANDIDATES) return;

    if (remainingAdults === 0 && remainingChildren === 0) {
      const key = canonicalPlanKey(selected);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          choices: [...selected],
          key,
          occupancySlack: selected.reduce(
            (sum, choice) =>
              sum + choice.category.maxOccupancy - choice.adults - choice.children,
            0
          )
        });
      }
      return;
    }

    if (selected.length >= maxRooms || remainingAdults <= 0) return;

    for (let index = startIndex; index < choices.length; index += 1) {
      const choice = choices[index]!;
      if (choice.adults > remainingAdults || choice.children > remainingChildren) continue;

      selected.push(choice);
      visit(
        remainingAdults - choice.adults,
        remainingChildren - choice.children,
        index,
        selected
      );
      selected.pop();

      if (candidates.length >= MAX_RECOMMENDATION_CANDIDATES) return;
    }
  }

  visit(adults, children, 0, []);

  return candidates.sort((left, right) => {
    if (left.choices.length !== right.choices.length) {
      return left.choices.length - right.choices.length;
    }
    if (left.occupancySlack !== right.occupancySlack) {
      return right.occupancySlack - left.occupancySlack;
    }
    return left.key.localeCompare(right.key);
  });
}

function groupChoices(choices: RoomChoice[]): Map<string, RoomChoice[]> {
  const groups = new Map<string, RoomChoice[]>();
  for (const choice of choices) {
    const current = groups.get(choice.category.roomCategoryId) ?? [];
    current.push(choice);
    groups.set(choice.category.roomCategoryId, current);
  }
  return groups;
}

function unitsSignature(units: PublicRecommendedRoomUnit[]): string {
  return [...units]
    .sort((left, right) => right.adults - left.adults || right.children - left.children)
    .map((unit) => `${unit.adults}a${unit.children}c`)
    .join(",");
}

function reasonFor(
  candidate: PricedCandidate,
  index: number,
  all: PricedCandidate[]
): PublicRoomRecommendation["reason"] {
  if (index === 0) return "BEST_VALUE";

  const minimumRooms = Math.min(...all.map((item) => item.candidate.choices.length));
  const minimumRoomCandidate = all.find(
    (item) =>
      item.candidate.choices.length === minimumRooms &&
      item.estimatedTotalMinor !== all[0]!.estimatedTotalMinor
  );
  if (minimumRoomCandidate?.candidate.key === candidate.candidate.key) return "FEWER_ROOMS";

  const spacious = [...all]
    .filter((item) => item.candidate.key !== all[0]!.candidate.key)
    .sort(
      (left, right) =>
        right.candidate.occupancySlack - left.candidate.occupancySlack ||
        left.estimatedTotalMinor - right.estimatedTotalMinor
    )[0];
  if (spacious?.candidate.key === candidate.candidate.key) return "MORE_SPACE";

  return "ALTERNATIVE";
}

export class PublicRoomRecommendationService {
  constructor(
    private readonly catalog = new PublicCatalogService(),
    private readonly availability = new PublicAvailabilityService()
  ) {}

  async recommend(
    db: Kysely<Database>,
    publicSlug: string,
    input: PublicRoomRecommendationRequest
  ): Promise<PublicRoomRecommendationView> {
    const maxRooms = validateRequest(input);
    const { property } = await this.catalog.getProperty(db, publicSlug);

    const allowsRooms =
      !property.saleMode ||
      property.saleMode === "ROOMS_ONLY" ||
      property.saleMode === "BOTH";

    if (!allowsRooms || property.roomCategories.length === 0) {
      return {
        property: { publicSlug: property.publicSlug, name: property.name },
        search: {
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          adults: input.adults,
          children: input.children,
          maxRooms
        },
        pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY",
        exactCommercialPriceIncluded: false,
        singleCheckoutSupported: false,
        recommendations: []
      };
    }

    const candidates = enumerateCandidates(
      property.roomCategories,
      input.adults,
      input.children,
      maxRooms
    );

    const availabilityCache = new Map<string, PublicAvailabilityView>();

    const getAvailability = async (
      units: PublicRecommendedRoomUnit[]
    ): Promise<PublicAvailabilityView> => {
      const signature = unitsSignature(units);
      const cached = availabilityCache.get(signature);
      if (cached) return cached;

      const result = await this.availability.search(db, publicSlug, {
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        units: units.map((unit) => ({
          adults: unit.adults,
          children: unit.children
        }))
      });
      availabilityCache.set(signature, result);
      return result;
    };

    const priced: PricedCandidate[] = [];

    for (const candidate of candidates) {
      const groups = groupChoices(candidate.choices);
      const items: PublicRecommendedRoomItem[] = [];
      let totalMinor = 0;
      let currencyCode: string | null = null;
      let valid = true;

      for (const [roomCategoryId, group] of groups) {
        const units = group.map((choice) => ({
          adults: choice.adults,
          children: choice.children
        }));
        const availability = await getAvailability(units);

        const options = availability.options
          .filter(
            (option) =>
              option.productType === "ROOM_CATEGORY" &&
              option.roomCategoryId === roomCategoryId &&
              option.available
          )
          .sort(
            (left, right) =>
              left.estimatedTotalMinor - right.estimatedTotalMinor ||
              left.ratePlanName.localeCompare(right.ratePlanName)
          );

        const option = options[0];
        if (!option) {
          valid = false;
          break;
        }

        if (currencyCode !== null && currencyCode !== option.currencyCode) {
          valid = false;
          break;
        }
        currencyCode = option.currencyCode;

        const category = group[0]!.category;
        items.push({
          roomCategoryId,
          roomCategoryName: category.name,
          coverMediaId: category.coverMediaId,
          rateProductId: option.rateProductId,
          ratePlanCode: option.ratePlanCode,
          ratePlanName: option.ratePlanName,
          mealPlanCode: option.mealPlanCode,
          quantity: group.length,
          maxOccupancy: category.maxOccupancy,
          units,
          estimatedTotalMinor: option.estimatedTotalMinor
        });
        totalMinor += option.estimatedTotalMinor;
      }

      if (!valid || currencyCode === null) continue;

      priced.push({
        candidate,
        items: items.sort((left, right) => left.roomCategoryName.localeCompare(right.roomCategoryName)),
        currencyCode,
        estimatedTotalMinor: totalMinor
      });
    }

    priced.sort(
      (left, right) =>
        left.estimatedTotalMinor - right.estimatedTotalMinor ||
        left.candidate.choices.length - right.candidate.choices.length ||
        right.candidate.occupancySlack - left.candidate.occupancySlack
    );

    const selected = priced.slice(0, MAX_RECOMMENDATIONS);
    const recommendations: PublicRoomRecommendation[] = selected.map((candidate, index) => ({
      recommendationId: recommendationId(candidate.candidate.key),
      rank: index + 1,
      reason: reasonFor(candidate, index, selected),
      roomCount: candidate.candidate.choices.length,
      adults: input.adults,
      children: input.children,
      currencyCode: candidate.currencyCode,
      estimatedTotalMinor: candidate.estimatedTotalMinor,
      occupancySlack: candidate.candidate.occupancySlack,
      items: candidate.items
    }));

    return {
      property: { publicSlug: property.publicSlug, name: property.name },
      search: {
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        adults: input.adults,
        children: input.children,
        maxRooms
      },
      pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY",
      exactCommercialPriceIncluded: false,
      singleCheckoutSupported: false,
      recommendations
    };
  }
}
