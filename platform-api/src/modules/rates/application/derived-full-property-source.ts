import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";

export interface FullPropertyCategoryRateDay {
  stayDate: string;
  rateMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
}

export interface FullPropertyCategoryRateSource {
  roomCategoryId: string;
  physicalCapacity: number;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  days: FullPropertyCategoryRateDay[];
}

export interface DerivedFullPropertyCategoryRate {
  roomCategoryId: string;
  physicalCapacity: number;
  unitRateMinor: number;
  extraAdultMinor: number;
  extraChildMinor: number;
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
}

export interface DerivedFullPropertyRateDay {
  stayDate: string;
  rateMinor: number;
  minimumStay: number;
  maximumStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  stopSell: boolean;
  categoryRates: DerivedFullPropertyCategoryRate[];
}

export interface DerivedFullPropertySource {
  includedAdults: number;
  includedChildren: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  days: DerivedFullPropertyRateDay[];
}

function positiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
}

function validateSource(source: FullPropertyCategoryRateSource): void {
  positiveInteger(source.physicalCapacity, "physicalCapacity");
  positiveInteger(source.includedAdults, "includedAdults");
  positiveInteger(source.includedChildren, "includedChildren");
  positiveInteger(source.maxAdults, "maxAdults");
  positiveInteger(source.maxChildren, "maxChildren");
  positiveInteger(source.maxOccupancy, "maxOccupancy");

  if (source.maxOccupancy < 1) {
    throw new ValidationError("maxOccupancy must allow at least one guest");
  }

  if (source.includedAdults > source.maxAdults || source.includedChildren > source.maxChildren) {
    throw new ValidationError(
      "Included category occupancy cannot exceed category maximum occupancy"
    );
  }

  if (source.maxOccupancy > source.maxAdults + source.maxChildren) {
    throw new ValidationError("Category maxOccupancy exceeds its adult and child capacity");
  }

  const dates = new Set<string>();

  for (const day of source.days) {
    if (dates.has(day.stayDate)) {
      throw new ConflictError("A room category contains duplicate rate-calendar dates", {
        roomCategoryId: source.roomCategoryId,
        stayDate: day.stayDate
      });
    }

    dates.add(day.stayDate);

    positiveInteger(day.rateMinor, "rateMinor");
    positiveInteger(day.extraAdultMinor, "extraAdultMinor");
    positiveInteger(day.extraChildMinor, "extraChildMinor");

    if (!Number.isInteger(day.minimumStay) || day.minimumStay < 1 || day.minimumStay > 365) {
      throw new ValidationError("minimumStay must be between 1 and 365");
    }

    if (
      day.maximumStay !== null &&
      (!Number.isInteger(day.maximumStay) ||
        day.maximumStay < day.minimumStay ||
        day.maximumStay > 365)
    ) {
      throw new ValidationError("maximumStay must be null or between minimumStay and 365");
    }
  }
}

