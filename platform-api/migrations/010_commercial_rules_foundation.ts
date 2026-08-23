import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table property_commercial_settings (
      property_id uuid primary key,
      organization_id uuid not null,
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table property_commercial_setting_versions (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      tax_mode text not null check (tax_mode in ('NO_TAX', 'POLICIES')),
      fee_mode text not null check (fee_mode in ('NO_FEES', 'POLICIES')),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, version_number),
      unique (property_id, effective_from),
      foreign key (property_id, organization_id)
        references property_commercial_settings(property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table commercial_tax_policies (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
      name text not null check (char_length(name) between 2 and 120),
      description text,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table commercial_tax_policy_versions (
      id uuid primary key default gen_random_uuid(),
      tax_policy_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      selection_basis text not null check (
        selection_basis in (
          'ALWAYS',
          'NIGHTLY_UNIT_RATE',
          'NIGHTLY_TAXABLE_AMOUNT',
          'STAY_TAXABLE_AMOUNT'
        )
      ),
      minimum_basis_minor integer check (
        minimum_basis_minor is null or minimum_basis_minor >= 0
      ),
      maximum_basis_minor integer check (
        maximum_basis_minor is null or maximum_basis_minor >= 0
      ),
      applies_to_accommodation boolean not null default true,
      applies_to_extra_guest boolean not null default true,
      applies_to_fee boolean not null default false,
      sealed_at timestamptz,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (tax_policy_id, version_number),
      unique (tax_policy_id, effective_from),
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      check (
        applies_to_accommodation
        or applies_to_extra_guest
        or applies_to_fee
      ),
      check (
        maximum_basis_minor is null
        or minimum_basis_minor is null
        or maximum_basis_minor > minimum_basis_minor
      ),
      check (
        selection_basis <> 'ALWAYS'
        or (minimum_basis_minor is null and maximum_basis_minor is null)
      )
    )
  `.execute(db);

  await sql`
    create index commercial_tax_policy_versions_effective_idx
      on commercial_tax_policy_versions (tax_policy_id, effective_from desc)
      where sealed_at is not null
  `.execute(db);

  await sql`
    create table commercial_tax_components (
      id uuid primary key default gen_random_uuid(),
      tax_policy_version_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      component_code text not null check (component_code ~ '^[A-Z0-9_-]{1,40}$'),
      component_name text not null check (char_length(component_name) between 1 and 120),
      rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
      sort_order integer not null default 0 check (sort_order >= 0),
      created_at timestamptz not null default now(),
      unique (tax_policy_version_id, component_code),
      foreign key (tax_policy_version_id, property_id, organization_id)
        references commercial_tax_policy_versions(id, property_id, organization_id)
        on delete restrict
    )
  `.execute(db);

  await sql`
    create table commercial_tax_assignments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      tax_policy_id uuid not null,
      scope_type text not null check (scope_type in ('PROPERTY', 'RATE_PLAN', 'RATE_PRODUCT')),
      rate_plan_id uuid,
      rate_product_id uuid,
      effective_from date not null,
      enabled boolean not null,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique nulls not distinct (
        tax_policy_id,
        scope_type,
        rate_plan_id,
        rate_product_id,
        effective_from
      ),
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict,
      check (
        (scope_type = 'PROPERTY' and rate_plan_id is null and rate_product_id is null)
        or
        (scope_type = 'RATE_PLAN' and rate_plan_id is not null and rate_product_id is null)
        or
        (scope_type = 'RATE_PRODUCT' and rate_plan_id is null and rate_product_id is not null)
      )
    )
  `.execute(db);

  await sql`
    create index commercial_tax_assignments_effective_idx
      on commercial_tax_assignments (
        property_id,
        tax_policy_id,
        scope_type,
        effective_from desc
      )
  `.execute(db);

  await sql`
    create table commercial_fee_policies (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
      name text not null check (char_length(name) between 2 and 120),
      description text,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table commercial_fee_policy_versions (
      id uuid primary key default gen_random_uuid(),
      fee_policy_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      currency_code char(3) not null,
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
      amount_minor integer check (amount_minor is null or amount_minor >= 0),
      rate_basis_points integer check (
        rate_basis_points is null or rate_basis_points between 0 and 10000
      ),
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      taxable boolean not null default false,
      tax_policy_id uuid,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (fee_policy_id, version_number),
      unique (fee_policy_id, effective_from),
      foreign key (fee_policy_id, property_id, organization_id)
        references commercial_fee_policies(id, property_id, organization_id) on delete restrict,
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      check (
        (
          calculation_type = 'FIXED'
          and amount_minor is not null
          and rate_basis_points is null
          and application_basis <> 'STAY_CHARGES'
        )
        or
        (
          calculation_type = 'PERCENTAGE'
          and amount_minor is null
          and rate_basis_points is not null
          and application_basis = 'STAY_CHARGES'
        )
      ),
      check (
        (taxable = true and tax_policy_id is not null)
        or
        (taxable = false and tax_policy_id is null)
      )
    )
  `.execute(db);

  await sql`
    create index commercial_fee_policy_versions_effective_idx
      on commercial_fee_policy_versions (fee_policy_id, effective_from desc)
  `.execute(db);

  await sql`
    create table commercial_fee_assignments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      fee_policy_id uuid not null,
      scope_type text not null check (scope_type in ('PROPERTY', 'RATE_PLAN', 'RATE_PRODUCT')),
      rate_plan_id uuid,
      rate_product_id uuid,
      effective_from date not null,
      enabled boolean not null,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique nulls not distinct (
        fee_policy_id,
        scope_type,
        rate_plan_id,
        rate_product_id,
        effective_from
      ),
      foreign key (fee_policy_id, property_id, organization_id)
        references commercial_fee_policies(id, property_id, organization_id) on delete restrict,
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict,
      check (
        (scope_type = 'PROPERTY' and rate_plan_id is null and rate_product_id is null)
        or
        (scope_type = 'RATE_PLAN' and rate_plan_id is not null and rate_product_id is null)
        or
        (scope_type = 'RATE_PRODUCT' and rate_plan_id is null and rate_product_id is not null)
      )
    )
  `.execute(db);

  await sql`
    create index commercial_fee_assignments_effective_idx
      on commercial_fee_assignments (
        property_id,
        fee_policy_id,
        scope_type,
        effective_from desc
      )
  `.execute(db);

  await sql`
    create table cancellation_policies (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
      name text not null check (char_length(name) between 2 and 120),
      description text,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table cancellation_policy_versions (
      id uuid primary key default gen_random_uuid(),
      cancellation_policy_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      arrival_local_time time not null,
      currency_code char(3) not null,
      policy_text text,
      sealed_at timestamptz,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (cancellation_policy_id, version_number),
      unique (cancellation_policy_id, effective_from),
      foreign key (cancellation_policy_id, property_id, organization_id)
        references cancellation_policies(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index cancellation_policy_versions_effective_idx
      on cancellation_policy_versions (cancellation_policy_id, effective_from desc)
      where sealed_at is not null
  `.execute(db);

  await sql`
    create table cancellation_policy_tiers (
      id uuid primary key default gen_random_uuid(),
      cancellation_policy_version_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      trigger_type text not null check (trigger_type in ('CANCELLATION', 'NO_SHOW')),
      minimum_minutes_before_arrival integer check (
        minimum_minutes_before_arrival is null or minimum_minutes_before_arrival >= 0
      ),
      penalty_type text not null check (
        penalty_type in ('PERCENTAGE_OF_STAY', 'FIXED_AMOUNT', 'NIGHTS')
      ),
      penalty_value integer not null check (penalty_value >= 0),
      created_at timestamptz not null default now(),
      foreign key (cancellation_policy_version_id, property_id, organization_id)
        references cancellation_policy_versions(id, property_id, organization_id)
        on delete restrict,
      check (
        (trigger_type = 'CANCELLATION' and minimum_minutes_before_arrival is not null)
        or
        (trigger_type = 'NO_SHOW' and minimum_minutes_before_arrival is null)
      ),
      check (
        (penalty_type = 'PERCENTAGE_OF_STAY' and penalty_value <= 10000)
        or
        (penalty_type = 'FIXED_AMOUNT' and penalty_value <= 100000000)
        or
        (penalty_type = 'NIGHTS' and penalty_value <= 365)
      )
    )
  `.execute(db);

  await sql`
    create unique index cancellation_policy_tiers_threshold_idx
      on cancellation_policy_tiers (
        cancellation_policy_version_id,
        minimum_minutes_before_arrival
      )
      where trigger_type = 'CANCELLATION'
  `.execute(db);

  await sql`
    create unique index cancellation_policy_tiers_one_no_show_idx
      on cancellation_policy_tiers (cancellation_policy_version_id)
      where trigger_type = 'NO_SHOW'
  `.execute(db);

  await sql`
    create table rate_plan_cancellation_assignments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      rate_plan_id uuid not null,
      cancellation_policy_id uuid not null,
      effective_from date not null,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (rate_plan_id, effective_from),
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (cancellation_policy_id, property_id, organization_id)
        references cancellation_policies(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index rate_plan_cancellation_assignments_effective_idx
      on rate_plan_cancellation_assignments (rate_plan_id, effective_from desc)
  `.execute(db);

  await sql`
    create table guest_age_policies (
      property_id uuid primary key,
      organization_id uuid not null,
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table guest_age_policy_versions (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      infant_max_age integer check (infant_max_age is null or infant_max_age between 0 and 17),
      child_max_age integer not null check (child_max_age between 0 and 17),
      infants_count_towards_occupancy boolean not null default true,
      infants_count_towards_child_limit boolean not null default true,
      infants_charge_as_children boolean not null default false,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, version_number),
      unique (property_id, effective_from),
      foreign key (property_id, organization_id)
        references guest_age_policies(property_id, organization_id) on delete restrict,
      check (infant_max_age is null or infant_max_age < child_max_age)
    )
  `.execute(db);

  await sql`
    create index guest_age_policy_versions_effective_idx
      on guest_age_policy_versions (property_id, effective_from desc)
  `.execute(db);

  await sql`
    create table commercial_rule_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      entity_type text not null check (
        entity_type in (
          'COMMERCIAL_SETTINGS_VERSION',
          'TAX_POLICY',
          'TAX_POLICY_VERSION',
          'TAX_ASSIGNMENT',
          'FEE_POLICY',
          'FEE_POLICY_VERSION',
          'FEE_ASSIGNMENT',
          'CANCELLATION_POLICY',
          'CANCELLATION_POLICY_VERSION',
          'CANCELLATION_ASSIGNMENT',
          'GUEST_AGE_POLICY_VERSION'
        )
      ),
      entity_id uuid not null,
      event_type text not null,
      details_json jsonb not null default '{}'::jsonb,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index commercial_rule_events_scope_idx
      on commercial_rule_events (property_id, entity_type, entity_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_commercial_immutable_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'commercial rule snapshots are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create or replace function protect_sealable_commercial_version()
    returns trigger
    language plpgsql
    as $$
    begin
      if TG_OP = 'INSERT' then
        if NEW.sealed_at is not null then
          raise exception 'commercial versions must be inserted unsealed';
        end if;
        return NEW;
      end if;

      if TG_OP = 'DELETE' then
        raise exception 'commercial rule snapshots are immutable';
      end if;

      if
        OLD.sealed_at is null
        and NEW.sealed_at is not null
        and (to_jsonb(NEW) - 'sealed_at') = (to_jsonb(OLD) - 'sealed_at')
      then
        return NEW;
      end if;

      raise exception 'commercial rule snapshots are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create or replace function guard_tax_component_snapshot()
    returns trigger
    language plpgsql
    as $$
    begin
      if TG_OP <> 'INSERT' then
        raise exception 'commercial rule snapshots are immutable';
      end if;

      if exists (
        select 1
        from commercial_tax_policy_versions v
        where v.id = NEW.tax_policy_version_id
          and v.property_id = NEW.property_id
          and v.organization_id = NEW.organization_id
          and v.sealed_at is not null
      ) then
        raise exception 'sealed tax policy versions cannot accept components';
      end if;

      return NEW;
    end;
    $$
  `.execute(db);

  await sql`
    create or replace function validate_tax_version_seal()
    returns trigger
    language plpgsql
    as $$
    declare
      component_count integer;
      total_basis_points integer;
    begin
      if OLD.sealed_at is null and NEW.sealed_at is not null then
        select count(*), coalesce(sum(rate_basis_points), 0)
          into component_count, total_basis_points
        from commercial_tax_components
        where tax_policy_version_id = NEW.id;

        if component_count = 0 then
          raise exception 'tax policy version requires at least one component before sealing';
        end if;

        if total_basis_points > 10000 then
          raise exception 'tax policy component rates cannot exceed 100 percent in total';
        end if;
      end if;
      return NEW;
    end;
    $$
  `.execute(db);

  await sql`
    create or replace function guard_cancellation_tier_snapshot()
    returns trigger
    language plpgsql
    as $$
    begin
      if TG_OP <> 'INSERT' then
        raise exception 'commercial rule snapshots are immutable';
      end if;

      if exists (
        select 1
        from cancellation_policy_versions v
        where v.id = NEW.cancellation_policy_version_id
          and v.property_id = NEW.property_id
          and v.organization_id = NEW.organization_id
          and v.sealed_at is not null
      ) then
        raise exception 'sealed cancellation policy versions cannot accept tiers';
      end if;

      return NEW;
    end;
    $$
  `.execute(db);

  await sql`
    create or replace function validate_cancellation_version_seal()
    returns trigger
    language plpgsql
    as $$
    begin
      if OLD.sealed_at is null and NEW.sealed_at is not null then
        if not exists (
          select 1
          from cancellation_policy_tiers
          where cancellation_policy_version_id = NEW.id
            and trigger_type = 'CANCELLATION'
            and minimum_minutes_before_arrival = 0
        ) then
          raise exception 'cancellation policy requires a zero-minute cancellation tier before sealing';
        end if;

        if not exists (
          select 1
          from cancellation_policy_tiers
          where cancellation_policy_version_id = NEW.id
            and trigger_type = 'NO_SHOW'
        ) then
          raise exception 'cancellation policy requires a no-show tier before sealing';
        end if;
      end if;
      return NEW;
    end;
    $$
  `.execute(db);

  for (const table of ["commercial_tax_policy_versions", "cancellation_policy_versions"]) {
    await sql
      .raw(
        `
        create trigger ${table}_protect_version
          before insert or update or delete on ${table}
          for each row execute function protect_sealable_commercial_version()
      `
      )
      .execute(db);
  }

  await sql`
    create trigger commercial_tax_policy_versions_validate_seal
      before update on commercial_tax_policy_versions
      for each row execute function validate_tax_version_seal()
  `.execute(db);

  await sql`
    create trigger commercial_tax_components_guard
      before insert or update or delete on commercial_tax_components
      for each row execute function guard_tax_component_snapshot()
  `.execute(db);

  await sql`
    create trigger cancellation_policy_versions_validate_seal
      before update on cancellation_policy_versions
      for each row execute function validate_cancellation_version_seal()
  `.execute(db);

  await sql`
    create trigger cancellation_policy_tiers_guard
      before insert or update or delete on cancellation_policy_tiers
      for each row execute function guard_cancellation_tier_snapshot()
  `.execute(db);

  for (const table of [
    "property_commercial_setting_versions",
    "commercial_tax_assignments",
    "commercial_fee_policy_versions",
    "commercial_fee_assignments",
    "rate_plan_cancellation_assignments",
    "guest_age_policy_versions",
    "commercial_rule_events"
  ]) {
    await sql
      .raw(
        `
        create trigger ${table}_no_mutation
          before update or delete on ${table}
          for each row execute function prevent_commercial_immutable_mutation()
      `
      )
      .execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "commercial_rule_events",
    "guest_age_policy_versions",
    "rate_plan_cancellation_assignments",
    "commercial_fee_assignments",
    "commercial_fee_policy_versions",
    "commercial_tax_assignments",
    "property_commercial_setting_versions"
  ]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`
    drop trigger if exists cancellation_policy_tiers_guard
      on cancellation_policy_tiers
  `.execute(db);
  await sql`
    drop trigger if exists cancellation_policy_versions_validate_seal
      on cancellation_policy_versions
  `.execute(db);
  await sql`
    drop trigger if exists cancellation_policy_versions_protect_version
      on cancellation_policy_versions
  `.execute(db);
  await sql`
    drop trigger if exists commercial_tax_components_guard
      on commercial_tax_components
  `.execute(db);
  await sql`
    drop trigger if exists commercial_tax_policy_versions_validate_seal
      on commercial_tax_policy_versions
  `.execute(db);
  await sql`
    drop trigger if exists commercial_tax_policy_versions_protect_version
      on commercial_tax_policy_versions
  `.execute(db);

  await sql`drop function if exists validate_cancellation_version_seal()`.execute(db);
  await sql`drop function if exists guard_cancellation_tier_snapshot()`.execute(db);
  await sql`drop function if exists validate_tax_version_seal()`.execute(db);
  await sql`drop function if exists guard_tax_component_snapshot()`.execute(db);
  await sql`drop function if exists protect_sealable_commercial_version()`.execute(db);
  await sql`drop function if exists prevent_commercial_immutable_mutation()`.execute(db);

  await sql`drop table if exists commercial_rule_events`.execute(db);
  await sql`drop table if exists guest_age_policy_versions`.execute(db);
  await sql`drop table if exists guest_age_policies`.execute(db);
  await sql`drop table if exists rate_plan_cancellation_assignments`.execute(db);
  await sql`drop table if exists cancellation_policy_tiers`.execute(db);
  await sql`drop table if exists cancellation_policy_versions`.execute(db);
  await sql`drop table if exists cancellation_policies`.execute(db);
  await sql`drop table if exists commercial_fee_assignments`.execute(db);
  await sql`drop table if exists commercial_fee_policy_versions`.execute(db);
  await sql`drop table if exists commercial_fee_policies`.execute(db);
  await sql`drop table if exists commercial_tax_assignments`.execute(db);
  await sql`drop table if exists commercial_tax_components`.execute(db);
  await sql`drop table if exists commercial_tax_policy_versions`.execute(db);
  await sql`drop table if exists commercial_tax_policies`.execute(db);
  await sql`drop table if exists property_commercial_setting_versions`.execute(db);
  await sql`drop table if exists property_commercial_settings`.execute(db);
}
