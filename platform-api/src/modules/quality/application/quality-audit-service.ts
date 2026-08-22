import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  QUALITY_CHECK_TYPES,
  QUALITY_RESULT_STATUSES,
  QUALITY_TRIGGER_TYPES,
  type QualityAssessmentDetailView,
  type QualityAssessmentOutcome,
  type QualityAssessmentResultView,
  type QualityAssessmentStatus,
  type QualityAssessmentSummaryView,
  type QualityCheckType,
  type QualityResultStatus,
  type QualityTemplateItemView,
  type QualityTemplateStatus,
  type QualityTemplateVersionStatus,
  type QualityTemplateVersionView,
  type QualityTemplateView,
  type QualityTriggerType
} from "../domain/quality-audit.js";
import {
  QualityAuditRepository,
  type QualityAssessmentRecord,
  type QualityAssessmentResultRecord,
  type QualityPropertyRecord,
  type QualityTemplateItemRecord,
  type QualityTemplateRecord,
  type QualityTemplateVersionRecord
} from "../infrastructure/quality-audit-repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEMPLATE_CODE_PATTERN = /^[A-Z0-9_-]{2,50}$/;
const ITEM_CODE_PATTERN = /^[A-Z0-9_-]{2,60}$/;

const CHECK_TYPES = new Set<string>(QUALITY_CHECK_TYPES);
const TRIGGER_TYPES = new Set<string>(QUALITY_TRIGGER_TYPES);
const RESULT_STATUSES = new Set<string>(QUALITY_RESULT_STATUSES);

export interface CreateQualityTemplateInput {
  code: string;
  name: string;
  request: RequestMetadata;
}

export interface CreateQualityTemplateVersionInput {
  templateId: string;
  title: string;
  notes?: string | null;
  request: RequestMetadata;
}

export interface QualityTemplateItemInput {
  code: string;
  title: string;
  description?: string | null;
  category: string;
  checkType: string;
  maxScore?: number | null;
  sortOrder?: number;
}

export interface ReplaceQualityTemplateItemsInput {
  templateId: string;
  versionId: string;
  items: QualityTemplateItemInput[];
  request: RequestMetadata;
}

export interface PublishQualityTemplateVersionInput {
  templateId: string;
  versionId: string;
  request: RequestMetadata;
}

export interface CreateQualityAssessmentInput {
  propertyId: string;
  templateVersionId: string;
  triggerType: string;
  triggerReference?: string | null;
  assignedAuditorUserId?: string | null;
  request: RequestMetadata;
}

export interface RecordQualityAssessmentResultInput {
  templateItemId: string;
  resultStatus: string;
  score?: number | null;
  notes?: string | null;
}

export interface RecordQualityAssessmentResultsInput {
  propertyId: string;
  assessmentId: string;
  results: RecordQualityAssessmentResultInput[];
  request: RequestMetadata;
}

export interface QualityAssessmentCommandInput {
  propertyId: string;
  assessmentId: string;
  request: RequestMetadata;
}

function uuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError(`${field} must be a valid UUID`);
  }
  return value;
}

function requiredText(value: string, field: string, minimum: number, maximum: number): string {
  const normalized = value.trim();

  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ValidationError(`${field} must contain between ${minimum} and ${maximum} characters`);
  }

  return normalized;
}

function optionalText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new ValidationError(`${field} must not be empty when supplied`);
  }

  return normalized;
}

function templateCode(value: string): string {
  const normalized = value.trim();

  if (!TEMPLATE_CODE_PATTERN.test(normalized)) {
    throw new ValidationError(
      "code must contain 2-50 uppercase letters, digits, underscores or hyphens"
    );
  }

  return normalized;
}

function itemCode(value: string): string {
  const normalized = value.trim();

  if (!ITEM_CODE_PATTERN.test(normalized)) {
    throw new ValidationError(
      "item code must contain 2-60 uppercase letters, digits, underscores or hyphens"
    );
  }

  return normalized;
}