export function deriveFullPropertySource(
  stayDates: string[],
  categorySources: FullPropertyCategoryRateSource[]
): DerivedFullPropertySource {
  if (stayDates.length < 1) {
    throw new ValidationError("At least one stay date is required for full-property derivation");
  }

  const activeSources = categorySources.filter((source) => source.physicalCapacity > 0);

  if (activeSources.length < 1) {
    throw new ConflictError("Full-property pricing requires at least one active physical room");
  }

  for (const source of activeSources) {
    validateSource(source);
  }

  const includedAdults = activeSources.reduce(
    (sum, source) => sum + source.includedAdults * source.physicalCapacity,
    0
  );

  const includedChildren = activeSources.reduce(
    (sum, source) => sum + source.includedChildren * source.physicalCapacity,
    0
  );

  const maxAdults = activeSources.reduce(
    (sum, source) => sum + source.maxAdults * source.physicalCapacity,
    0
  );

  const maxChildren = activeSources.reduce(
    (sum, source) => sum + source.maxChildren * source.physicalCapacity,
    0
  );

  const maxOccupancy = activeSources.reduce(
    (sum, source) => sum + source.maxOccupancy * source.physicalCapacity,
    0
  );

  const days = stayDates.map((stayDate): DerivedFullPropertyRateDay => {
    const categoryRates: DerivedFullPropertyCategoryRate[] = activeSources.map((source) => {
      const day = source.days.find((candidate) => candidate.stayDate === stayDate);

      if (!day) {
        throw new ConflictError(
          "A room category is missing the universal rate-calendar date required for full-property pricing",
          {
            roomCategoryId: source.roomCategoryId,
            stayDate
          }
        );
      }

      return {
        roomCategoryId: source.roomCategoryId,
        physicalCapacity: source.physicalCapacity,
        unitRateMinor: day.rateMinor,
        extraAdultMinor: day.extraAdultMinor,
        extraChildMinor: day.extraChildMinor,
        includedAdults: source.includedAdults,
        includedChildren: source.includedChildren,
        maxAdults: source.maxAdults,
        maxChildren: source.maxChildren,
        maxOccupancy: source.maxOccupancy
      };
    });

    const sourceDays = activeSources.map((source) => {
      const day = source.days.find((candidate) => candidate.stayDate === stayDate);

      if (!day) {
        throw new ConflictError(
          "A room category is missing the universal rate-calendar date required for full-property pricing",
          {
            roomCategoryId: source.roomCategoryId,
            stayDate
          }
        );
      }

      return day;
    });

    const minimumStay = Math.max(...sourceDays.map((day) => day.minimumStay));

    const maximumStayValues = sourceDays
      .map((day) => day.maximumStay)
      .filter((value): value is number => value !== null);

    const maximumStay = maximumStayValues.length === 0 ? null : Math.min(...maximumStayValues);

    const incompatibleStayRules = maximumStay !== null && maximumStay < minimumStay;

    return {
      stayDate,
      rateMinor: categoryRates.reduce(
        (sum, category) => sum + category.unitRateMinor * category.physicalCapacity,
        0
      ),
      minimumStay,
      maximumStay,
      closedToArrival: sourceDays.some((day) => day.closedToArrival),
      closedToDeparture: sourceDays.some((day) => day.closedToDeparture),
      stopSell: incompatibleStayRules || sourceDays.some((day) => day.stopSell),
      categoryRates
    };
  });

  return {
    includedAdults,
    includedChildren,
    maxAdults,
    maxChildren,
    maxOccupancy,
    days
  };
}

export interface FullPropertyExtraGuestCharge {
  extraAdultMinor: number;
  extraChildMinor: number;
  totalMinor: number;
}

interface FullPropertyFlowEdge {
  to: number;
  reverseIndex: number;
  capacity: number;
  cost: number;
  originalCapacity: number;
}

function addFullPropertyFlowEdge(
  graph: FullPropertyFlowEdge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number
): FullPropertyFlowEdge {
  const forward: FullPropertyFlowEdge = {
    to,
    reverseIndex: graph[to]!.length,
    capacity,
    cost,
    originalCapacity: capacity
  };

  const reverse: FullPropertyFlowEdge = {
    to: from,
    reverseIndex: graph[from]!.length,
    capacity: 0,
    cost: -cost,
    originalCapacity: 0
  };

  graph[from]!.push(forward);
  graph[to]!.push(reverse);

  return forward;
}

