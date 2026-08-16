import type { ColumnType, Generated } from "kysely";

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
  audit_events: AuditEventsTable;
  idempotency_keys: IdempotencyKeysTable;
  outbox_events: OutboxEventsTable;
}
