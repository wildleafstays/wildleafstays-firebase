import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";
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
import { PublicAvailabilityRepository } from "../infrastructure/public-availability-repository.js";

const MAX_RECOMMENDATION_ROOMS = 6;
const MAX_RECOMMENDATION_CANDIDATES = 80;
const MAX_RECOMMENDATIONS = 5;

interface GuestAgePolicy {
  infantMaxAge: number | null;
  childMaxAge: number;
  infantsCountTowardsOccupancy: boolean;
  infantsCountTowardsChildLimit: boolean;
  infantsChargeAsChildren: boolean;
}

interface ClassifiedAges {
  children: number[];
  infants: number[];
}

interface RoomChoice {
  category: PublicRoomCategoryView;
  adults: number;
  children: number;
  infants: number;
  key: string;
}

interface ResolvedRoomChoice extends RoomChoice {
  childAges: number[];
  availabilityChildren: number;
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

export class PublicRecommendationGuestAgePolicyReader {
  constructor(private readonly properties = new PublicAvailabilityRepository()) {}

  async resolve(
    db: Kysely<Database>,
    publicSlug: string,
    arrivalDate: string
  ): Promise<GuestAgePolicy | null> {
    const property = await this.properties.findLivePropertyBySlug(db, publicSlug.toLowerCase());
    if (!property) return null;

    const settings = await db
      .selectFrom("property_commercial_setting_versions")
      .select("id")
      .where("organization_id", "=", property.organization_id)
      .where("property_id", "=", property.id)
      .where("effective_from", "<=", arrivalDate)
      .orderBy("effective_from", "desc")
      .orderBy("version_number", "desc")
      .executeTakeFirst();

    if (!settings) return null;

    const policy = await db
      .selectFrom("guest_age_policy_versions")
      .select([
        "infant_max_age",
        "child_max_age",
        "infants_count_towards_occupancy",
        "infants_count_towards_child_limit",
        "infants_charge_as_children"
      ])
      .where("organization_id", "=", property.organization_id)
      .where("property_id", "=", property.id)
      .where("effective_from", "<=", arrivalDate)
      .orderBy("effective_from", "desc")
      .orderBy("version_number", "desc")
      .executeTakeFirst();

    if (!policy) {
      throw new ConflictError(
        "Smart room matching requires the property's effective guest age policy",
        { arrivalDate }
      );
    }

    return {
      infantMaxAge: policy.infant_max_age,
      childMaxAge: policy.child_max_age,
      infantsCountTowardsOccupancy: policy.infants_count_towards_occupancy,
      infantsCountTowardsChildLimit: policy.infants_count_towards_child_limit,
      infantsChargeAsChildren: policy.infants_charge_as_children
    };
  }
}

function validateRequest(input: PublicRoomRecommendationRequest): number {
  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > 20) {
    throw new ValidationError("Smart room recommendations require between 1 and 20 adults");
  }
  if (!Array.isArray(input.childAges) || input.childAges.length > 20) {
    throw new ValidationError("Smart room recommendations allow up to 20 child ages");
  }
  for (const age of input.childAges) {
    if (!Number.isInteger(age) || age < 0 || age > 17) {
      throw new ValidationError("Child ages must be whole years from 0 to 17");
    }
  }

  const requestedMaxRooms = input.maxRooms ?? Math.min(input.adults, 4);
  if (
    !Number.isInteger(requestedMaxRooms) ||
    requestedMaxRooms < 1 ||
    requestedMaxRooms > MAX_RECOMMENDATION_ROOMS
  ) {
    throw new ValidationError(`maxRooms must be between 1 and ${MAX_RECOMMENDATION_ROOMS}`);
  }

  return Math.min(requestedMaxRooms, input.adults);
}

function classifyAges(childAges: number[], policy: GuestAgePolicy | null): ClassifiedAges {
  if (!policy) {
    return { children: [...childAges], infants: [] };
  }

  const children: number[] = [];
  const infants: number[] = [];

  for (const age of childAges) {
    if (age > policy.childMaxAge) {
      throw new ValidationError(
        "A guest older than the configured child maximum age must be counted as an adult",
        { age, childMaxAge: policy.childMaxAge }
      );
    }

    if (policy.infantMaxAge !== null && age <= policy.infantMaxAge) {
      infants.push(age);
    } else {
      children.push(age);
    }
  }

  return { children, infants };
}

