import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { SavePropertyProfileInput } from "../domain/property-profile.js";
import { PropertyRepository, type PropertyRecord } from "../infrastructure/property-repository.js";
import { presentProperty, type PropertyView } from "./property-presenter.js";

export interface SavePropertyProfileResult extends JsonObject {
  property: PropertyView;
}

function auditSnapshot(property: PropertyRecord): JsonObject {
  return {
    name: property.name,
    timezone: property.timezone,
    propertyType: property.property_type,
    saleMode: property.sale_mode,
    shortDescription: property.short_description,
    description: property.description,
    addressLine1: property.address_line_1,
    addressLine2: property.address_line_2,
    locality: property.locality,
    city: property.city,
    stateRegion: property.state_region,
    postalCode: property.postal_code,
    countryCode: property.country_code,
    latitude: property.latitude,
    longitude: property.longitude,
    contactPhone: property.contact_phone,
    contactEmail: property.contact_email,
    checkInTime: property.check_in_time,
    checkOutTime: property.check_out_time,
    status: property.status,
    version: property.version
  };
}

export class SavePropertyProfileService {
  constructor(
    private readonly repository = new PropertyRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async execute(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: SavePropertyProfileInput,
    request: RequestMetadata
  ): Promise<SavePropertyProfileResult> {
    this.authorization.assert(actor, Permissions.PROPERTY_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const before = await this.repository.findById(trx, input.organizationId, input.propertyId);
    if (!before) {
      throw new NotFoundError("Property not found");
    }

    if (before.status !== "DRAFT" && before.status !== "CHANGES_REQUIRED") {
      throw new ConflictError("Property profile cannot be edited in its current state", {
        propertyId: input.propertyId,
        status: before.status
      });
    }

    if (before.version !== input.expectedVersion) {
      throw new ConflictError("Property was changed by another request", {
        propertyId: input.propertyId,
        expectedVersion: input.expectedVersion,
        currentVersion: before.version
      });
    }

    const after = await this.repository.saveProfile(trx, input);
    if (!after) {
      throw new ConflictError("Property was changed while this request was being processed", {
        propertyId: input.propertyId,
        expectedVersion: input.expectedVersion
      });
    }

    const audit = new AuditService(trx);
    await audit.record({
      actor,
      organizationId: after.organization_id,
      propertyId: after.id,
      action: "property.profile.saved",
      entityType: "property",
      entityId: after.id,
      before: auditSnapshot(before),
      after: auditSnapshot(after),
      request
    });

    const outbox = new OutboxService(trx);
    await outbox.enqueue({
      aggregateType: "property",
      aggregateId: after.id,
      eventType: "property.profile.saved.v1",
      payload: {
        propertyId: after.id,
        organizationId: after.organization_id,
        version: after.version
      }
    });

    return { property: presentProperty(after) };
  }
}
