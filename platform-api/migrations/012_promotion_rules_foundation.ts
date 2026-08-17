import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table property_promotion_settings (
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
    create table property_promotion_setting_versions (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      promotion_mode text not null check (promotion_mode in ('NO_PROMOTIONS', 'POLICIES')),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, version_number),
      unique (property_id, effective_from),
      foreign key (property_id, organization_id)
        references property_promotion_settings(property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_promotion_setting_versions_effective_idx
      on property_promotion_setting_versions (property_id, effective_from desc)
  `.execute(db);

  await sql`
    create table promotion_campaigns (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
      name text not null check (char_length(name) between 2 and 120),
      description text,
      promotion_kind text not null check (promotion_kind in ('AUTOMATIC', 'PROMO_CODE')),
      public_code text check (public_code is null or public_code ~ '^[A-Z0-9_-]{3,40}$'),
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
      current_version integer not null default 0 check (current_version >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, code),
      unique (property_id, public_code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (
        (promotion_kind = 'AUTOMATIC' and public_code is null)
        or
        (promotion_kind = 'PROMO_CODE' and public_code is not null)
      )
    )
  `.execute(db);

  await sql`
    create table promotion_campaign_versions (
      id uuid primary key default gen_random_uuid(),
      promotion_campaign_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      version_number integer not null check (version_number > 0),
      effective_from date not null,
      currency_code char(3) not null,
      booking_window_start date,
      booking_window_end date,
      arrival_window_start date,
      arrival_window_end date,
      minimum_stay_nights integer not null default 1 check (minimum_stay_nights between 1 and 365),
      minimum_spend_minor integer check (
        minimum_spend_minor is null or minimum_spend_minor between 0 and 100000000
      ),
      discount_type text not null check (discount_type in ('PERCENTAGE', 'FIXED_AMOUNT')),
      discount_value integer not null,
      maximum_discount_minor integer check (
        maximum_discount_minor is null or maximum_discount_minor between 1 and 100000000
      ),
      applies_to text not null check (
        applies_to in ('ACCOMMODATION', 'ACCOMMODATION_AND_EXTRA_GUEST')
      ),
      priority integer not null default 0 check (priority between 0 and 100000),
      stacking_mode text not null check (stacking_mode in ('EXCLUSIVE', 'STACKABLE')),
      stack_group text check (stack_group is null or stack_group ~ '^[A-Z0-9_-]{2,40}$'),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (promotion_campaign_id, version_number),
      unique (promotion_campaign_id, effective_from),
      foreign key (promotion_campaign_id, property_id, organization_id)
        references promotion_campaigns(id, property_id, organization_id) on delete restrict,
      check (
        (booking_window_start is null and booking_window_end is null)
        or
        (booking_window_start is not null and booking_window_end is not null and booking_window_end >= booking_window_start)
      ),
      check (
        (arrival_window_start is null and arrival_window_end is null)
        or
        (arrival_window_start is not null and arrival_window_end is not null and arrival_window_end >= arrival_window_start)
      ),
      check (
        (discount_type = 'PERCENTAGE' and discount_value between 1 and 10000)
        or
        (discount_type = 'FIXED_AMOUNT' and discount_value between 1 and 100000000)
      ),
      check (discount_type <> 'FIXED_AMOUNT' or maximum_discount_minor is null),
      check (stacking_mode <> 'EXCLUSIVE' or stack_group is null)
    )
  `.execute(db);

  await sql`
    create index promotion_campaign_versions_effective_idx
      on promotion_campaign_versions (promotion_campaign_id, effective_from desc)
  `.execute(db);

  await sql`
    create table promotion_assignments (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      promotion_campaign_id uuid not null,
      scope_type text not null check (scope_type in ('PROPERTY', 'RATE_PLAN', 'RATE_PRODUCT')),
      rate_plan_id uuid,
      rate_product_id uuid,
      effective_from date not null,
      enabled boolean not null,
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      unique nulls not distinct (
        promotion_campaign_id,
        scope_type,
        rate_plan_id,
        rate_product_id,
        effective_from
      ),
      foreign key (promotion_campaign_id, property_id, organization_id)
        references promotion_campaigns(id, property_id, organization_id) on delete restrict,
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
    create index promotion_assignments_effective_idx
      on promotion_assignments (
        property_id,
        promotion_campaign_id,
        scope_type,
        effective_from desc
      )
  `.execute(db);

  await sql`
    create table promotion_rule_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      entity_type text not null check (
        entity_type in (
          'PROMOTION_SETTINGS_VERSION',
          'PROMOTION_CAMPAIGN',
          'PROMOTION_CAMPAIGN_VERSION',
          'PROMOTION_ASSIGNMENT'
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
    create index promotion_rule_events_scope_idx
      on promotion_rule_events (property_id, entity_type, entity_id, created_at desc)
  `.execute(db);

  for (const table of [
    "property_promotion_setting_versions",
    "promotion_campaign_versions",
    "promotion_assignments",
    "promotion_rule_events"
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
    "promotion_rule_events",
    "promotion_assignments",
    "promotion_campaign_versions",
    "property_promotion_setting_versions"
  ]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`drop table if exists promotion_rule_events`.execute(db);
  await sql`drop table if exists promotion_assignments`.execute(db);
  await sql`drop table if exists promotion_campaign_versions`.execute(db);
  await sql`drop table if exists promotion_campaigns`.execute(db);
  await sql`drop table if exists property_promotion_setting_versions`.execute(db);
  await sql`drop table if exists property_promotion_settings`.execute(db);
}
