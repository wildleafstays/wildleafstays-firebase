import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quote_commercial_snapshots (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      commercial_status text not null
        check (commercial_status in ('COMMERCIAL_RULES_APPLIED')),
      promotion_status text not null
        check (promotion_status in ('NOT_EVALUATED')),
      currency_code char(3) not null,
      accommodation_minor integer not null check (accommodation_minor >= 0),
      extra_guest_minor integer not null check (extra_guest_minor >= 0),
      inclusive_fee_minor integer not null check (inclusive_fee_minor >= 0),
      exclusive_fee_minor integer not null check (exclusive_fee_minor >= 0),
      fee_minor integer not null check (fee_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      exclusive_tax_minor integer not null check (exclusive_tax_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      total_minor integer not null check (total_minor >= 0),
      hold_eligible boolean not null default false,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      check (fee_minor = inclusive_fee_minor + exclusive_fee_minor),
      check (tax_minor = inclusive_tax_minor + exclusive_tax_minor),
      check (
        total_minor =
          accommodation_minor +
          extra_guest_minor +
          exclusive_fee_minor +
          exclusive_tax_minor
      ),
      check (hold_eligible = false)
    )
  `.execute(db);

  await sql`
    create table quote_commercial_setting_days (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      stay_date date not null,
      settings_version_id uuid not null,
      settings_version_number integer not null check (settings_version_number >= 1),
      settings_effective_from date not null,
      tax_mode text not null check (tax_mode in ('NO_TAX', 'POLICIES')),
      fee_mode text not null check (fee_mode in ('NO_FEES', 'POLICIES')),
      created_at timestamptz not null default now(),
      unique (quote_id, stay_date),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (settings_version_id, property_id, organization_id)
        references property_commercial_setting_versions(id, property_id, organization_id)
        on delete restrict
    )
  `.execute(db);

  await sql`
    create table quote_guest_age_snapshots (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      guest_age_policy_version_id uuid not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      infant_max_age integer,
      child_max_age integer not null check (child_max_age between 0 and 17),
      infants_count_towards_occupancy boolean not null,
      infants_count_towards_child_limit boolean not null,
      infants_charge_as_children boolean not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (guest_age_policy_version_id, property_id, organization_id)
        references guest_age_policy_versions(id, property_id, organization_id)
        on delete restrict,
      check (infant_max_age is null or infant_max_age between 0 and 17),
      check (infant_max_age is null or infant_max_age < child_max_age)
    )
  `.execute(db);

  await sql`
    create table quote_unit_age_breakdowns (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      unit_index integer not null check (unit_index between 1 and 20),
      children integer not null check (children >= 0),
      infants integer not null check (infants >= 0),
      occupancy_count integer not null check (occupancy_count >= 1),
      child_limit_count integer not null check (child_limit_count >= 0),
      chargeable_children integer not null check (chargeable_children >= 0),
      extra_adults integer not null check (extra_adults >= 0),
      extra_children integer not null check (extra_children >= 0),
      created_at timestamptz not null default now(),
      unique (quote_id, unit_index),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (quote_id, unit_index)
        references quote_units(quote_id, unit_index) on delete restrict
    )
  `.execute(db);

  await sql`
    create table quote_fee_lines (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      line_key text not null,
      fee_policy_id uuid not null,
      fee_policy_version_id uuid not null,
      fee_policy_code text not null,
      fee_policy_name text not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      stay_date date,
      calculation_type text not null check (calculation_type in ('FIXED', 'PERCENTAGE')),
      application_basis text not null check (
        application_basis in (
          'PER_STAY',
          'PER_NIGHT',
          'PER_UNIT_PER_STAY',
          'PER_UNIT_PER_NIGHT',
          'STAY_CHARGES'
        )
      ),
      amount_minor_snapshot integer,
      rate_basis_points_snapshot integer,
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      taxable boolean not null,
      tax_policy_id uuid,
      multiplier integer not null check (multiplier >= 1),
      fee_minor integer not null check (fee_minor >= 0),
      created_at timestamptz not null default now(),
      unique (quote_id, line_key),
      unique (id, quote_id),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (fee_policy_id, property_id, organization_id)
        references commercial_fee_policies(id, property_id, organization_id) on delete restrict,
      foreign key (fee_policy_version_id, property_id, organization_id)
        references commercial_fee_policy_versions(id, property_id, organization_id)
        on delete restrict,
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      check (
        (calculation_type = 'FIXED' and amount_minor_snapshot is not null and rate_basis_points_snapshot is null)
        or
        (calculation_type = 'PERCENTAGE' and amount_minor_snapshot is null and rate_basis_points_snapshot is not null)
      ),
      check (
        (taxable and tax_policy_id is not null)
        or
        (not taxable and tax_policy_id is null)
      )
    )
  `.execute(db);

  await sql`
    create table quote_tax_lines (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      tax_policy_id uuid not null,
      tax_policy_version_id uuid not null,
      tax_policy_code text not null,
      tax_policy_name text not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      component_code text not null,
      component_name text not null,
      rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      charge_type text not null check (charge_type in ('ACCOMMODATION', 'EXTRA_GUEST', 'FEE')),
      stay_date date,
      fee_line_id uuid,
      taxable_basis_minor integer not null check (taxable_basis_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      created_at timestamptz not null default now(),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      foreign key (tax_policy_version_id, property_id, organization_id)
        references commercial_tax_policy_versions(id, property_id, organization_id)
        on delete restrict,
      foreign key (fee_line_id, quote_id)
        references quote_fee_lines(id, quote_id) on delete restrict,
      check (
        (charge_type = 'FEE' and fee_line_id is not null)
        or
        (charge_type <> 'FEE' and fee_line_id is null)
      )
    )
  `.execute(db);

  await sql`
    create table quote_cancellation_snapshots (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      cancellation_policy_id uuid not null,
      cancellation_policy_version_id uuid not null,
      policy_code text not null,
      policy_name text not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      arrival_local_time time not null,
      currency_code char(3) not null,
      policy_text text,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (cancellation_policy_id, property_id, organization_id)
        references cancellation_policies(id, property_id, organization_id) on delete restrict,
      foreign key (cancellation_policy_version_id, property_id, organization_id)
        references cancellation_policy_versions(id, property_id, organization_id)
        on delete restrict
    )
  `.execute(db);

  await sql`
    create table quote_cancellation_tier_snapshots (
      id uuid primary key default gen_random_uuid(),
      quote_cancellation_snapshot_id uuid not null,
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      trigger_type text not null check (trigger_type in ('CANCELLATION', 'NO_SHOW')),
      minimum_minutes_before_arrival integer,
      penalty_type text not null check (
        penalty_type in ('PERCENTAGE_OF_STAY', 'FIXED_AMOUNT', 'NIGHTS')
      ),
      penalty_value integer not null check (penalty_value >= 0),
      created_at timestamptz not null default now(),
      foreign key (quote_cancellation_snapshot_id, property_id, organization_id)
        references quote_cancellation_snapshots(id, property_id, organization_id)
        on delete restrict,
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      check (
        (trigger_type = 'CANCELLATION' and minimum_minutes_before_arrival is not null)
        or
        (trigger_type = 'NO_SHOW' and minimum_minutes_before_arrival is null)
      )
    )
  `.execute(db);

  await sql`
    create index quote_tax_lines_quote_idx on quote_tax_lines (quote_id, stay_date)
  `.execute(db);
  await sql`
    create index quote_fee_lines_quote_idx on quote_fee_lines (quote_id, stay_date)
  `.execute(db);

  for (const table of [
    "quote_commercial_snapshots",
    "quote_commercial_setting_days",
    "quote_guest_age_snapshots",
    "quote_unit_age_breakdowns",
    "quote_fee_lines",
    "quote_tax_lines",
    "quote_cancellation_snapshots",
    "quote_cancellation_tier_snapshots"
  ]) {
    await sql
      .raw(
        `
        create trigger ${table}_no_mutation
          before update or delete on ${table}
          for each row execute function prevent_quote_snapshot_mutation()
      `
      )
      .execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "quote_cancellation_tier_snapshots",
    "quote_cancellation_snapshots",
    "quote_tax_lines",
    "quote_fee_lines",
    "quote_unit_age_breakdowns",
    "quote_guest_age_snapshots",
    "quote_commercial_setting_days",
    "quote_commercial_snapshots"
  ]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`drop table if exists quote_cancellation_tier_snapshots`.execute(db);
  await sql`drop table if exists quote_cancellation_snapshots`.execute(db);
  await sql`drop table if exists quote_tax_lines`.execute(db);
  await sql`drop table if exists quote_fee_lines`.execute(db);
  await sql`drop table if exists quote_unit_age_breakdowns`.execute(db);
  await sql`drop table if exists quote_guest_age_snapshots`.execute(db);
  await sql`drop table if exists quote_commercial_setting_days`.execute(db);
  await sql`drop table if exists quote_commercial_snapshots`.execute(db);
}
