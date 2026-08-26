import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type {
  CreateFloorInput,
  CreatePhysicalUnitInput,
  CreateRoomCategoryInput,
  CreateStructureInput
} from "../domain/property-setup.js";
import {
  PropertySetupRepository,
  type RoomCategoryMediaRecord
} from "../infrastructure/property-setup-repository.js";
import {
  presentFloor,
  presentPhysicalUnit,
  presentRoomCategory,
  presentStructure,
  type FloorView,
  type PhysicalUnitView,
  type RoomCategoryView,
  type StructureView
} from "./property-setup-presenter.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface RoomCategoryMediaView extends JsonObject {
  id: string;
  roomCategoryId: string;
  storageProvider: string;
  storageKey: string;
  mimeType: string | null;
  altText: string | null;
  caption: string | null;
  sortOrder: number;
  status: string;
}

function presentRoomCategoryMedia(row: RoomCategoryMediaRecord): RoomCategoryMediaView {
  return {
    id: row.id,
    roomCategoryId: row.room_category_id,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    altText: row.alt_text,
    caption: row.caption,
    sortOrder: row.sort_order,
    status: row.status
  };
}

export interface RoomCategoryAmenityView extends JsonObject {
  roomCategoryId: string;
  amenityCode: string;
}

export interface PropertyLayoutResult extends JsonObject {
  structures: StructureView[];
  floors: FloorView[];
  roomCategories: RoomCategoryView[];
  physicalUnits: PhysicalUnitView[];
  roomCategoryAmenities: RoomCategoryAmenityView[];
  roomCategoryMedia: RoomCategoryMediaView[];
}

export class PropertySetupService {
  constructor(
    private readonly repository = new PropertySetupRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async assertEditable(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<void> {
    const status = await this.repository.getPropertyStatus(db, organizationId, propertyId);
    if (!status) {
      throw new NotFoundError("Property not found");
    }
    if (status !== "DRAFT" && status !== "CHANGES_REQUIRED") {
      throw new ConflictError("Property setup cannot be edited in its current state", {
        propertyId,
        status
      });
    }
  }

  private assertManage(actor: ActorContext, organizationId: string, propertyId: string): void {
    this.authorization.assert(actor, Permissions.PROPERTY_MANAGE, {
      kind: "property",
      organizationId,
      propertyId
    });
  }

  async assertRoomCategoryEditable(
    db: DbExecutor,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string
  ): Promise<void> {
    this.assertManage(actor, organizationId, propertyId);
    await this.assertEditable(db, organizationId, propertyId);

    const category = await this.repository.findRoomCategory(
      db,
      organizationId,
      propertyId,
      roomCategoryId
    );

    if (!category) {
      throw new NotFoundError("Room category not found");
    }
  }

  async createStructure(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateStructureInput,
    request: RequestMetadata
  ): Promise<{ structure: StructureView }> {
    this.assertManage(actor, input.organizationId, input.propertyId);
    await this.assertEditable(trx, input.organizationId, input.propertyId);

    const structure = await this.repository.createStructure(trx, input);
    const view = presentStructure(structure);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.structure.created",
      entityType: "property_structure",
      entityId: structure.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.structure.created.v1",
      payload: {
        propertyId: input.propertyId,
        structureId: structure.id
      }
    });

    return { structure: view };
  }

