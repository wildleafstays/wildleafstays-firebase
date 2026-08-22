import type { Insertable, Kysely, Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type {
  QualityAssessmentResultsTable,
  QualityAssessmentsTable,
  QualityStandardTemplateItemsTable,
  QualityStandardTemplatesTable,
  QualityStandardTemplateVersionsTable
} from "./quality-audit-database-types.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type QualityTemplateRecord = Selectable<QualityStandardTemplatesTable>;
export type QualityTemplateVersionRecord = Selectable<QualityStandardTemplateVersionsTable>;
export type QualityTemplateItemRecord = Selectable<QualityStandardTemplateItemsTable>;
export type QualityAssessmentRecord = Selectable<QualityAssessmentsTable>;
export type QualityAssessmentResultRecord = Selectable<QualityAssessmentResultsTable>;

export interface QualityPropertyRecord {
  id: string;
  organization_id: string;
  status: string;
}

export class QualityAuditRepository {
  async findTemplateByCode(
    db: DbExecutor,
    code: string
  ): Promise<QualityTemplateRecord | undefined> {
    return db
      .selectFrom("quality_standard_templates")
      .selectAll()
      .where("code", "=", code)
      .executeTakeFirst();
  }

  async findTemplateById(
    db: DbExecutor,
    templateId: string
  ): Promise<QualityTemplateRecord | undefined> {
    return db
      .selectFrom("quality_standard_templates")
      .selectAll()
      .where("id", "=", templateId)
      .executeTakeFirst();
  }

  async findTemplateForUpdate(
    db: Transaction<Database>,
    templateId: string
  ): Promise<QualityTemplateRecord | undefined> {
    return db
      .selectFrom("quality_standard_templates")
      .selectAll()
      .where("id", "=", templateId)
      .forUpdate()
      .executeTakeFirst();
  }

  async insertTemplate(
    db: DbExecutor,
    values: Insertable<QualityStandardTemplatesTable>
  ): Promise<QualityTemplateRecord> {
    return db
      .insertInto("quality_standard_templates")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateTemplateCurrentVersion(
    db: DbExecutor,
    templateId: string,
    currentVersion: number,
    updatedByUserId: string
  ): Promise<QualityTemplateRecord> {
    return db
      .updateTable("quality_standard_templates")
      .set({
        current_version: currentVersion,
        updated_by_user_id: updatedByUserId,
        updated_at: new Date()
      })
      .where("id", "=", templateId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertTemplateVersion(
    db: DbExecutor,
    values: Insertable<QualityStandardTemplateVersionsTable>
  ): Promise<QualityTemplateVersionRecord> {
    return db
      .insertInto("quality_standard_template_versions")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findTemplateVersion(
    db: DbExecutor,
    versionId: string
  ): Promise<QualityTemplateVersionRecord | undefined> {
    return db
      .selectFrom("quality_standard_template_versions")
      .selectAll()
      .where("id", "=", versionId)
      .executeTakeFirst();
  }

  async findTemplateVersionForUpdate(
    db: Transaction<Database>,
    versionId: string
  ): Promise<QualityTemplateVersionRecord | undefined> {
    return db
      .selectFrom("quality_standard_template_versions")
      .selectAll()
      .where("id", "=", versionId)
      .forUpdate()
      .executeTakeFirst();
  }

  async listTemplateItems(db: DbExecutor, versionId: string): Promise<QualityTemplateItemRecord[]> {
    return db
      .selectFrom("quality_standard_template_items")
      .selectAll()
      .where("template_version_id", "=", versionId)
      .orderBy("sort_order", "asc")
      .orderBy("code", "asc")
      .execute();
  }

  async replaceTemplateItems(
    db: Transaction<Database>,
    versionId: string,
    items: Array<Insertable<QualityStandardTemplateItemsTable>>
  ): Promise<QualityTemplateItemRecord[]> {
    await db
      .deleteFrom("quality_standard_template_items")
      .where("template_version_id", "=", versionId)
      .execute();

    if (items.length > 0) {
      await db.insertInto("quality_standard_template_items").values(items).execute();
    }

    return this.listTemplateItems(db, versionId);
  }

  async publishTemplateVersion(
    db: DbExecutor,
    versionId: string,
    publishedByUserId: string,
    publishedAt: Date
  ): Promise<QualityTemplateVersionRecord | undefined> {
    return db
      .updateTable("quality_standard_template_versions")
      .set({
        status: "PUBLISHED",
        published_by_user_id: publishedByUserId,
        published_at: publishedAt
      })
      .where("id", "=", versionId)
      .where("status", "=", "DRAFT")
      .returningAll()
      .executeTakeFirst();
  }

  async findPropertyById(
    db: DbExecutor,
    propertyId: string
  ): Promise<QualityPropertyRecord | undefined> {
    return db
      .selectFrom("properties")
      .select(["id", "organization_id", "status"])
      .where("id", "=", propertyId)
      .executeTakeFirst();
  }

  async findScopedProperty(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<QualityPropertyRecord | undefined> {
    return db
      .selectFrom("properties")
      .select(["id", "organization_id", "status"])
      .where("organization_id", "=", organizationId)
      .where("id", "=", propertyId)
      .executeTakeFirst();
  }

  async insertAssessment(
    db: DbExecutor,
    values: Insertable<QualityAssessmentsTable>
  ): Promise<QualityAssessmentRecord> {
    return db
      .insertInto("quality_assessments")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async listAssessments(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<QualityAssessmentRecord[]> {
    return db
      .selectFrom("quality_assessments")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
  }

  async findAssessment(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    assessmentId: string
  ): Promise<QualityAssessmentRecord | undefined> {
    return db
      .selectFrom("quality_assessments")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", assessmentId)
      .executeTakeFirst();
  }

  async findAssessmentForUpdate(
    db: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    assessmentId: string
  ): Promise<QualityAssessmentRecord | undefined> {
    return db
      .selectFrom("quality_assessments")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", assessmentId)
      .forUpdate()
      .executeTakeFirst();
  }

  async startAssessment(
    db: DbExecutor,
    assessmentId: string,
    startedAt: Date
  ): Promise<QualityAssessmentRecord | undefined> {
    return db
      .updateTable("quality_assessments")
      .set({
        status: "IN_PROGRESS",
        started_at: startedAt,
        updated_at: startedAt
      })
      .where("id", "=", assessmentId)
      .where("status", "=", "DRAFT")
      .returningAll()
      .executeTakeFirst();
  }

  async listAssessmentResults(
    db: DbExecutor,
    assessmentId: string
  ): Promise<QualityAssessmentResultRecord[]> {
    return db
      .selectFrom("quality_assessment_results")
      .selectAll()
      .where("assessment_id", "=", assessmentId)
      .orderBy("recorded_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async replaceAssessmentResults(
    db: Transaction<Database>,
    assessmentId: string,
    results: Array<Insertable<QualityAssessmentResultsTable>>
  ): Promise<QualityAssessmentResultRecord[]> {
    await db
      .deleteFrom("quality_assessment_results")
      .where("assessment_id", "=", assessmentId)
      .execute();

    if (results.length > 0) {
      await db.insertInto("quality_assessment_results").values(results).execute();
    }

    return this.listAssessmentResults(db, assessmentId);
  }

  async completeAssessment(
    db: DbExecutor,
    assessmentId: string,
    input: {
      completedAt: Date;
      completedByUserId: string;
      mandatoryFailureCount: number;
      scoreBasisPoints: number | null;
      outcome: "PASS" | "FAIL";
      requiresLifecycleReview: boolean;
    }
  ): Promise<QualityAssessmentRecord | undefined> {
    return db
      .updateTable("quality_assessments")
      .set({
        status: "COMPLETED",
        completed_at: input.completedAt,
        completed_by_user_id: input.completedByUserId,
        mandatory_failure_count: input.mandatoryFailureCount,
        score_basis_points: input.scoreBasisPoints,
        outcome: input.outcome,
        requires_lifecycle_review: input.requiresLifecycleReview,
        updated_at: input.completedAt
      })
      .where("id", "=", assessmentId)
      .where("status", "=", "IN_PROGRESS")
      .returningAll()
      .executeTakeFirst();
  }
}
