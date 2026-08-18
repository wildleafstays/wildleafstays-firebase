import type { ColumnType, Generated } from "kysely";
import type {
  FinancialLedgerEntriesTable,
  FinancialLedgerJournalsTable
} from "../../modules/finance/infrastructure/financial-ledger-database-types.js";
import type {
  RevenueRecognitionScheduleLinesTable,
  RevenueRecognitionSchedulesTable
} from "../../modules/finance/infrastructure/revenue-recognition-database-types.js";
import type {
  InventoryBlocksTable,
  InventoryDailyBucketsTable,
  InventoryEventsTable
} from "../../modules/inventory/infrastructure/inventory-database-types.js";
import type {
  InventoryHoldItemsTable,
  InventoryHoldNightsTable,
  InventoryHoldsTable
} from "../../modules/inventory/infrastructure/inventory-hold-database-types.js";
import type {
  InventoryAllocationItemsTable,
  InventoryAllocationNightsTable,
  InventoryAllocationsTable
} from "../../modules/inventory/infrastructure/inventory-allocation-database-types.js";
import type {
  RateCalendarDaysTable,
  RateEventsTable,
  RatePlanProductsTable,
  RatePlansTable
} from "../../modules/rates/infrastructure/rate-database-types.js";
import type {
  QuoteEventsTable,
  QuoteNightsTable,
  QuotesTable,
  QuoteUnitsTable
} from "../../modules/quotes/infrastructure/quote-database-types.js";
import type {
  QuoteCancellationSnapshotsTable,
  QuoteCancellationTierSnapshotsTable,
  QuoteCommercialSettingDaysTable,
  QuoteCommercialSnapshotsTable,
  QuoteFeeLinesTable,
  QuoteGuestAgeSnapshotsTable,
  QuoteTaxLinesTable,
  QuoteUnitAgeBreakdownsTable
} from "../../modules/quotes/infrastructure/quote-commercial-database-types.js";
import type {
  QuoteFinalFeeLinesTable,
  QuoteFinalTaxLinesTable,
  QuotePromotionLinesTable,
  QuotePromotionSnapshotsTable
} from "../../modules/quotes/infrastructure/quote-promotion-database-types.js";
import type { QuoteInventoryHoldsTable } from "../../modules/quotes/infrastructure/quote-hold-database-types.js";
import type {
  ReservationFinancialSnapshotsTable,
  ReservationLeadGuestSnapshotsTable,
  ReservationsTable,
  ReservationStatusHistoryTable
} from "../../modules/reservations/infrastructure/reservation-database-types.js";
import type {
  PaymentEventsTable,
  PaymentIntentsTable
} from "../../modules/payments/infrastructure/payment-database-types.js";
import type { PaymentProviderEvidenceTable } from "../../modules/payments/infrastructure/payment-evidence-database-types.js";
import type { PaymentProviderOrdersTable } from "../../modules/payments/infrastructure/payment-provider-order-database-types.js";
import type { PaymentRefundRequestsTable } from "../../modules/payments/infrastructure/payment-refund-database-types.js";
import type {
  PaymentRefundFinalizationsTable,
  PaymentRefundProviderEventsTable
} from "../../modules/payments/infrastructure/payment-refund-lifecycle-database-types.js";
import type { PaymentRefundSubmissionsTable } from "../../modules/payments/infrastructure/payment-refund-submission-database-types.js";
import type {
  PaymentReconciliationCasesTable,
  PaymentSuccessesTable
} from "../../modules/payments/infrastructure/payment-processing-database-types.js";

import type {
  CancellationPoliciesTable,
  CancellationPolicyTiersTable,
  CancellationPolicyVersionsTable,
  CommercialFeeAssignmentsTable,
  CommercialFeePoliciesTable,
  CommercialFeePolicyVersionsTable,
  CommercialRuleEventsTable,
  CommercialTaxAssignmentsTable,
  CommercialTaxComponentsTable,
  CommercialTaxPoliciesTable,
  CommercialTaxPolicyVersionsTable,
  GuestAgePoliciesTable,
  GuestAgePolicyVersionsTable,
  PropertyCommercialSettingsTable,
  PropertyCommercialSettingVersionsTable,
  RatePlanCancellationAssignmentsTable
} from "../../modules/commercial/infrastructure/commercial-rules-database-types.js";
import type {
  PromotionAssignmentsTable,
  PromotionCampaignsTable,
  PromotionCampaignVersionsTable,
  PromotionRuleEventsTable,
  PropertyPromotionSettingsTable,
  PropertyPromotionSettingVersionsTable
} from "../../modules/commercial/infrastructure/promotion-rules-database-types.js";
export type JsonObject = Record<string, unknown>;