function checkType(value: string): QualityCheckType {
  if (!CHECK_TYPES.has(value)) {
    throw new ValidationError("Invalid quality checkType");
  }

  return value as QualityCheckType;
}

function triggerType(value: string): QualityTriggerType {
  if (!TRIGGER_TYPES.has(value)) {
    throw new ValidationError("Invalid quality triggerType");
  }

  return value as QualityTriggerType;
}

function resultStatus(value: string): QualityResultStatus {
  if (!RESULT_STATUSES.has(value)) {
    throw new ValidationError("Invalid quality resultStatus");
  }

  return value as QualityResultStatus;
}

function nullableUuid(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  return uuid(value, field);
}

function templateStatus(value: string): QualityTemplateStatus {
  if (value !== "ACTIVE" && value !== "INACTIVE") {
    throw new Error(`Unexpected quality template status: ${value}`);
  }
  return value;
}

function versionStatus(value: string): QualityTemplateVersionStatus {
  if (value !== "DRAFT" && value !== "PUBLISHED" && value !== "RETIRED") {
    throw new Error(`Unexpected quality template version status: ${value}`);
  }
  return value;
}

function assessmentStatus(value: string): QualityAssessmentStatus {
  if (value !== "DRAFT" && value !== "IN_PROGRESS" && value !== "COMPLETED") {
    throw new Error(`Unexpected quality assessment status: ${value}`);
  }
  return value;
}

function assessmentOutcome(value: string | null): QualityAssessmentOutcome | null {
  if (value === null) return null;

  if (value !== "PASS" && value !== "FAIL") {
    throw new Error(`Unexpected quality assessment outcome: ${value}`);
  }

  return value;
}

function triggerFromRecord(value: string): QualityTriggerType {
  if (!TRIGGER_TYPES.has(value)) {
    throw new Error(`Unexpected quality trigger type: ${value}`);
  }

  return value as QualityTriggerType;
}

function checkTypeFromRecord(value: string): QualityCheckType {
  if (!CHECK_TYPES.has(value)) {
    throw new Error(`Unexpected quality check type: ${value}`);
  }

  return value as QualityCheckType;
}

function resultStatusFromRecord(value: string): QualityResultStatus {
  if (!RESULT_STATUSES.has(value)) {
    throw new Error(`Unexpected quality result status: ${value}`);
  }

  return value as QualityResultStatus;
}

function templateView(row: QualityTemplateRecord): QualityTemplateView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: templateStatus(row.status),
    currentVersion: row.current_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function versionView(row: QualityTemplateVersionRecord): QualityTemplateVersionView {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    status: versionStatus(row.status),
    title: row.title,
    notes: row.notes,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function itemView(row: QualityTemplateItemRecord): QualityTemplateItemView {
  return {
    id: row.id,
    templateVersionId: row.template_version_id,
    code: row.code,
    title: row.title,
    description: row.description,
    category: row.category,
    checkType: checkTypeFromRecord(row.check_type),
    maxScore: row.max_score,
    sortOrder: row.sort_order
  };
}

function assessmentView(row: QualityAssessmentRecord): QualityAssessmentSummaryView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    templateVersionId: row.template_version_id,
    triggerType: triggerFromRecord(row.trigger_type),
    triggerReference: row.trigger_reference,
    status: assessmentStatus(row.status),
    assignedAuditorUserId: row.assigned_auditor_user_id,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    mandatoryFailureCount: row.mandatory_failure_count,
    scoreBasisPoints: row.score_basis_points,
    outcome: assessmentOutcome(row.outcome),
    requiresLifecycleReview: row.requires_lifecycle_review,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function resultView(row: QualityAssessmentResultRecord): QualityAssessmentResultView {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    templateItemId: row.template_item_id,
    resultStatus: resultStatusFromRecord(row.result_status),
    score: row.score,
    notes: row.notes,
    recordedByUserId: row.recorded_by_user_id,
    recordedAt: row.recorded_at.toISOString()
  };
}

function templateSnapshot(row: QualityTemplateRecord): JsonObject {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    currentVersion: row.current_version
  };
}

