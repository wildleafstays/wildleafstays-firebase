import type { ColumnType, Generated } from "kysely";

export interface QualityStandardTemplatesTable {
  id: Generated<string>;
  code: string;
  name: string;
  status: Generated<string>;
  current_version: Generated<number>;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface QualityStandardTemplateVersionsTable {
  id: Generated<string>;
  template_id: string;
  version_number: number;
  status: Generated<string>;
  title: string;
  notes: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_by_user_id: string;
  published_by_user_id: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  published_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_at: Generated<Date>;
}

export interface QualityStandardTemplateItemsTable {
  id: Generated<string>;
  template_version_id: string;
  code: string;
  title: string;
  description: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  category: string;
  check_type: string;
  max_score: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface QualityAssessmentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  template_version_id: string;
  trigger_type: string;
  trigger_reference: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  status: Generated<string>;
  assigned_auditor_user_id: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  created_by_user_id: string;
  started_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  completed_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  completed_by_user_id: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  mandatory_failure_count: Generated<number>;
  score_basis_points: ColumnType<
    number | null,
    number | null | undefined,
    number | null | undefined
  >;
  outcome: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  requires_lifecycle_review: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface QualityAssessmentResultsTable {
  id: Generated<string>;
  assessment_id: string;
  template_item_id: string;
  result_status: string;
  score: ColumnType<number | null, number | null | undefined, number | null | undefined>;
  notes: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  recorded_by_user_id: string;
  recorded_at: Generated<Date>;
}
