export const StructureTypes = {
  BUILDING: "BUILDING",
  WING: "WING",
  BLOCK: "BLOCK",
  TOWER: "TOWER",
  CLUSTER: "CLUSTER",
  OTHER: "OTHER"
} as const;

export type StructureType = (typeof StructureTypes)[keyof typeof StructureTypes];

export const AccommodationTypes = {
  ROOM: "ROOM",
  SUITE: "SUITE",
  COTTAGE: "COTTAGE",
  HUT: "HUT",
  VILLA: "VILLA",
  APARTMENT: "APARTMENT",
  DORM: "DORM",
  TENT: "TENT",
  OTHER: "OTHER"
} as const;

export type AccommodationType = (typeof AccommodationTypes)[keyof typeof AccommodationTypes];

export type SmokingPolicy = "NON_SMOKING" | "SMOKING";

export interface CreateStructureInput {
  organizationId: string;
  propertyId: string;
  code: string | null;
  name: string;
  structureType: StructureType;
  sortOrder: number;
  hasLift: boolean;
  wheelchairAccessible: boolean;
}

export interface CreateFloorInput {
  organizationId: string;
  propertyId: string;
  structureId: string;
  code: string | null;
  name: string;
  floorNumber: number | null;
  sortOrder: number;
  liftAccessible: boolean;
  wheelchairAccessible: boolean;
}

export interface CreateRoomCategoryInput {
  organizationId: string;
  propertyId: string;
  code: string;
  name: string;
  accommodationType: AccommodationType;
  description: string | null;
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  sizeSqm: number | null;
  bedConfiguration: string | null;
  extraBedAllowed: boolean;
  defaultViewLabel: string | null;
  sortOrder: number;
}

export interface CreatePhysicalUnitInput {
  organizationId: string;
  propertyId: string;
  roomCategoryId: string;
  structureId: string | null;
  floorId: string | null;
  unitCode: string;
  displayName: string | null;
  hasView: boolean;
  viewLabel: string | null;
  wheelchairAccessible: boolean;
  stepFreeAccessible: boolean;
  liftAccessible: boolean;
  smokingPolicy: SmokingPolicy;
  internalNotes: string | null;
  sortOrder: number;
}
