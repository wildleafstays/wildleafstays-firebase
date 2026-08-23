import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../infrastructure/database/types.js";
import type { ActorContext } from "../../modules/access/domain/actor-context.js";
import type { RequestMetadata } from "../http/request-metadata.js";

export interface AuditInput {
  actor: ActorContext | null;
  actorType?: "USER" | "SYSTEM" | "PROVIDER";
  actorRole?: string | null;
  organizationId?: string | null;
  propertyId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: JsonObject | null;
  after?: JsonObject | null;
  metadata?: JsonObject;
  reason?: string | null;
  request: RequestMetadata;
}

type DbExecutor = Kysely<Database> | Transaction<Database>;

export class AuditService {
  constructor(private readonly db: DbExecutor) {}

  async record(input: AuditInput): Promise<string> {
    const id = randomUUID();
    await this.db
      .insertInto("audit_events")
      .values({
        id,
        actor_type: input.actorType ?? (input.actor ? "USER" : "SYSTEM"),
        actor_user_id: input.actor?.userId ?? null,
        actor_role: input.actorRole ?? null,
        organization_id: input.organizationId ?? null,
        property_id: input.propertyId ?? null,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        before_json: input.before ?? null,
        after_json: input.after ?? null,
        metadata_json: input.metadata ?? {},
        reason: input.reason ?? null,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId,
        ip_address: input.request.ipAddress,
        user_agent: input.request.userAgent
      })
      .executeTakeFirst();
    return id;
  }
}
