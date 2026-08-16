import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import {
  OrganizationRepository,
  type CreateOrganizationInput
} from "../infrastructure/organization-repository.js";

export interface CreateOrganizationResult extends JsonObject {
  organizationId: string;
  membershipId: string;
  status: "DRAFT";
}

export class CreateOrganizationService {
  constructor(private readonly repository = new OrganizationRepository()) {}

  async execute(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: CreateOrganizationInput,
    request: RequestMetadata
  ): Promise<CreateOrganizationResult> {
    const created = await this.repository.createWithOwner(trx, input, actor.userId);

    const audit = new AuditService(trx);
    await audit.record({
      actor,
      actorRole: "OWNER",
      organizationId: created.organizationId,
      action: "organization.created",
      entityType: "organization",
      entityId: created.organizationId,
      before: null,
      after: {
        legalName: input.legalName,
        tradingName: input.tradingName,
        organizationType: input.organizationType,
        status: "DRAFT"
      },
      request
    });

    const outbox = new OutboxService(trx);
    await outbox.enqueue({
      aggregateType: "organization",
      aggregateId: created.organizationId,
      eventType: "organization.created.v1",
      payload: {
        organizationId: created.organizationId,
        ownerUserId: actor.userId
      }
    });

    return {
      organizationId: created.organizationId,
      membershipId: created.membershipId,
      status: "DRAFT"
    };
  }
}
