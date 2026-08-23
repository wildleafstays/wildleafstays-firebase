export type AuditActorType = "USER" | "SYSTEM" | "PROVIDER";

export type AuditJsonObject = Record<string, unknown>;

export interface AuditEventSummaryView {
  id: string;
  propertyId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  source: string;
  requestId: string;
  correlationId: string;
  createdAt: string;
}

export interface AuditEventListView {
  organizationId: string;
  items: AuditEventSummaryView[];
  nextCursor: string | null;
}

export interface AuditEventDetailView {
  id: string;
  organizationId: string;
  propertyId: string | null;
  actorType: AuditActorType;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: AuditJsonObject | null;
  after: AuditJsonObject | null;
  metadata: AuditJsonObject;
  reason: string | null;
  source: string;
  requestId: string;
  correlationId: string;
  createdAt: string;
}