export function calculateFullPropertyExtraGuestCharge(
  categoryRates: DerivedFullPropertyCategoryRate[],
  extraAdults: number,
  extraChildren: number
): FullPropertyExtraGuestCharge {
  positiveInteger(extraAdults, "extraAdults");
  positiveInteger(extraChildren, "extraChildren");

  if (extraAdults === 0 && extraChildren === 0) {
    return {
      extraAdultMinor: 0,
      extraChildMinor: 0,
      totalMinor: 0
    };
  }

  const sourceNode = 0;
  const adultNode = 1;
  const childNode = 2;
  const firstCategoryNode = 3;
  const sinkNode = firstCategoryNode + categoryRates.length;
  const nodeCount = sinkNode + 1;

  const graph: FullPropertyFlowEdge[][] = Array.from({ length: nodeCount }, () => []);

  addFullPropertyFlowEdge(graph, sourceNode, adultNode, extraAdults, 0);

  addFullPropertyFlowEdge(graph, sourceNode, childNode, extraChildren, 0);

  const adultChargeEdges: Array<{
    edge: FullPropertyFlowEdge;
    unitCost: number;
  }> = [];

  const childChargeEdges: Array<{
    edge: FullPropertyFlowEdge;
    unitCost: number;
  }> = [];

  categoryRates.forEach((category, index) => {
    positiveInteger(category.physicalCapacity, "physicalCapacity");
    positiveInteger(category.includedAdults, "includedAdults");
    positiveInteger(category.includedChildren, "includedChildren");
    positiveInteger(category.maxAdults, "maxAdults");
    positiveInteger(category.maxChildren, "maxChildren");
    positiveInteger(category.maxOccupancy, "maxOccupancy");
    positiveInteger(category.extraAdultMinor, "extraAdultMinor");
    positiveInteger(category.extraChildMinor, "extraChildMinor");

    if (
      category.includedAdults > category.maxAdults ||
      category.includedChildren > category.maxChildren ||
      category.includedAdults + category.includedChildren > category.maxOccupancy
    ) {
      throw new ValidationError(
        "Derived full-property category occupancy is internally inconsistent",
        {
          roomCategoryId: category.roomCategoryId
        }
      );
    }

    const adultCapacity =
      (category.maxAdults - category.includedAdults) * category.physicalCapacity;

    const childCapacity =
      (category.maxChildren - category.includedChildren) * category.physicalCapacity;

    const sharedCapacity =
      (category.maxOccupancy - category.includedAdults - category.includedChildren) *
      category.physicalCapacity;

    const categoryNode = firstCategoryNode + index;

    const adultEdge = addFullPropertyFlowEdge(
      graph,
      adultNode,
      categoryNode,
      adultCapacity,
      category.extraAdultMinor
    );

    const childEdge = addFullPropertyFlowEdge(
      graph,
      childNode,
      categoryNode,
      childCapacity,
      category.extraChildMinor
    );

    addFullPropertyFlowEdge(graph, categoryNode, sinkNode, sharedCapacity, 0);

    adultChargeEdges.push({
      edge: adultEdge,
      unitCost: category.extraAdultMinor
    });

    childChargeEdges.push({
      edge: childEdge,
      unitCost: category.extraChildMinor
    });
  });

  const requiredFlow = extraAdults + extraChildren;
  let completedFlow = 0;

  while (completedFlow < requiredFlow) {
    const distance = Array<number>(nodeCount).fill(Number.POSITIVE_INFINITY);

    const previousNode = Array<number>(nodeCount).fill(-1);
    const previousEdge = Array<number>(nodeCount).fill(-1);

    distance[sourceNode] = 0;

    for (let pass = 0; pass < nodeCount - 1; pass += 1) {
      let changedDistance = false;

      for (let from = 0; from < nodeCount; from += 1) {
        if (!Number.isFinite(distance[from]!)) continue;

        for (let edgeIndex = 0; edgeIndex < graph[from]!.length; edgeIndex += 1) {
          const edge = graph[from]![edgeIndex]!;

          if (edge.capacity <= 0) continue;

          const candidate = distance[from]! + edge.cost;

          if (candidate < distance[edge.to]!) {
            distance[edge.to] = candidate;
            previousNode[edge.to] = from;
            previousEdge[edge.to] = edgeIndex;
            changedDistance = true;
          }
        }
      }

      if (!changedDistance) break;
    }

    if (!Number.isFinite(distance[sinkNode]!)) {
      throw new ConflictError(
        "Full-property extra guests cannot be allocated within the configured room-category capacities",
        {
          extraAdults,
          extraChildren
        }
      );
    }

    let pathCapacity = requiredFlow - completedFlow;
    let cursor = sinkNode;

    while (cursor !== sourceNode) {
      const from = previousNode[cursor]!;
      const edgeIndex = previousEdge[cursor]!;

      if (from < 0 || edgeIndex < 0) {
        throw new ConflictError("Full-property extra-guest allocation path is incomplete");
      }

      const edge = graph[from]![edgeIndex]!;
      pathCapacity = Math.min(pathCapacity, edge.capacity);
      cursor = from;
    }

    cursor = sinkNode;

    while (cursor !== sourceNode) {
      const from = previousNode[cursor]!;
      const edgeIndex = previousEdge[cursor]!;
      const edge = graph[from]![edgeIndex]!;
      const reverse = graph[edge.to]![edge.reverseIndex]!;

      edge.capacity -= pathCapacity;
      reverse.capacity += pathCapacity;
      cursor = from;
    }

    completedFlow += pathCapacity;
  }

  const extraAdultMinor = adultChargeEdges.reduce(
    (sum, item) =>
      sum + Math.max(0, item.edge.originalCapacity - item.edge.capacity) * item.unitCost,
    0
  );

  const extraChildMinor = childChargeEdges.reduce(
    (sum, item) =>
      sum + Math.max(0, item.edge.originalCapacity - item.edge.capacity) * item.unitCost,
    0
  );

  return {
    extraAdultMinor,
    extraChildMinor,
    totalMinor: extraAdultMinor + extraChildMinor
  };
}