function versionSnapshot(row: QualityTemplateVersionRecord): JsonObject {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    status: row.status,
    title: row.title,
    notes: row.notes,
    publishedAt: row.published_at?.toISOString() ?? null
  };
}

function itemSnapshot(row: QualityTemplateItemRecord): JsonObject {
  return {
    id: row.id,
    templateVersionId: row.template_version_id,
    code: row.code,
    title: row.title,
    description: row.description,
    category: row.category,
    checkType: row.check_type,
    maxScore: row.max_score,
    sortOrder: row.sort_order
  };
}

function assessmentSnapshot(row: QualityAssessmentRecord): JsonObject {
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    templateVersionId: row.template_version_id,
    triggerType: row.trigger_type,
    triggerReference: row.trigger_reference,
    status: row.status,
    assignedAuditorUserId: row.assigned_auditor_user_id,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    mandatoryFailureCount: row.mandatory_failure_count,
    scoreBasisPoints: row.score_basis_points,
    outcome: row.outcome,
    requiresLifecycleReview: row.requires_lifecycle_review
  };
}

function resultSnapshot(row: QualityAssessmentResultRecord): JsonObject {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    templateItemId: row.template_item_id,
    resultStatus: row.result_status,
    score: row.score,
    notes: row.notes,
    recordedByUserId: row.recorded_by_user_id,
    recordedAt: row.recorded_at.toISOString()
  };
}

function itemCollectionSnapshot(rows: QualityTemplateItemRecord[]): JsonObject {
  return {
    items: rows.map(itemSnapshot)
  };
}

function resultCollectionSnapshot(rows: QualityAssessmentResultRecord[]): JsonObject {
  return {
    results: rows.map(resultSnapshot)
  };
}

function assertManage(authorization: AuthorizationService, actor: ActorContext): void {
  authorization.assert(actor, Permissions.QUALITY_MANAGE, { kind: "platform" });
}

function validateTemplateItem(input: QualityTemplateItemInput): {
  code: string;
  title: string;
  description: string | null;
  category: string;
  checkType: QualityCheckType;
  maxScore: number | null;
  sortOrder: number;
} {
  const normalizedCheckType = checkType(input.checkType);
  const maxScore = input.maxScore ?? null;
  const sortOrder = input.sortOrder ?? 0;

  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new ValidationError("sortOrder must be a non-negative integer");
  }

  if (normalizedCheckType === "SCORED_QUALITY_ITEM") {
    if (maxScore === null || !Number.isInteger(maxScore) || maxScore <= 0) {
      throw new ValidationError("SCORED_QUALITY_ITEM requires a positive integer maxScore");
    }
  } else if (maxScore !== null) {
    throw new ValidationError("maxScore is only allowed for SCORED_QUALITY_ITEM");
  }

  return {
    code: itemCode(input.code),
    title: requiredText(input.title, "item title", 2, 200),
    description: optionalText(input.description, "item description"),
    category: requiredText(input.category, "item category", 1, 100),
    checkType: normalizedCheckType,
    maxScore,
    sortOrder
  };
}

