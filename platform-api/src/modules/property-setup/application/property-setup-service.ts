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
import { PropertySetupRepository } from "../infrastructure/property-setup-repository.js";
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

export interface PropertyLayoutResult extends JsonObject {
  structures: StructureView[];
  floors: FloorView[];
  roomCategories: RoomCategoryView[];
  physicalUnits: PhysicalUnitView[];
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

    const [structures, floors, roomCategories, physicalUnits] = await Promise.all([
      this.repository.listStructures(db, organizationId, propertyId),
      this.repository.listFloors(db, organizationId, propertyId),
      this.repository.listRoomCategories(db, organizationId, propertyId),
      this.repository.listPhysicalUnits(db, organizationId, propertyId)
    ]);

    return {
      structures: structures.map(presentStructure),
      floors: floors.map(presentFloor),
      roomCategories: roomCategories.map(presentRoomCategory),
      physicalUnits: physicalUnits.map(presentPhysicalUnit)
    };
  }
}
