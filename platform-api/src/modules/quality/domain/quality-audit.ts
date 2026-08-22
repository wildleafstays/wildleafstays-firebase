export const QUALITY_CHECK_TYPES = [
  "MANDATORY_PASS",
  "SCORED_QUALITY_ITEM",
  "INFORMATIONAL_DISCLOSURE",
  "IMPROVEMENT_RECOMMENDATION"
] as const;

export type QualityCheckType = (typeof QUALITY_CHECK_TYPES)[number];

export const QUALITY_TRIGGER_TYPES = [
  "SCHEDULED_AUDIT",
  "REPEATED_LOW_REVIEWS",
  "SERIOUS_COMPLAINT",
  "OWNERSHIP_MANAGEMENT_CHANGE",
  "RENOVATION",
  "SAFETY_INCIDENT"
] as const;

export type QualityTriggerType = (typeof QUALITY_TRIGGER_TYPES)[number];

export const QUALITY_RESULT_STATUSES = ["PASS", "FAIL", "OBSERVED", "NOT_APPLICABLE"] as const;

export type QualityResultStatus = (typeof QUALITY_RESULT_STATUSES)[number];

export type QualityTemplateStatus = "ACTIVE" | "INACTIVE";
export type QualityTemplateVersionStatus = "DRAFT" | "PUBLISHED" | "RETIRED";
export type QualityAssessmentStatus = "DRAFT" | "IN_PROGRESS" | "COMPLETED";
export type QualityAssessmentOutcome = "PASS" | "FAIL";

export interface QualityTemplateView {
  id: string;
  code: string;
  name: string;
  status: QualityTemplateStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface QualityTemplateVersionView {
  id: string;
  templateId: string;
  versionNumber: number;
  status: QualityTemplateVersionStatus;
  title: string;
  notes: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface QualityTemplateItemView {
  id: string;
  templateVersionId: string;
  code: string;
  title: string;
  description: string | null;
  category: string;
  checkType: QualityCheckType;
  maxScore: number | null;
  sortOrder: number;
}

export interface QualityAssessmentSummaryView {
  id: string;
  organizationId: string;
  propertyId: string;
  templateVersionId: string;
  triggerType: QualityTriggerType;
  triggerReference: string | null;
  status: QualityAssessmentStatus;
  assignedAuditorUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  mandatoryFailureCount: number;
  scoreBasisPoints: number | null;
  outcome: QualityAssessmentOutcome | null;
  requiresLifecycleReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QualityAssessmentResultView {
  id: string;
  assessmentId: string;
  templateItemId: string;
  resultStatus: QualityResultStatus;
  score: number | null;
  notes: string | null;
  recordedByUserId: string;
  recordedAt: string;
}

export interface QualityAssessmentDetailView extends QualityAssessmentSummaryView {
  templateItems: QualityTemplateItemView[];
  results: QualityAssessmentResultView[];
}