function childLimitCount(children: number, infants: number, policy: GuestAgePolicy | null): number {
  return children + (policy?.infantsCountTowardsChildLimit ? infants : 0);
}

function occupancyChildren(
  children: number,
  infants: number,
  policy: GuestAgePolicy | null
): number {
  return children + (policy?.infantsCountTowardsOccupancy ? infants : 0);
}

function chargeableChildren(
  children: number,
  infants: number,
  policy: GuestAgePolicy | null
): number {
  return children + (policy?.infantsChargeAsChildren ? infants : 0);
}

function choiceKey(categoryId: string, adults: number, children: number, infants: number): string {
  return `${categoryId}:${adults}:${children}:${infants}`;
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
  children: number,
  infants: number,
  policy: GuestAgePolicy | null
): RoomChoice[] {
  const choices: RoomChoice[] = [];

  for (const category of categories) {
    for (let roomAdults = 1; roomAdults <= Math.min(category.maxAdults, adults); roomAdults += 1) {
      for (let roomChildren = 0; roomChildren <= children; roomChildren += 1) {
        for (let roomInfants = 0; roomInfants <= infants; roomInfants += 1) {
          if (
            childLimitCount(roomChildren, roomInfants, policy) > category.maxChildren ||
            roomAdults + occupancyChildren(roomChildren, roomInfants, policy) >
              category.maxOccupancy
          ) {
            continue;
          }

          choices.push({
            category,
            adults: roomAdults,
            children: roomChildren,
            infants: roomInfants,
            key: choiceKey(category.roomCategoryId, roomAdults, roomChildren, roomInfants)
          });
        }
      }
    }
  }

  return choices.sort((left, right) => left.key.localeCompare(right.key));
}

function enumerateCandidates(
  categories: PublicRoomCategoryView[],
  adults: number,
  children: number,
  infants: number,
  maxRooms: number,
  policy: GuestAgePolicy | null
): CandidatePlan[] {
  const choices = buildChoices(categories, adults, children, infants, policy);
  const seen = new Set<string>();
  const candidates: CandidatePlan[] = [];

  function visit(
    remainingAdults: number,
    remainingChildren: number,
    remainingInfants: number,
    startIndex: number,
    selected: RoomChoice[]
  ): void {
    if (candidates.length >= MAX_RECOMMENDATION_CANDIDATES) return;

    if (remainingAdults === 0 && remainingChildren === 0 && remainingInfants === 0) {
      const key = canonicalPlanKey(selected);
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push({
          choices: [...selected],
          key,
          occupancySlack: selected.reduce(
            (sum, choice) =>
              sum +
              choice.category.maxOccupancy -
              choice.adults -
              occupancyChildren(choice.children, choice.infants, policy),
            0
          )
        });
      }
      return;
    }

    if (selected.length >= maxRooms || remainingAdults <= 0) return;

    for (let index = startIndex; index < choices.length; index += 1) {
      const choice = choices[index]!;
      if (
        choice.adults > remainingAdults ||
        choice.children > remainingChildren ||
        choice.infants > remainingInfants
      ) {
        continue;
      }

      selected.push(choice);
      visit(
        remainingAdults - choice.adults,
        remainingChildren - choice.children,
        remainingInfants - choice.infants,
        index,
        selected
      );
      selected.pop();

      if (candidates.length >= MAX_RECOMMENDATION_CANDIDATES) return;
    }
  }

  visit(adults, children, infants, 0, []);

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

