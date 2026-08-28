import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table platform_hotel_gst_rule_versions (
      id uuid primary key default gen_random_uuid(),
      version_number integer not null unique check (version_number > 0),
      effective_from date not null unique,
      threshold_minor integer not null check (threshold_minor > 0),
      lower_rate_basis_points integer not null check (
        lower_rate_basis_points between 0 and 10000
      ),
      upper_rate_basis_points integer not null check (
        upper_rate_basis_points between 0 and 10000
      ),
      lower_itc_available boolean not null,
      upper_itc_available boolean not null,
      source_url text not null check (source_url ~ '^https://'),
      rule_text text not null check (char_length(rule_text) between 20 and 5000),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table property_hotel_gst_consents (
      property_id uuid primary key,
      organization_id uuid not null,
      accepted_rule_version_id uuid not null
        references platform_hotel_gst_rule_versions(id) on delete restrict,
      acceptance_text text not null check (char_length(acceptance_text) between 20 and 5000),
      accepted_by_user_id uuid not null references users(id) on delete restrict,
      accepted_at timestamptz not null default now(),
      ip_address text,
      user_agent text,
      version integer not null default 1 check (version > 0),
      unique (property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_hotel_gst_consents_rule_idx
      on property_hotel_gst_consents (accepted_rule_version_id)
  `.execute(db);

  await sql`
    create table property_hotel_gst_rule_syncs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      rule_version_id uuid not null
        references platform_hotel_gst_rule_versions(id) on delete restrict,
      lower_tax_policy_version_id uuid not null,
      upper_tax_policy_version_id uuid not null,
      synced_at timestamptz not null default now(),
      unique (property_id, rule_version_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (lower_tax_policy_version_id, property_id, organization_id)
        references commercial_tax_policy_versions(id, property_id, organization_id)
        on delete restrict,
      foreign key (upper_tax_policy_version_id, property_id, organization_id)
        references commercial_tax_policy_versions(id, property_id, organization_id)
        on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_hotel_gst_rule_syncs_rule_idx
      on property_hotel_gst_rule_syncs (rule_version_id)
  `.execute(db);

  await sql`
    insert into platform_hotel_gst_rule_versions (
      version_number,
      effective_from,
      threshold_minor,
      lower_rate_basis_points,
      upper_rate_basis_points,
      lower_itc_available,
      upper_itc_available,
      source_url,
      rule_text
    ) values (
      1,
      '2025-09-22',
      750000,
      500,
      1800,
      false,
      true,
      'https://gstcouncil.gov.in/sites/default/files/2025-09/press_release_press_information_bureau.pdf',
      'Hotel accommodation up to and including INR 7,500 per room or accommodation unit per day attracts 5% GST without input tax credit (CGST 2.5% and SGST 2.5%). A value above INR 7,500 attracts 18% GST with input tax credit available (CGST 9% and SGST 9%).'
    )
  `.execute(db);

  await sql`
    create or replace function protect_platform_hotel_gst_rule_versions()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'Platform hotel GST rule versions are append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger platform_hotel_gst_rule_versions_append_only
      before update or delete on platform_hotel_gst_rule_versions
      for each row execute function protect_platform_hotel_gst_rule_versions()
  `.execute(db);

  await sql`
    create or replace function protect_property_hotel_gst_consent_acceptance()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.property_id <> old.property_id
        or new.organization_id <> old.organization_id
        or new.accepted_rule_version_id <> old.accepted_rule_version_id
        or new.acceptance_text <> old.acceptance_text
        or new.accepted_by_user_id <> old.accepted_by_user_id
        or new.accepted_at <> old.accepted_at
        or new.ip_address is distinct from old.ip_address
        or new.user_agent is distinct from old.user_agent then
        raise exception 'Accepted GST consent evidence is immutable';
      end if;
      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger property_hotel_gst_consents_protect_evidence
      before update on property_hotel_gst_consents
      for each row execute function protect_property_hotel_gst_consent_acceptance()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists property_hotel_gst_consents_protect_evidence
      on property_hotel_gst_consents
  `.execute(db);
  await sql`drop function if exists protect_property_hotel_gst_consent_acceptance`.execute(db);
  await sql`
    drop trigger if exists platform_hotel_gst_rule_versions_append_only
      on platform_hotel_gst_rule_versions
  `.execute(db);
  await sql`drop function if exists protect_platform_hotel_gst_rule_versions`.execute(db);
  await sql`drop table if exists property_hotel_gst_rule_syncs`.execute(db);
  await sql`drop table if exists property_hotel_gst_consents`.execute(db);
  await sql`drop table if exists platform_hotel_gst_rule_versions`.execute(db);
}