export interface UsersTable {
  id: Generated<string>;
  auth_provider: string;
  auth_subject: string;
  email: string | null;
  display_name: string | null;
  email_verified: boolean;
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationsTable {
  id: Generated<string>;
  legal_name: string;
  trading_name: string | null;
  organization_type: string;
  status: string;
  country_code: string;
  currency_code: string;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrganizationMembershipsTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role_code: string;
  status: string;
  invited_by_user_id: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertiesTable {
  id: Generated<string>;
  organization_id: string;
  public_slug: string | null;
  name: string;
  status: string;
  timezone: string;
  property_type: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  sale_mode: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  short_description: ColumnType<
    string | null,
    string | null | undefined,
    string | null | undefined
  >;
  description: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  address_line_1: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  address_line_2: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  locality: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  city: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  state_region: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  postal_code: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  country_code: Generated<string>;
  latitude: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  longitude: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  contact_phone: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  contact_email: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  check_in_time: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  check_out_time: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  submission_sequence: Generated<number>;
  submitted_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  approved_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  live_at: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyAccessGrantsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  organization_membership_id: string;
  role_code: string;
  status: string;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlatformStaffRolesTable {
  id: Generated<string>;
  user_id: string;
  role_code: string;
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyStructuresTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string | null;
  name: string;
  structure_type: string;
  sort_order: Generated<number>;
  has_lift: Generated<boolean>;
  wheelchair_accessible: Generated<boolean>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyFloorsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  structure_id: string;
  code: string | null;
  name: string;
  floor_number: number | null;
  sort_order: Generated<number>;
  lift_accessible: Generated<boolean>;
  wheelchair_accessible: Generated<boolean>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RoomCategoriesTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  code: string;
  name: string;
  accommodation_type: string;
  description: string | null;
  base_occupancy: Generated<number>;
  max_adults: Generated<number>;
  max_children: Generated<number>;
  max_occupancy: Generated<number>;
  size_sqm: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  bed_configuration: string | null;
  extra_bed_allowed: Generated<boolean>;
  default_view_label: string | null;
  sort_order: Generated<number>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PhysicalUnitsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  room_category_id: string;
  structure_id: string | null;
  floor_id: string | null;
  unit_code: string;
  display_name: string | null;
  has_view: Generated<boolean>;
  view_label: string | null;
  wheelchair_accessible: Generated<boolean>;
  step_free_accessible: Generated<boolean>;
  lift_accessible: Generated<boolean>;
  smoking_policy: Generated<string>;
  internal_notes: string | null;
  sort_order: Generated<number>;
  status: Generated<string>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AmenityCatalogTable {
  code: string;
  name: string;
  category: string;
  active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: Generated<Date>;
}

export interface PropertyAmenitiesTable {
  organization_id: string;
  property_id: string;
  amenity_code: string;
  details: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyPoliciesTable {
  property_id: string;
  organization_id: string;
  children_policy: string;
  pets_policy: string;
  smoking_policy: string;
  parties_events_policy: string;
  minimum_checkin_age: number | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  house_rules: string | null;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyMediaTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  media_type: string;
  storage_provider: string;
  storage_key: string;
  mime_type: string | null;
  alt_text: string | null;
  caption: string | null;
  is_cover: Generated<boolean>;
  sort_order: Generated<number>;
  status: Generated<string>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyDocumentsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  document_type: string;
  storage_provider: string;
  storage_key: string;
  original_filename: string;
  issued_on: string | null;
  expires_on: string | null;
  verification_status: Generated<string>;
  verification_reason: string | null;
  verified_by_user_id: string | null;
  verified_at: Date | null;
  status: Generated<string>;
  created_by_user_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PropertyReviewRoundsTable {
  id: Generated<string>;
  organization_id: string;
  property_id: string;
  submission_number: number;
  submitted_by_user_id: string;
  submitted_at: Generated<Date>;
  review_started_by_user_id: string | null;
  review_started_at: Date | null;
  decision: string | null;
  decision_reason: string | null;
  decided_by_user_id: string | null;
  decided_at: Date | null;
  status: Generated<string>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  actor_type: string;
  actor_user_id: string | null;
  actor_role: string | null;
  organization_id: string | null;
  property_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_json: ColumnType<JsonObject | null, JsonObject | null, JsonObject | null>;
  after_json: ColumnType<JsonObject | null, JsonObject | null, JsonObject | null>;
  metadata_json: ColumnType<JsonObject, JsonObject, JsonObject>;
  reason: string | null;
  source: string;
  request_id: string;
  correlation_id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface IdempotencyKeysTable {
  id: Generated<string>;
  scope_key: string;
  idempotency_key: string;
  request_hash: string;
  state: string;
  response_status: number | null;
  response_body: ColumnType<JsonObject | null, JsonObject | null, JsonObject | null>;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboxEventsTable {
  id: Generated<string>;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: ColumnType<JsonObject, JsonObject, JsonObject>;
  occurred_at: Generated<Date>;
  available_at: Generated<Date>;
  processed_at: Date | null;
  attempt_count: Generated<number>;
  last_error: string | null;
}

export interface Database {
  users: UsersTable;
  organizations: OrganizationsTable;
  organization_memberships: OrganizationMembershipsTable;
  properties: PropertiesTable;
  property_access_grants: PropertyAccessGrantsTable;
  platform_staff_roles: PlatformStaffRolesTable;
  property_structures: PropertyStructuresTable;
  property_floors: PropertyFloorsTable;
  room_categories: RoomCategoriesTable;
  physical_units: PhysicalUnitsTable;
  amenity_catalog: AmenityCatalogTable;
  property_amenities: PropertyAmenitiesTable;
  property_policies: PropertyPoliciesTable;
  property_media: PropertyMediaTable;
  property_documents: PropertyDocumentsTable;
  property_review_rounds: PropertyReviewRoundsTable;
  inventory_daily_buckets: InventoryDailyBucketsTable;
  inventory_blocks: InventoryBlocksTable;
  inventory_events: InventoryEventsTable;
  inventory_holds: InventoryHoldsTable;
  inventory_hold_items: InventoryHoldItemsTable;
  inventory_hold_nights: InventoryHoldNightsTable;
  inventory_allocations: InventoryAllocationsTable;
  inventory_allocation_items: InventoryAllocationItemsTable;
  inventory_allocation_nights: InventoryAllocationNightsTable;
  rate_plans: RatePlansTable;
  rate_plan_products: RatePlanProductsTable;
  rate_calendar_days: RateCalendarDaysTable;
  rate_events: RateEventsTable;
  quotes: QuotesTable;
  quote_units: QuoteUnitsTable;
  quote_nights: QuoteNightsTable;
  quote_events: QuoteEventsTable;
  quote_commercial_snapshots: QuoteCommercialSnapshotsTable;
  quote_commercial_setting_days: QuoteCommercialSettingDaysTable;
  quote_guest_age_snapshots: QuoteGuestAgeSnapshotsTable;
  quote_unit_age_breakdowns: QuoteUnitAgeBreakdownsTable;
  quote_fee_lines: QuoteFeeLinesTable;
  quote_tax_lines: QuoteTaxLinesTable;
  quote_cancellation_snapshots: QuoteCancellationSnapshotsTable;
  quote_cancellation_tier_snapshots: QuoteCancellationTierSnapshotsTable;
  quote_promotion_snapshots: QuotePromotionSnapshotsTable;
  quote_promotion_lines: QuotePromotionLinesTable;
  quote_final_fee_lines: QuoteFinalFeeLinesTable;
  quote_final_tax_lines: QuoteFinalTaxLinesTable;
  quote_inventory_holds: QuoteInventoryHoldsTable;
  reservations: ReservationsTable;
  reservation_financial_snapshots: ReservationFinancialSnapshotsTable;
  reservation_lead_guest_snapshots: ReservationLeadGuestSnapshotsTable;
  reservation_status_history: ReservationStatusHistoryTable;
  payment_intents: PaymentIntentsTable;
  payment_events: PaymentEventsTable;
  payment_provider_evidence: PaymentProviderEvidenceTable;
  payment_provider_orders: PaymentProviderOrdersTable;
  payment_successes: PaymentSuccessesTable;
  payment_reconciliation_cases: PaymentReconciliationCasesTable;
  payment_refund_requests: PaymentRefundRequestsTable;
  payment_refund_provider_events: PaymentRefundProviderEventsTable;
  payment_refund_finalizations: PaymentRefundFinalizationsTable;
  payment_refund_submissions: PaymentRefundSubmissionsTable;
  financial_ledger_journals: FinancialLedgerJournalsTable;
  financial_ledger_entries: FinancialLedgerEntriesTable;
  reservation_revenue_schedules: RevenueRecognitionSchedulesTable;
  reservation_revenue_schedule_lines: RevenueRecognitionScheduleLinesTable;
  property_commercial_settings: PropertyCommercialSettingsTable;
  property_commercial_setting_versions: PropertyCommercialSettingVersionsTable;
  commercial_tax_policies: CommercialTaxPoliciesTable;
  commercial_tax_policy_versions: CommercialTaxPolicyVersionsTable;
  commercial_tax_components: CommercialTaxComponentsTable;
  commercial_tax_assignments: CommercialTaxAssignmentsTable;
  commercial_fee_policies: CommercialFeePoliciesTable;
  commercial_fee_policy_versions: CommercialFeePolicyVersionsTable;
  commercial_fee_assignments: CommercialFeeAssignmentsTable;
  cancellation_policies: CancellationPoliciesTable;
  cancellation_policy_versions: CancellationPolicyVersionsTable;
  cancellation_policy_tiers: CancellationPolicyTiersTable;
  rate_plan_cancellation_assignments: RatePlanCancellationAssignmentsTable;
  guest_age_policies: GuestAgePoliciesTable;
  guest_age_policy_versions: GuestAgePolicyVersionsTable;
  commercial_rule_events: CommercialRuleEventsTable;
  property_promotion_settings: PropertyPromotionSettingsTable;
  property_promotion_setting_versions: PropertyPromotionSettingVersionsTable;
  promotion_campaigns: PromotionCampaignsTable;
  promotion_campaign_versions: PromotionCampaignVersionsTable;
  promotion_assignments: PromotionAssignmentsTable;
  promotion_rule_events: PromotionRuleEventsTable;
  audit_events: AuditEventsTable;
  idempotency_keys: IdempotencyKeysTable;
  outbox_events: OutboxEventsTable;
}
