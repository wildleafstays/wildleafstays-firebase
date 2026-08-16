import { randomUUID } from "node:crypto";
import type { Kysely, Selectable, Transaction } from "kysely";
import type {
  Database,
  PhysicalUnitsTable,
  PropertyFloorsTable,
  PropertyStructuresTable,
  RoomCategoriesTable
} from "../../../infrastructure/database/types.js";
import type {
  CreateFloorInput,
  CreatePhysicalUnitInput,
  CreateRoomCategoryInput,
  CreateStructureInput
} from "../domain/property-setup.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type StructureRecord = Selectable<PropertyStructuresTable>;
export type FloorRecord = Selectable<PropertyFloorsTable>;
export type RoomCategoryRecord = Selectable<RoomCategoriesTable>;
export type PhysicalUnitRecord = Selectable<PhysicalUnitsTable>;

export class PropertySetupRepository {
  async getPropertyStatus(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<string | undefined> {
    const row = await db
      .selectFrom("properties")
      .select(["status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", propertyId)
      .executeTakeFirst();
    return row?.status;
  }

  async createStructure(db: DbExecutor, input: CreateStructureInput): Promise<StructureRecord> {
    return db
      .insertInto("property_structures")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        structure_type: input.structureType,
        sort_order: input.sortOrder,
        has_lift: input.hasLift,
        wheelchair_accessible: input.wheelchairAccessible,
        status: "ACTIVE"
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createFloor(db: DbExecutor, input: CreateFloorInput): Promise<FloorRecord> {
    return db
      .insertInto("property_floors")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        structure_id: input.structureId,
        code: input.code,
        name: input.name,
        floor_number: input.floorNumber,
        sort_order: input.sortOrder,
        lift_accessible: input.liftAccessible,
        wheelchair_accessible: input.wheelchairAccessible,
        status: "ACTIVE"
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createRoomCategory(
    db: DbExecutor,
    input: CreateRoomCategoryInput
  ): Promise<RoomCategoryRecord> {
    return db
      .insertInto("room_categories")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        code: input.code,
        name: input.name,
        accommodation_type: input.accommodationType,
        description: input.description,
        base_occupancy: input.baseOccupancy,
        max_adults: input.maxAdults,
        max_children: input.maxChildren,
        max_occupancy: input.maxOccupancy,
        size_sqm: input.sizeSqm === null ? null : input.sizeSqm.toFixed(2),
        bed_configuration: input.bedConfiguration,
        extra_bed_allowed: input.extraBedAllowed,
        default_view_label: input.defaultViewLabel,
        sort_order: input.sortOrder,
        status: "ACTIVE"
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createPhysicalUnit(
    db: DbExecutor,
    input: CreatePhysicalUnitInput
  ): Promise<PhysicalUnitRecord> {
    return db
      .insertInto("physical_units")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        room_category_id: input.roomCategoryId,
        structure_id: input.structureId,
        floor_id: input.floorId,
        unit_code: input.unitCode,
        display_name: input.displayName,
        has_view: input.hasView,
        view_label: input.viewLabel,
        wheelchair_accessible: input.wheelchairAccessible,
        step_free_accessible: input.stepFreeAccessible,
        lift_accessible: input.liftAccessible,
        smoking_policy: input.smokingPolicy,
        internal_notes: input.internalNotes,
        sort_order: input.sortOrder,
        status: "ACTIVE"
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findStructure(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    structureId: string
  ): Promise<StructureRecord | undefined> {
    return db
      .selectFrom("property_structures")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", structureId)
      .where("status", "<>", "RETIRED")
      .executeTakeFirst();
  }

  async findFloor(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    structureId: string,
    floorId: string
  ): Promise<FloorRecord | undefined> {
    return db
      .selectFrom("property_floors")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("structure_id", "=", structureId)
      .where("id", "=", floorId)
      .where("status", "<>", "RETIRED")
      .executeTakeFirst();
  }

  async findRoomCategory(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string
  ): Promise<RoomCategoryRecord | undefined> {
    return db
      .selectFrom("room_categories")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", roomCategoryId)
      .where("status", "<>", "RETIRED")
      .executeTakeFirst();
  }

  async listStructures(db: DbExecutor, organizationId: string, propertyId: string) {
    return db
      .selectFrom("property_structures")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "<>", "RETIRED")
      .orderBy("sort_order")
      .orderBy("name")
      .execute();
  }

  async listFloors(db: DbExecutor, organizationId: string, propertyId: string) {
    return db
      .selectFrom("property_floors")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "<>", "RETIRED")
      .orderBy("sort_order")
      .orderBy("name")
      .execute();
  }

  async listRoomCategories(db: DbExecutor, organizationId: string, propertyId: string) {
    return db
      .selectFrom("room_categories")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "<>", "RETIRED")
      .orderBy("sort_order")
      .orderBy("name")
      .execute();
  }

  async listPhysicalUnits(db: DbExecutor, organizationId: string, propertyId: string) {
    return db
      .selectFrom("physical_units")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "<>", "RETIRED")
      .orderBy("sort_order")
      .orderBy("unit_code")
      .execute();
  }
}
