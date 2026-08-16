import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);

  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      auth_provider text not null,
      auth_subject text not null,
      email text,
      display_name text,
      email_verified boolean not null default false,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'DELETED')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (auth_provider, auth_subject)
    )
  `.execute(db);

  await sql`
    create unique index users_email_unique_ci
      on users (lower(email))
      where email is not null and status <> 'DELETED'
  `.execute(db);

  await sql`
    create table organizations (
      id uuid primary key default gen_random_uuid(),
      legal_name text not null,
      trading_name text,
      organization_type text not null check (organization_type in ('PROPRIETORSHIP', 'PARTNERSHIP', 'LLP', 'PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'TRUST', 'OTHER')),
      status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
      country_code char(2) not null default 'IN',
      currency_code char(3) not null default 'INR',
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table organization_memberships (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      user_id uuid not null references users(id) on delete restrict,
      role_code text not null check (role_code in ('OWNER', 'ADMIN', 'FINANCE', 'VIEWER')),
      status text not null default 'ACTIVE' check (status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
      invited_by_user_id uuid references users(id) on delete set null,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, user_id),
      unique (id, organization_id)
    )
  `.execute(db);

  await sql`
    create index organization_memberships_user_idx
      on organization_memberships (user_id, status)
  `.execute(db);

  await sql`
    create table properties (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      public_slug text,
      name text not null,
      status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUIRED', 'APPROVED', 'LIVE', 'SUSPENDED', 'ARCHIVED')),
      timezone text not null default 'Asia/Kolkata',
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, organization_id)
    )
  `.execute(db);

  await sql`
    create unique index properties_public_slug_unique_ci
      on properties (lower(public_slug))
      where public_slug is not null and status <> 'ARCHIVED'
  `.execute(db);

  await sql`
    create index properties_organization_idx
      on properties (organization_id, status)
  `.execute(db);

  await sql`
    create table property_access_grants (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      property_id uuid not null,
      organization_membership_id uuid not null,
      role_code text not null check (role_code in ('MANAGER', 'FRONT_DESK', 'REVENUE_MANAGER', 'HOUSEKEEPING', 'FINANCE', 'VIEWER')),
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_membership_id, property_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (organization_membership_id, organization_id)
        references organization_memberships(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_access_grants_membership_idx
      on property_access_grants (organization_membership_id, status)
  `.execute(db);

  await sql`
    create index property_access_grants_property_idx
      on property_access_grants (property_id, status)
  `.execute(db);

  await sql`
    create table platform_staff_roles (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete restrict,
      role_code text not null check (role_code in ('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'REVENUE_MANAGER', 'FINANCE_MANAGER', 'QUALITY_AUDITOR', 'CUSTOMER_SUPPORT', 'CONTENT_MANAGER', 'ANALYST')),
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (user_id, role_code)
    )
  `.execute(db);

  await sql`
    create index platform_staff_roles_user_idx
      on platform_staff_roles (user_id, status)
  `.execute(db);

  await sql`
    create table audit_events (
      id uuid primary key default gen_random_uuid(),
      actor_type text not null check (actor_type in ('USER', 'SYSTEM', 'PROVIDER')),
      actor_user_id uuid references users(id) on delete restrict,
      actor_role text,
      organization_id uuid references organizations(id) on delete restrict,
      property_id uuid references properties(id) on delete restrict,
      action text not null,
      entity_type text not null,
      entity_id text not null,
      before_json jsonb,
      after_json jsonb,
      metadata_json jsonb not null default '{}'::jsonb,
      reason text,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      ip_address inet,
      user_agent text,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create index audit_events_entity_idx
      on audit_events (entity_type, entity_id, created_at desc)
  `.execute(db);

  await sql`
    create index audit_events_scope_idx
      on audit_events (organization_id, property_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_audit_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'audit_events is append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger audit_events_no_update
      before update or delete on audit_events
      for each row execute function prevent_audit_event_mutation()
  `.execute(db);

  await sql`
    create table idempotency_keys (
      id uuid primary key default gen_random_uuid(),
      scope_key text not null,
      idempotency_key text not null,
      request_hash text not null,
      state text not null default 'STARTED' check (state in ('STARTED', 'COMPLETED', 'FAILED')),
      response_status integer,
      response_body jsonb,
      expires_at timestamptz not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (scope_key, idempotency_key)
    )
  `.execute(db);

  await sql`
    create index idempotency_keys_expiry_idx
      on idempotency_keys (expires_at)
  `.execute(db);

  await sql`
    create table outbox_events (
      id uuid primary key default gen_random_uuid(),
      aggregate_type text not null,
      aggregate_id text not null,
      event_type text not null,
      payload jsonb not null,
      occurred_at timestamptz not null default now(),
      available_at timestamptz not null default now(),
      processed_at timestamptz,
      attempt_count integer not null default 0 check (attempt_count >= 0),
      last_error text
    )
  `.execute(db);

  await sql`
    create index outbox_events_pending_idx
      on outbox_events (available_at, occurred_at)
      where processed_at is null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists outbox_events`.execute(db);
  await sql`drop table if exists idempotency_keys`.execute(db);
  await sql`drop trigger if exists audit_events_no_update on audit_events`.execute(db);
  await sql`drop function if exists prevent_audit_event_mutation()`.execute(db);
  await sql`drop table if exists audit_events`.execute(db);
  await sql`drop table if exists platform_staff_roles`.execute(db);
  await sql`drop table if exists property_access_grants`.execute(db);
  await sql`drop table if exists properties`.execute(db);
  await sql`drop table if exists organization_memberships`.execute(db);
  await sql`drop table if exists organizations`.execute(db);
  await sql`drop table if exists users`.execute(db);
}