function validateResultForItem(
  input: RecordQualityAssessmentResultInput,
  item: QualityTemplateItemRecord
): {
  templateItemId: string;
  resultStatus: QualityResultStatus;
  score: number | null;
  notes: string | null;
} {
  const normalizedStatus = resultStatus(input.resultStatus);
  const normalizedCheckType = checkTypeFromRecord(item.check_type);
  const score = input.score ?? null;
  const notes = optionalText(input.notes, "result notes");

  if (normalizedCheckType === "MANDATORY_PASS") {
    if (normalizedStatus !== "PASS" && normalizedStatus !== "FAIL") {
      throw new ValidationError(`Mandatory item ${item.code} requires PASS or FAIL`);
    }

    if (score !== null) {
      throw new ValidationError(`Mandatory item ${item.code} cannot contain a score`);
    }
  }

  if (normalizedCheckType === "SCORED_QUALITY_ITEM") {
    if (normalizedStatus === "NOT_APPLICABLE") {
      throw new ValidationError(`Scored item ${item.code} cannot be NOT_APPLICABLE`);
    }

    if (
      score === null ||
      !Number.isInteger(score) ||
      score < 0 ||
      item.max_score === null ||
      score > item.max_score
    ) {
      throw new ValidationError(
        `Scored item ${item.code} requires an integer score between 0 and ${item.max_score ?? 0}`
      );
    }
  }

  if (
    normalizedCheckType === "INFORMATIONAL_DISCLOSURE" ||
    normalizedCheckType === "IMPROVEMENT_RECOMMENDATION"
  ) {
    if (normalizedStatus !== "OBSERVED" && normalizedStatus !== "NOT_APPLICABLE") {
      throw new ValidationError(
        `${normalizedCheckType} item ${item.code} requires OBSERVED or NOT_APPLICABLE`
      );
    }

    if (score !== null) {
      throw new ValidationError(`${normalizedCheckType} item ${item.code} cannot contain a score`);
    }
  }

  return {
    templateItemId: uuid(input.templateItemId, "templateItemId"),
    resultStatus: normalizedStatus,
    score,
    notes
  };
}

