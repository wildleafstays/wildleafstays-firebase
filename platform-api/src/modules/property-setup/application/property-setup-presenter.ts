import type { JsonObject } from "../../../infrastructure/database/types.js";
import type {
  FloorRecord,
  PhysicalUnitRecord,
  RoomCategoryRecord,
  StructureRecord
} from "../infrastructure/property-setup-repository.js";

export interface StructureView extends JsonObject {
  id: string;
  code: string | null;
  name: string;
  structureType: string;
  sortOrder: number;
  hasLift: boolean;
  wheelchairAccessible: boolean;
  status: string;
  version: number;
}

export interface FloorView extends JsonObject {
  id: string;
  structureId: string;
  code: string | null;
  name: string;
  floorNumber: number | null;
  sortOrder: number;
  liftAccessible: boolean;
  wheelchairAccessible: boolean;
  status: string;
  version: number;
}

export interface RoomCategoryView extends JsonObject {
  id: string;
  code: string;
  name: string;
  accommodationType: string;
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
  status: string;
  version: number;
}

export interface PhysicalUnitView extends JsonObject {
  id: string;
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
  smokingPolicy: string;
  internalNotes: string | null;
  sortOrder: number;
  status: string;
  version: number;
}

export function presentStructure(row: StructureRecord): StructureView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    structureType: row.structure_type,
    sortOrder: row.sort_order,
    hasLift: row.has_lift,
    wheelchairAccessible: row.wheelchair_accessible,
    status: row.status,
    version: row.version
  };
}

export function presentFloor(row: FloorRecord): FloorView {
  return {
    id: row.id,
    structureId: row.structure_id,
    code: row.code,
    name: row.name,
    floorNumber: row.floor_number,
    sortOrder: row.sort_order,
    liftAccessible: row.lift_accessible,
    wheelchairAccessible: row.wheelchair_accessible,
    status: row.status,
    version: row.version
  };
}

export function presentRoomCategory(row: RoomCategoryRecord): RoomCategoryView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    accommodationType: row.accommodation_type,
    description: row.description,
    baseOccupancy: row.base_occupancy,
    maxAdults: row.max_adults,
    maxChildren: row.max_children,
    maxOccupancy: row.max_occupancy,
    sizeSqm: row.size_sqm === null ? null : Number(row.size_sqm),
    bedConfiguration: row.bed_configuration,
    extraBedAllowed: row.extra_bed_allowed,
    defaultViewLabel: row.default_view_label,
    sortOrder: row.sort_order,
    status: row.status,
    version: row.version
  };
}

export function presentPhysicalUnit(row: PhysicalUnitRecord): PhysicalUnitView {
  return {
    id: row.id,
    roomCategoryId: row.room_category_id,
    structureId: row.structure_id,
    floorId: row.floor_id,
    unitCode: row.unit_code,
    displayName: row.display_name,
    hasView: row.has_view,
    viewLabel: row.view_label,
    wheelchairAccessible: row.wheelchair_accessible,
    stepFreeAccessible: row.step_free_accessible,
    liftAccessible: row.lift_accessible,
    smokingPolicy: row.smoking_policy,
    internalNotes: row.internal_notes,
    sortOrder: row.sort_order,
    status: row.status,
    version: row.version
  };
}
