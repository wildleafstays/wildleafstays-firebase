import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type {
  AuditActorType,
  AuditEventDetailView,
  AuditEventListView,
  AuditEventSummaryView
} from "../domain/audit-explorer.js";
import {
  AuditExplorerRepository,
  type AuditEventCursor,
  type AuditEventDetailRecord,
  type AuditEventListRecord
} from "../infrastructure/audit-explorer-repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const ACTOR_TYPES = new Set<AuditActorType>(["USER", "SYSTEM", "PROVIDER"]);

export interface ListAuditEventsInput {
  organizationId: string;
  propertyId?: string;
  actorType?: string;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  createdFrom?: string;
  createdBefore?: string;
  limit?: number;
  cursor?: string;
}

function uuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return value;
}

function optionalExact(value: string | undefined, field: string): string | null {
  if (value === undefined) return null;
  if (value.trim().length === 0) {
    throw new ValidationError(`${field} must not be empty`);
  }
  return value;
}

function timestamp(value: string | undefined, field: string): Date | null {
  if (value === undefined) return null;

  if (!RFC3339_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be an RFC3339 timestamp`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`${field} must be an RFC3339 timestamp`);
  }

  return parsed;
}

function decodeCursor(value: string | undefined): AuditEventCursor | null {
  if (!value) return null;

  if (value.length > 500 || !CURSOR_PATTERN.test(value)) {
    throw new ValidationError("Invalid audit cursor");
  }

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };

    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid cursor shape");
    }

    if (!UUID_PATTERN.test(decoded.id)) {
      throw new Error("invalid cursor id");
    }

    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== decoded.createdAt) {
      throw new Error("invalid cursor timestamp");
    }

    return {
      createdAt,
      id: decoded.id
    };
  } catch {
    throw new ValidationError("Invalid audit cursor");
  }
}

function encodeCursor(row: AuditEventListRecord): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: row.created_at.toISOString(),
      id: row.id
    }),
    "utf8"
  ).toString("base64url");
}

function actorType(value: string | undefined): AuditActorType | null {
  if (value === undefined) return null;

  if (!ACTOR_TYPES.has(value as AuditActorType)) {
    throw new ValidationError("Invalid audit actorType");
  }

  return value as AuditActorType;
}

function actorTypeFromRecord(value: string): AuditActorType {
  if (!ACTOR_TYPES.has(value as AuditActorType)) {
    throw new Error(`Unexpected audit actor type: ${value}`);
  }

  return value as AuditActorType;
}

function summary(row: AuditEventListRecord): AuditEventSummaryView {
  return {
    id: row.id,
    propertyId: row.property_id,
    actorType: actorTypeFromRecord(row.actor_type),
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    source: row.source,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString()
  };
}

function detail(row: AuditEventDetailRecord): AuditEventDetailView {
  if (!row.organization_id) {
    throw new Error("Organization-scoped audit event is missing organization_id");
  }

  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    actorType: actorTypeFromRecord(row.actor_type),
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: row.before_json,
    after: row.after_json,
    metadata: row.metadata_json,
    reason: row.reason,
    source: row.source,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString()
  };
}

export class AuditExplorerService {
  constructor(
    private readonly repository = new AuditExplorerRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async list(
    db: Kysely<Database>,
    actor: ActorContext,
    input: ListAuditEventsInput
  ): Promise<AuditEventListView> {
    const organizationId = uuid(input.organizationId, "organizationId");

    this.authorization.assert(actor, Permissions.AUDIT_READ, {
      kind: "organization",
      organizationId
    });

    const propertyId = input.propertyId === undefined ? null : uuid(input.propertyId, "propertyId");

    const actorUserId =
      input.actorUserId === undefined ? null : uuid(input.actorUserId, "actorUserId");

    const createdFrom = timestamp(input.createdFrom, "createdFrom");
    const createdBefore = timestamp(input.createdBefore, "createdBefore");

    if (createdFrom && createdBefore && createdFrom.getTime() >= createdBefore.getTime()) {
      throw new ValidationError("createdFrom must be earlier than createdBefore");
    }

    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError("limit must be between 1 and 100");
    }

    const rows = await this.repository.list(db, {
      organizationId,
      propertyId,
      actorType: actorType(input.actorType),
      actorUserId,
      action: optionalExact(input.action, "action"),
      entityType: optionalExact(input.entityType, "entityType"),
      entityId: optionalExact(input.entityId, "entityId"),
      createdFrom,
      createdBefore,
      cursor: decodeCursor(input.cursor),
      limit: limit + 1
    });

    const page = rows.slice(0, limit);

    return {
      organizationId,
      items: page.map(summary),
      nextCursor: rows.length > limit && page.length ? encodeCursor(page[page.length - 1]!) : null
    };
  }

  async get(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationIdInput: string,
    auditEventIdInput: string
  ): Promise<AuditEventDetailView> {
    const organizationId = uuid(organizationIdInput, "organizationId");
    const auditEventId = uuid(auditEventIdInput, "auditEventId");

    this.authorization.assert(actor, Permissions.AUDIT_READ, {
      kind: "organization",
      organizationId
    });

    const row = await this.repository.detail(db, organizationId, auditEventId);

    if (!row) {
      throw new NotFoundError("Audit event not found");
    }

    return detail(row);
  }
}