export class QualityAuditService {
  constructor(
    private readonly repository = new QualityAuditRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async createTemplate(
    db: Kysely<Database>,
    actor: ActorContext,
    input: CreateQualityTemplateInput
  ): Promise<QualityTemplateView> {
    assertManage(this.authorization, actor);

    const code = templateCode(input.code);
    const name = requiredText(input.name, "name", 2, 160);

    return db.transaction().execute(async (trx) => {
      const existing = await this.repository.findTemplateByCode(trx, code);

      if (existing) {
        throw new ConflictError("Quality template code already exists", { code });
      }

      const created = await this.repository.insertTemplate(trx, {
        id: randomUUID(),
        code,
        name,
        created_by_user_id: actor.userId,
        updated_by_user_id: actor.userId
      });

      await new AuditService(trx).record({
        actor,
        action: "QUALITY_TEMPLATE_CREATED",
        entityType: "quality_standard_template",
        entityId: created.id,
        after: templateSnapshot(created),
        request: input.request
      });

      return templateView(created);
    });
  }

  async createTemplateVersion(
    db: Kysely<Database>,
    actor: ActorContext,
    input: CreateQualityTemplateVersionInput
  ): Promise<QualityTemplateVersionView> {
    assertManage(this.authorization, actor);

    const templateId = uuid(input.templateId, "templateId");
    const title = requiredText(input.title, "title", 2, 200);
    const notes = optionalText(input.notes, "notes");

    return db.transaction().execute(async (trx) => {
      const template = await this.repository.findTemplateForUpdate(trx, templateId);

      if (!template) {
        throw new NotFoundError("Quality template not found");
      }

      if (template.status !== "ACTIVE") {
        throw new ConflictError("Inactive quality template cannot receive a new version");
      }

      const versionNumber = template.current_version + 1;

      const created = await this.repository.insertTemplateVersion(trx, {
        id: randomUUID(),
        template_id: template.id,
        version_number: versionNumber,
        title,
        notes,
        created_by_user_id: actor.userId
      });

      await this.repository.updateTemplateCurrentVersion(
        trx,
        template.id,
        versionNumber,
        actor.userId
      );

      await new AuditService(trx).record({
        actor,
        action: "QUALITY_TEMPLATE_VERSION_CREATED",
        entityType: "quality_standard_template_version",
        entityId: created.id,
        after: versionSnapshot(created),
        request: input.request
      });

      return versionView(created);
    });
  }

  async replaceTemplateItems(
    db: Kysely<Database>,
    actor: ActorContext,
    input: ReplaceQualityTemplateItemsInput
  ): Promise<QualityTemplateItemView[]> {
    assertManage(this.authorization, actor);

    const templateId = uuid(input.templateId, "templateId");
    const versionId = uuid(input.versionId, "versionId");
    const normalized = input.items.map(validateTemplateItem);

    const codes = new Set<string>();

    for (const item of normalized) {
      if (codes.has(item.code)) {
        throw new ValidationError(`Duplicate quality item code: ${item.code}`);
      }
      codes.add(item.code);
    }

    return db.transaction().execute(async (trx) => {
      const version = await this.repository.findTemplateVersionForUpdate(trx, versionId);

      if (!version || version.template_id !== templateId) {
        throw new NotFoundError("Quality template version not found");
      }

      if (version.status !== "DRAFT") {
        throw new ConflictError("Published quality template items are immutable");
      }

      const before = await this.repository.listTemplateItems(trx, version.id);

      const after = await this.repository.replaceTemplateItems(
        trx,
        version.id,
        normalized.map((item) => ({
          id: randomUUID(),
          template_version_id: version.id,
          code: item.code,
          title: item.title,
          description: item.description,
          category: item.category,
          check_type: item.checkType,
          max_score: item.maxScore,
          sort_order: item.sortOrder
        }))
      );

      await new AuditService(trx).record({
        actor,
        action: "QUALITY_TEMPLATE_ITEMS_REPLACED",
        entityType: "quality_standard_template_version",
        entityId: version.id,
        before: itemCollectionSnapshot(before),
        after: itemCollectionSnapshot(after),
        request: input.request
      });

      return after.map(itemView);
    });
  }

  async publishTemplateVersion(
    db: Kysely<Database>,
    actor: ActorContext,
    input: PublishQualityTemplateVersionInput
  ): Promise<QualityTemplateVersionView> {
    assertManage(this.authorization, actor);

    const templateId = uuid(input.templateId, "templateId");
    const versionId = uuid(input.versionId, "versionId");

    return db.transaction().execute(async (trx) => {
      const version = await this.repository.findTemplateVersionForUpdate(trx, versionId);

      if (!version || version.template_id !== templateId) {
        throw new NotFoundError("Quality template version not found");
      }

      if (version.status !== "DRAFT") {
        throw new ConflictError("Quality template version is already immutable");
      }

      const items = await this.repository.listTemplateItems(trx, version.id);

      if (items.length === 0) {
        throw new ValidationError(
          "Quality template version must contain at least one item before publication"
        );
      }

      const published = await this.repository.publishTemplateVersion(
        trx,
        version.id,
        actor.userId,
        new Date()
      );

      if (!published) {
        throw new ConflictError("Quality template version could not be published");
      }

      await new AuditService(trx).record({
        actor,
        action: "QUALITY_TEMPLATE_VERSION_PUBLISHED",
        entityType: "quality_standard_template_version",
        entityId: version.id,
        before: versionSnapshot(version),
        after: versionSnapshot(published),
        request: input.request
      });

      return versionView(published);
    });
  }

  async createAssessment(
    db: Kysely<Database>,
    actor: ActorContext,
    input: CreateQualityAssessmentInput
  ): Promise<QualityAssessmentSummaryView> {
    assertManage(this.authorization, actor);

    const propertyId = uuid(input.propertyId, "propertyId");
    const templateVersionId = uuid(input.templateVersionId, "templateVersionId");
    const normalizedTriggerType = triggerType(input.triggerType);
    const triggerReference = optionalText(input.triggerReference, "triggerReference");
    const assignedAuditorUserId = nullableUuid(
      input.assignedAuditorUserId,
      "assignedAuditorUserId"
    );

    return db.transaction().execute(async (trx) => {
      const property = await this.requirePlatformProperty(trx, propertyId);

      const version = await this.repository.findTemplateVersion(trx, templateVersionId);

      if (!version) {
        throw new NotFoundError("Quality template version not found");
      }

      if (version.status !== "PUBLISHED") {
        throw new ConflictError("Quality assessment must bind to a published template version");
      }

      const created = await this.repository.insertAssessment(trx, {
        id: randomUUID(),
        organization_id: property.organization_id,
        property_id: property.id,
        template_version_id: version.id,
        trigger_type: normalizedTriggerType,
        trigger_reference: triggerReference,
        assigned_auditor_user_id: assignedAuditorUserId,
        created_by_user_id: actor.userId
      });

      await new AuditService(trx).record({
        actor,
        organizationId: property.organization_id,
        propertyId: property.id,
        action: "QUALITY_ASSESSMENT_CREATED",
        entityType: "quality_assessment",
        entityId: created.id,
        after: assessmentSnapshot(created),
        request: input.request
      });

      return assessmentView(created);
    });
  }

  async listPlatformAssessments(
    db: Kysely<Database>,
    actor: ActorContext,
    propertyIdInput: string
  ): Promise<QualityAssessmentSummaryView[]> {
    const property = await this.requirePlatformReadableProperty(
      db,
      actor,
      uuid(propertyIdInput, "propertyId")
    );

    const rows = await this.repository.listAssessments(db, property.organization_id, property.id);

    return rows.map(assessmentView);
  }

  async getPlatformAssessment(
    db: Kysely<Database>,
    actor: ActorContext,
    propertyIdInput: string,
    assessmentIdInput: string
  ): Promise<QualityAssessmentDetailView> {
    const property = await this.requirePlatformReadableProperty(
      db,
      actor,
      uuid(propertyIdInput, "propertyId")
    );

    return this.getAssessmentDetail(
      db,
      property.organization_id,
      property.id,
      uuid(assessmentIdInput, "assessmentId")
    );
  }

  async listPartnerAssessments(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationIdInput: string,
    propertyIdInput: string
  ): Promise<QualityAssessmentSummaryView[]> {
    const organizationId = uuid(organizationIdInput, "organizationId");
    const propertyId = uuid(propertyIdInput, "propertyId");

    await this.requirePartnerReadableProperty(db, actor, organizationId, propertyId);

    const rows = await this.repository.listAssessments(db, organizationId, propertyId);

    return rows.map(assessmentView);
  }

  async getPartnerAssessment(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationIdInput: string,
    propertyIdInput: string,
    assessmentIdInput: string
  ): Promise<QualityAssessmentDetailView> {
    const organizationId = uuid(organizationIdInput, "organizationId");
    const propertyId = uuid(propertyIdInput, "propertyId");
    const assessmentId = uuid(assessmentIdInput, "assessmentId");

    await this.requirePartnerReadableProperty(db, actor, organizationId, propertyId);

    return this.getAssessmentDetail(db, organizationId, propertyId, assessmentId);
  }

  async startAssessment(
    db: Kysely<Database>,
    actor: ActorContext,
    input: QualityAssessmentCommandInput
  ): Promise<QualityAssessmentSummaryView> {
    assertManage(this.authorization, actor);

    const propertyId = uuid(input.propertyId, "propertyId");
    const assessmentId = uuid(input.assessmentId, "assessmentId");

    return db.transaction().execute(async (trx) => {
      const property = await this.requirePlatformProperty(trx, propertyId);

      const assessment = await this.repository.findAssessmentForUpdate(
        trx,
        property.organization_id,
        property.id,
        assessmentId
      );

      if (!assessment) {
        throw new NotFoundError("Quality assessment not found");
      }

      if (assessment.status !== "DRAFT") {
        throw new ConflictError("Quality assessment is not in DRAFT status");
      }

      const version = await this.repository.findTemplateVersion(
        trx,
        assessment.template_version_id
      );

      if (!version) {
        throw new ConflictError("Quality assessment template version is missing");
      }

      if (version.status === "DRAFT") {
        throw new ConflictError("Draft quality template version cannot start an assessment");
      }

      const started = await this.repository.startAssessment(trx, assessment.id, new Date());

      if (!started) {
        throw new ConflictError("Quality assessment could not be started");
      }

      await new AuditService(trx).record({
        actor,
        organizationId: property.organization_id,
        propertyId: property.id,
        action: "QUALITY_ASSESSMENT_STARTED",
        entityType: "quality_assessment",
        entityId: assessment.id,
        before: assessmentSnapshot(assessment),
        after: assessmentSnapshot(started),
        request: input.request
      });

      return assessmentView(started);
    });
  }

  async recordAssessmentResults(
    db: Kysely<Database>,
    actor: ActorContext,
    input: RecordQualityAssessmentResultsInput
  ): Promise<QualityAssessmentResultView[]> {
    assertManage(this.authorization, actor);

    const propertyId = uuid(input.propertyId, "propertyId");
    const assessmentId = uuid(input.assessmentId, "assessmentId");

    return db.transaction().execute(async (trx) => {
      const property = await this.requirePlatformProperty(trx, propertyId);

      const assessment = await this.repository.findAssessmentForUpdate(
        trx,
        property.organization_id,
        property.id,
        assessmentId
      );

      if (!assessment) {
        throw new NotFoundError("Quality assessment not found");
      }

      if (assessment.status !== "IN_PROGRESS") {
        throw new ConflictError(
          "Quality assessment results can only be recorded while IN_PROGRESS"
        );
      }

      const templateItems = await this.repository.listTemplateItems(
        trx,
        assessment.template_version_id
      );

      const itemById = new Map(templateItems.map((item) => [item.id, item] as const));

      const seen = new Set<string>();
      const normalized = input.results.map((result) => {
        const templateItemId = uuid(result.templateItemId, "templateItemId");

        if (seen.has(templateItemId)) {
          throw new ValidationError(
            `Duplicate quality assessment result for template item ${templateItemId}`
          );
        }

        seen.add(templateItemId);

        const item = itemById.get(templateItemId);

        if (!item) {
          throw new ValidationError(
            "Quality assessment result references an item outside the assessment template"
          );
        }

        return validateResultForItem(result, item);
      });

      const before = await this.repository.listAssessmentResults(trx, assessment.id);

      const after = await this.repository.replaceAssessmentResults(
        trx,
        assessment.id,
        normalized.map((result) => ({
          id: randomUUID(),
          assessment_id: assessment.id,
          template_item_id: result.templateItemId,
          result_status: result.resultStatus,
          score: result.score,
          notes: result.notes,
          recorded_by_user_id: actor.userId
        }))
      );

      await new AuditService(trx).record({
        actor,
        organizationId: property.organization_id,
        propertyId: property.id,
        action: "QUALITY_ASSESSMENT_RESULTS_RECORDED",
        entityType: "quality_assessment",
        entityId: assessment.id,
        before: resultCollectionSnapshot(before),
        after: resultCollectionSnapshot(after),
        request: input.request
      });

      return after.map(resultView);
    });
  }

  async completeAssessment(
    db: Kysely<Database>,
    actor: ActorContext,
    input: QualityAssessmentCommandInput
  ): Promise<QualityAssessmentSummaryView> {
    assertManage(this.authorization, actor);

    const propertyId = uuid(input.propertyId, "propertyId");
    const assessmentId = uuid(input.assessmentId, "assessmentId");

    return db.transaction().execute(async (trx) => {
      const property = await this.requirePlatformProperty(trx, propertyId);

      const assessment = await this.repository.findAssessmentForUpdate(
        trx,
        property.organization_id,
        property.id,
        assessmentId
      );

      if (!assessment) {
        throw new NotFoundError("Quality assessment not found");
      }

      if (assessment.status !== "IN_PROGRESS") {
        throw new ConflictError("Only an IN_PROGRESS quality assessment can be completed");
      }

      const items = await this.repository.listTemplateItems(trx, assessment.template_version_id);

      if (items.length === 0) {
        throw new ConflictError("Quality assessment template contains no items");
      }

      const results = await this.repository.listAssessmentResults(trx, assessment.id);

      if (results.length !== items.length) {
        throw new ValidationError(
          "Every quality template item requires exactly one result before completion"
        );
      }

      const resultByItem = new Map(
        results.map((result) => [result.template_item_id, result] as const)
      );

      let mandatoryFailureCount = 0;
      let scoredTotal = 0;
      let scoredMaximum = 0;

      for (const item of items) {
        const result = resultByItem.get(item.id);

        if (!result) {
          throw new ValidationError(
            `Quality template item ${item.code} is missing a completion result`
          );
        }

        validateResultForItem(
          {
            templateItemId: result.template_item_id,
            resultStatus: result.result_status,
            score: result.score,
            notes: result.notes
          },
          item
        );

        const itemType = checkTypeFromRecord(item.check_type);

        if (itemType === "MANDATORY_PASS" && result.result_status === "FAIL") {
          mandatoryFailureCount += 1;
        }

        if (itemType === "SCORED_QUALITY_ITEM") {
          if (result.score === null || item.max_score === null) {
            throw new ValidationError(`Scored quality item ${item.code} is incomplete`);
          }

          scoredTotal += result.score;
          scoredMaximum += item.max_score;
        }
      }

      const scoreBasisPoints =
        scoredMaximum > 0 ? Math.round((scoredTotal * 10000) / scoredMaximum) : null;

      const outcome: QualityAssessmentOutcome = mandatoryFailureCount > 0 ? "FAIL" : "PASS";

      const completed = await this.repository.completeAssessment(trx, assessment.id, {
        completedAt: new Date(),
        completedByUserId: actor.userId,
        mandatoryFailureCount,
        scoreBasisPoints,
        outcome,
        requiresLifecycleReview: mandatoryFailureCount > 0
      });

      if (!completed) {
        throw new ConflictError("Quality assessment could not be completed");
      }

      await new AuditService(trx).record({
        actor,
        organizationId: property.organization_id,
        propertyId: property.id,
        action: "QUALITY_ASSESSMENT_COMPLETED",
        entityType: "quality_assessment",
        entityId: assessment.id,
        before: assessmentSnapshot(assessment),
        after: assessmentSnapshot(completed),
        metadata: {
          resultCount: results.length,
          mandatoryFailureCount,
          scoreBasisPoints
        },
        request: input.request
      });

      return assessmentView(completed);
    });
  }

  private async getAssessmentDetail(
    db: Kysely<Database>,
    organizationId: string,
    propertyId: string,
    assessmentId: string
  ): Promise<QualityAssessmentDetailView> {
    const assessment = await this.repository.findAssessment(
      db,
      organizationId,
      propertyId,
      assessmentId
    );

    if (!assessment) {
      throw new NotFoundError("Quality assessment not found");
    }

    const [items, results] = await Promise.all([
      this.repository.listTemplateItems(db, assessment.template_version_id),
      this.repository.listAssessmentResults(db, assessment.id)
    ]);

    return {
      ...assessmentView(assessment),
      templateItems: items.map(itemView),
      results: results.map(resultView)
    };
  }

  private async requirePlatformProperty(
    db: Kysely<Database> | Transaction<Database>,
    propertyId: string
  ): Promise<QualityPropertyRecord> {
    const property = await this.repository.findPropertyById(db, propertyId);

    if (!property) {
      throw new NotFoundError("Property not found");
    }

    return property;
  }

  private async requirePlatformReadableProperty(
    db: Kysely<Database>,
    actor: ActorContext,
    propertyId: string
  ): Promise<QualityPropertyRecord> {
    const property = await this.repository.findPropertyById(db, propertyId);

    if (!property) {
      throw new NotFoundError("Property not found");
    }

    this.authorization.assert(actor, Permissions.QUALITY_READ, {
      kind: "property",
      organizationId: property.organization_id,
      propertyId: property.id
    });

    return property;
  }

  private async requirePartnerReadableProperty(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<QualityPropertyRecord> {
    const property = await this.repository.findScopedProperty(db, organizationId, propertyId);

    if (!property) {
      throw new NotFoundError("Property not found");
    }

    this.authorization.assert(actor, Permissions.QUALITY_READ, {
      kind: "property",
      organizationId,
      propertyId
    });

    return property;
  }
}
