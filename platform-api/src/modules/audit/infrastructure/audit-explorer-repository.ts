import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";

export interface AuditEventCursor {
  createdAt: Date;
  id: string;
}

export interface AuditEventListFilters {
  organizationId: string;
  propertyId: string | null;
  actorType: string | null;
  actorUserId: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  createdFrom: Date | null;
  createdBefore: Date | null;
  cursor: AuditEventCursor | null;
  limit: number;
}

export interface AuditEventListRecord {
  id: string;
  organization_id: string | null;
  property_id: string | null;
  actor_type: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  created_at: Date;
}

export interface AuditEventDetailRecord extends AuditEventListRecord {
  before_json: JsonObject | null;
  after_json: JsonObject | null;
  metadata_json: JsonObject;
}

export class AuditExplorerRepository {
  async list(db: Kysely<Database>, input: AuditEventListFilters): Promise<AuditEventListRecord[]> {
    let query = db
      .selectFrom("audit_events as audit")
      .select([
        "audit.id",
        "audit.organization_id",
        "audit.property_id",
        "audit.actor_type",
        "audit.actor_user_id",
        "audit.actor_role",
        "audit.action",
        "audit.entity_type",
        "audit.entity_id",
        "audit.reason",
        "audit.source",
        "audit.request_id",
        "audit.correlation_id",
        "audit.created_at"
      ])
      .where("audit.organization_id", "=", input.organizationId);

    if (input.propertyId) {
      query = query.where("audit.property_id", "=", input.propertyId);
    }

    if (input.actorType) {
      query = query.where("audit.actor_type", "=", input.actorType);
    }

    if (input.actorUserId) {
      query = query.where("audit.actor_user_id", "=", input.actorUserId);
    }

    if (input.action) {
      query = query.where("audit.action", "=", input.action);
    }

    if (input.entityType) {
      query = query.where("audit.entity_type", "=", input.entityType);
    }

    if (input.entityId) {
      query = query.where("audit.entity_id", "=", input.entityId);
    }

    if (input.createdFrom) {
      query = query.where("audit.created_at", ">=", input.createdFrom);
    }

    if (input.createdBefore) {
      query = query.where("audit.created_at", "<", input.createdBefore);
    }

    if (input.cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("audit.created_at", "<", input.cursor!.createdAt),
          eb.and([
            eb("audit.created_at", "=", input.cursor!.createdAt),
            eb("audit.id", "<", input.cursor!.id)
          ])
        ])
      );
    }

    return query
      .orderBy("audit.created_at", "desc")
      .orderBy("audit.id", "desc")
      .limit(input.limit)
      .execute();
  }

  async detail(
    db: Kysely<Database>,
    organizationId: string,
    auditEventId: string
  ): Promise<AuditEventDetailRecord | null> {
    const row = await db
      .selectFrom("audit_events as audit")
      .select([
        "audit.id",
        "audit.organization_id",
        "audit.property_id",
        "audit.actor_type",
        "audit.actor_user_id",
        "audit.actor_role",
        "audit.action",
        "audit.entity_type",
        "audit.entity_id",
        "audit.before_json",
        "audit.after_json",
        "audit.metadata_json",
        "audit.reason",
        "audit.source",
        "audit.request_id",
        "audit.correlation_id",
        "audit.created_at"
      ])
      .where("audit.organization_id", "=", organizationId)
      .where("audit.id", "=", auditEventId)
      .executeTakeFirst();

    return row ?? null;
  }
}
