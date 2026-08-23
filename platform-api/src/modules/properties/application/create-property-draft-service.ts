import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { CreatePropertyDraftInput } from "../domain/property-profile.js";
import { PropertyRepository } from "../infrastructure/property-repository.js";
import { presentProperty, type PropertyView } from "./property-presenter.js";

export interface CreatePropertyDraftResult extends JsonObject {
  property: PropertyView;
}

export class CreatePropertyDraftService {
  constructor(
    private readonly repository = new PropertyRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async execute(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreatePropertyDraftInput,
    request: RequestMetadata
  ): Promise<CreatePropertyDraftResult> {
    this.authorization.assert(actor, Permissions.PROPERTY_MANAGE, {
      kind: "organization",
      organizationId: input.organizationId
    });

    const property = await this.repository.createDraft(trx, input);

    const audit = new AuditService(trx);
    await audit.record({
      actor,
      organizationId: property.organization_id,
      propertyId: property.id,
      action: "property.created",
      entityType: "property",
      entityId: property.id,
      before: null,
      after: {
        name: property.name,
        status: property.status,
        timezone: property.timezone,
        version: property.version
      },
      request
    });

    const outbox = new OutboxService(trx);
    await outbox.enqueue({
      aggregateType: "property",
      aggregateId: property.id,
      eventType: "property.created.v1",
      payload: {
        propertyId: property.id,
        organizationId: property.organization_id,
        status: property.status
      }
    });

    return { property: presentProperty(property) };
  }
}