  async createFloor(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateFloorInput,
    request: RequestMetadata
  ): Promise<{ floor: FloorView }> {
    this.assertManage(actor, input.organizationId, input.propertyId);
    await this.assertEditable(trx, input.organizationId, input.propertyId);

    const structure = await this.repository.findStructure(
      trx,
      input.organizationId,
      input.propertyId,
      input.structureId
    );
    if (!structure) {
      throw new NotFoundError("Property structure not found");
    }

    const floor = await this.repository.createFloor(trx, input);
    const view = presentFloor(floor);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.floor.created",
      entityType: "property_floor",
      entityId: floor.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.floor.created.v1",
      payload: {
        propertyId: input.propertyId,
        structureId: input.structureId,
        floorId: floor.id
      }
    });

    return { floor: view };
  }

  async createRoomCategory(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateRoomCategoryInput,
    request: RequestMetadata
  ): Promise<{ roomCategory: RoomCategoryView }> {
    this.assertManage(actor, input.organizationId, input.propertyId);
    await this.assertEditable(trx, input.organizationId, input.propertyId);

    if (input.baseOccupancy > input.maxOccupancy) {
      throw new ValidationError("Base occupancy cannot exceed maximum occupancy");
    }
    if (input.maxAdults > input.maxOccupancy) {
      throw new ValidationError("Maximum adults cannot exceed maximum occupancy");
    }

    const roomCategory = await this.repository.createRoomCategory(trx, input);
    const view = presentRoomCategory(roomCategory);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.room_category.created",
      entityType: "room_category",
      entityId: roomCategory.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.room_category.created.v1",
      payload: {
        propertyId: input.propertyId,
        roomCategoryId: roomCategory.id
      }
    });

    return { roomCategory: view };
  }

  async createPhysicalUnit(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreatePhysicalUnitInput,
    request: RequestMetadata
  ): Promise<{ physicalUnit: PhysicalUnitView }> {
    this.assertManage(actor, input.organizationId, input.propertyId);
    await this.assertEditable(trx, input.organizationId, input.propertyId);

    if (input.floorId && !input.structureId) {
      throw new ValidationError("A floor cannot be assigned without a structure");
    }
    if (!input.hasView && input.viewLabel) {
      throw new ValidationError("View label requires hasView=true");
    }

    const category = await this.repository.findRoomCategory(
      trx,
      input.organizationId,
      input.propertyId,
      input.roomCategoryId
    );
    if (!category) {
      throw new NotFoundError("Room category not found");
    }

    if (input.structureId) {
      const structure = await this.repository.findStructure(
        trx,
        input.organizationId,
        input.propertyId,
        input.structureId
      );
      if (!structure) {
        throw new NotFoundError("Property structure not found");
      }
    }

    if (input.floorId && input.structureId) {
      const floor = await this.repository.findFloor(
        trx,
        input.organizationId,
        input.propertyId,
        input.structureId,
        input.floorId
      );
      if (!floor) {
        throw new NotFoundError("Property floor not found");
      }
    }

    const physicalUnit = await this.repository.createPhysicalUnit(trx, input);
    const view = presentPhysicalUnit(physicalUnit);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.physical_unit.created",
      entityType: "physical_unit",
      entityId: physicalUnit.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.physical_unit.created.v1",
      payload: {
        propertyId: input.propertyId,
        roomCategoryId: input.roomCategoryId,
        physicalUnitId: physicalUnit.id
      }
    });

    return { physicalUnit: view };
  }

  async addRoomCategoryMedia(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      roomCategoryId: string;
      storageProvider: string;
      storageKey: string;
      mimeType: string | null;
      altText: string | null;
      caption: string | null;
      sortOrder: number;
    },
    request: RequestMetadata
  ): Promise<{ media: RoomCategoryMediaView }> {
    await this.assertRoomCategoryEditable(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      input.roomCategoryId
    );

    const media = await this.repository.addRoomCategoryMedia(trx, actor.userId, input);

    const view = presentRoomCategoryMedia(media);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.room_category.media.added",
      entityType: "room_category_media",
      entityId: media.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "room_category",
      aggregateId: input.roomCategoryId,
      eventType: "property.room_category.media.added.v1",
      payload: {
        propertyId: input.propertyId,
        roomCategoryId: input.roomCategoryId,
        mediaId: media.id
      }
    });

    return { media: view };
  }

  async archiveRoomCategoryMedia(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string,
    mediaId: string,
    request: RequestMetadata
  ): Promise<{ media: RoomCategoryMediaView }> {
    await this.assertRoomCategoryEditable(trx, actor, organizationId, propertyId, roomCategoryId);

    const before = await this.repository.findRoomCategoryMedia(
      trx,
      organizationId,
      propertyId,
      roomCategoryId,
      mediaId
    );

    if (!before) {
      throw new NotFoundError("Room category image not found");
    }

    const archived = await this.repository.archiveRoomCategoryMedia(
      trx,
      organizationId,
      propertyId,
      roomCategoryId,
      mediaId
    );

    if (!archived) {
      throw new NotFoundError("Room category image not found");
    }

    const beforeView = presentRoomCategoryMedia(before);
    const afterView = presentRoomCategoryMedia(archived);

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.room_category.media.archived",
      entityType: "room_category_media",
      entityId: mediaId,
      before: beforeView,
      after: afterView,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "room_category",
      aggregateId: roomCategoryId,
      eventType: "property.room_category.media.archived.v1",
      payload: {
        propertyId,
        roomCategoryId,
        mediaId
      }
    });

    return { media: afterView };
  }

  async replaceRoomCategoryAmenities(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    roomCategoryId: string,
    amenityCodes: string[],
    request: RequestMetadata
  ): Promise<{ amenities: RoomCategoryAmenityView[] }> {
    this.assertManage(actor, organizationId, propertyId);
    await this.assertEditable(trx, organizationId, propertyId);

    const category = await this.repository.findRoomCategory(
      trx,
      organizationId,
      propertyId,
      roomCategoryId
    );

    if (!category) {
      throw new NotFoundError("Room category not found");
    }

    const normalized = amenityCodes.map((code) => code.trim().toUpperCase());

    const uniqueCodes = [...new Set(normalized)];

    if (uniqueCodes.length !== normalized.length) {
      throw new ValidationError("Room amenity codes must be unique");
    }

    const activeCodes = await this.repository.activeRoomAmenityCodes(trx, uniqueCodes);

    const activeSet = new Set(activeCodes);
    const invalid = uniqueCodes.filter((code) => !activeSet.has(code));

    if (invalid.length) {
      throw new ValidationError("One or more room amenity codes are invalid", { invalid });
    }

    const beforeRows = await this.repository.listRoomCategoryAmenities(
      trx,
      organizationId,
      propertyId
    );

    const before = beforeRows
      .filter((row) => row.room_category_id === roomCategoryId)
      .map((row) => ({
        roomCategoryId: row.room_category_id,
        amenityCode: row.amenity_code
      }));

    await this.repository.replaceRoomCategoryAmenities(
      trx,
      organizationId,
      propertyId,
      roomCategoryId,
      uniqueCodes
    );

    const afterRows = await this.repository.listRoomCategoryAmenities(
      trx,
      organizationId,
      propertyId
    );

    const after = afterRows
      .filter((row) => row.room_category_id === roomCategoryId)
      .map((row) => ({
        roomCategoryId: row.room_category_id,
        amenityCode: row.amenity_code
      }));

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.room_category.amenities.replaced",
      entityType: "room_category",
      entityId: roomCategoryId,
      before: { amenities: before },
      after: { amenities: after },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "room_category",
      aggregateId: roomCategoryId,
      eventType: "property.room_category.amenities.replaced.v1",
      payload: {
        propertyId,
        roomCategoryId,
        amenityCodes: uniqueCodes
      }
    });

    return { amenities: after };
  }

  async getLayout(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyLayoutResult> {
    this.authorization.assert(actor, Permissions.PROPERTY_READ, {
      kind: "property",
      organizationId,
      propertyId
    });

    const propertyStatus = await this.repository.getPropertyStatus(db, organizationId, propertyId);

    if (!propertyStatus) {
      throw new NotFoundError("Property not found");
    }

    const [
      structures,
      floors,
      roomCategories,
      physicalUnits,
      roomCategoryAmenities,
      roomCategoryMedia
    ] = await Promise.all([
      this.repository.listStructures(db, organizationId, propertyId),
      this.repository.listFloors(db, organizationId, propertyId),
      this.repository.listRoomCategories(db, organizationId, propertyId),
      this.repository.listPhysicalUnits(db, organizationId, propertyId),
      this.repository.listRoomCategoryAmenities(db, organizationId, propertyId),
      this.repository.listRoomCategoryMedia(db, organizationId, propertyId)
    ]);

    return {
      structures: structures.map(presentStructure),
      floors: floors.map(presentFloor),
      roomCategories: roomCategories.map(presentRoomCategory),
      physicalUnits: physicalUnits.map(presentPhysicalUnit),
      roomCategoryAmenities: roomCategoryAmenities.map((row) => ({
        roomCategoryId: row.room_category_id,
        amenityCode: row.amenity_code
      })),
      roomCategoryMedia: roomCategoryMedia.map(presentRoomCategoryMedia)
    };
  }
}