function resolveChildAges(
  choices: RoomChoice[],
  classified: ClassifiedAges,
  policy: GuestAgePolicy | null
): ResolvedRoomChoice[] {
  let childIndex = 0;
  let infantIndex = 0;

  return choices.map((choice) => {
    const children = classified.children.slice(childIndex, childIndex + choice.children);
    childIndex += choice.children;
    const infants = classified.infants.slice(infantIndex, infantIndex + choice.infants);
    infantIndex += choice.infants;
    const childAges = [...children, ...infants];

    return {
      ...choice,
      childAges,
      availabilityChildren: Math.max(
        childLimitCount(choice.children, choice.infants, policy),
        occupancyChildren(choice.children, choice.infants, policy),
        chargeableChildren(choice.children, choice.infants, policy)
      )
    };
  });
}

function groupChoices(choices: ResolvedRoomChoice[]): Map<string, ResolvedRoomChoice[]> {
  const groups = new Map<string, ResolvedRoomChoice[]>();
  for (const choice of choices) {
    const current = groups.get(choice.category.roomCategoryId) ?? [];
    current.push(choice);
    groups.set(choice.category.roomCategoryId, current);
  }
  return groups;
}

function unitsSignature(units: Array<{ adults: number; children: number }>): string {
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
    private readonly availability = new PublicAvailabilityService(),
    private readonly agePolicies = new PublicRecommendationGuestAgePolicyReader()
  ) {}

  async recommend(
    db: Kysely<Database>,
    publicSlug: string,
    input: PublicRoomRecommendationRequest
  ): Promise<PublicRoomRecommendationView> {
    const maxRooms = validateRequest(input);
    const [{ property }, agePolicy] = await Promise.all([
      this.catalog.getProperty(db, publicSlug),
      this.agePolicies.resolve(db, publicSlug, input.arrivalDate)
    ]);
    const classified = classifyAges(input.childAges, agePolicy);

    const allowsRooms =
      !property.saleMode || property.saleMode === "ROOMS_ONLY" || property.saleMode === "BOTH";

    const empty = (): PublicRoomRecommendationView => ({
      property: { publicSlug: property.publicSlug, name: property.name },
      search: {
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        adults: input.adults,
        children: input.childAges.length,
        childAges: [...input.childAges],
        maxRooms
      },
      pricingScope: "BASE_RATE_AND_EXTRA_GUEST_ONLY",
      exactCommercialPriceIncluded: false,
      singleCheckoutSupported: true,
      recommendations: []
    });

    if (!allowsRooms || property.roomCategories.length === 0) return empty();

    const candidates = enumerateCandidates(
      property.roomCategories,
      input.adults,
      classified.children.length,
      classified.infants.length,
      maxRooms,
      agePolicy
    );

    const availabilityCache = new Map<string, PublicAvailabilityView>();

    const getAvailability = async (
      units: Array<{ adults: number; children: number }>
    ): Promise<PublicAvailabilityView> => {
      const signature = unitsSignature(units);
      const cached = availabilityCache.get(signature);
      if (cached) return cached;

      const result = await this.availability.search(db, publicSlug, {
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        units
      });
      availabilityCache.set(signature, result);
      return result;
    };

    const priced: PricedCandidate[] = [];

    for (const candidate of candidates) {
      const resolvedChoices = resolveChildAges(candidate.choices, classified, agePolicy);
      const groups = groupChoices(resolvedChoices);
      const items: PublicRecommendedRoomItem[] = [];
      let totalMinor = 0;
      let currencyCode: string | null = null;
      let valid = true;

      for (const [roomCategoryId, group] of groups) {
        const availabilityUnits = group.map((choice) => ({
          adults: choice.adults,
          children: choice.availabilityChildren
        }));
        const availability = await getAvailability(availabilityUnits);

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
        const units: PublicRecommendedRoomUnit[] = group.map((choice) => ({
          adults: choice.adults,
          children: choice.childAges.length,
          childAges: [...choice.childAges]
        }));

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
        items: items.sort((left, right) =>
          left.roomCategoryName.localeCompare(right.roomCategoryName)
        ),
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
      children: input.childAges.length,
      currencyCode: candidate.currencyCode,
      estimatedTotalMinor: candidate.estimatedTotalMinor,
      occupancySlack: candidate.candidate.occupancySlack,
      items: candidate.items
    }));

    return {
      ...empty(),
      recommendations
    };
  }
}
