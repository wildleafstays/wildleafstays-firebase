import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table rate_plans (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null,
      name text not null,
      description text,
      meal_plan_code text not null
        check (meal_plan_code in ('EP', 'CP', 'MAP', 'AP', 'CUSTOM')),
      currency_code char(3) not null,
      status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'INACTIVE')),
      created_by_user_id uuid references users(id) on delete restrict,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index rate_plans_property_status_idx
      on rate_plans (property_id, status, code)
  `.execute(db);

  await sql`
    create table rate_plan_products (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      rate_plan_id uuid not null,
      product_type text not null
        check (product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      room_category_id uuid,
      base_rate_minor integer not null check (base_rate_minor >= 0),
      floor_rate_minor integer not null check (floor_rate_minor >= 0),
      ceiling_rate_minor integer not null check (ceiling_rate_minor >= 0),
      included_adults integer not null check (included_adults >= 1),
      included_children integer not null default 0 check (included_children >= 0),
      max_adults integer not null check (max_adults >= 1),
      max_children integer not null default 0 check (max_children >= 0),
      max_occupancy integer not null check (max_occupancy >= 1),
      extra_adult_minor integer not null default 0 check (extra_adult_minor >= 0),
      extra_child_minor integer not null default 0 check (extra_child_minor >= 0),
      status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'INACTIVE')),
      created_by_user_id uuid references users(id) on delete restrict,
      updated_by_user_id uuid references users(id) on delete restrict,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique nulls not distinct (rate_plan_id, product_type, room_category_id),
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      check (
        (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (product_type = 'FULL_PROPERTY' and room_category_id is null)
      ),
      check (floor_rate_minor <= base_rate_minor),
      check (base_rate_minor <= ceiling_rate_minor),
      check (included_adults <= max_adults),
      check (included_children <= max_children),
      check (included_adults + included_children <= max_occupancy),
      check (max_adults + max_children >= max_occupancy)
    )
  `.execute(db);

  await sql`
    create index rate_plan_products_property_idx
      on rate_plan_products (property_id, rate_plan_id, status)
  `.execute(db);

  await sql`
    create table rate_calendar_days (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      rate_product_id uuid not null,
      stay_date date not null,
      rate_minor integer not null check (rate_minor >= 0),
      extra_adult_minor integer,
      extra_child_minor integer,
      minimum_stay integer not null default 1
        check (minimum_stay >= 1 and minimum_stay <= 365),
      maximum_stay integer
        check (maximum_stay is null or (maximum_stay >= 1 and maximum_stay <= 365)),
      closed_to_arrival boolean not null default false,
      closed_to_departure boolean not null default false,
      stop_sell boolean not null default false,
      source text not null default 'MANUAL'
        check (source in ('MANUAL', 'REVENUE', 'SYSTEM')),
      updated_by_user_id uuid references users(id) on delete restrict,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (rate_product_id, stay_date),
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict,
      check (extra_adult_minor is null or extra_adult_minor >= 0),
      check (extra_child_minor is null or extra_child_minor >= 0),
      check (maximum_stay is null or maximum_stay >= minimum_stay)
    )
  `.execute(db);

  await sql`
    create index rate_calendar_days_product_date_idx
      on rate_calendar_days (rate_product_id, stay_date)
  `.execute(db);

  await sql`
    create table rate_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      property_id uuid not null,
      rate_plan_id uuid,
      rate_product_id uuid,
      stay_date date,
      event_type text not null check (
        event_type in (
          'RATE_PLAN_CREATED',
          'RATE_PRODUCT_CREATED',
          'RATE_PRODUCT_UPDATED',
          'RATE_CALENDAR_DAY_CREATED',
          'RATE_CALENDAR_DAY_UPDATED'
        )
      ),
      details_json jsonb not null default '{}'::jsonb,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index rate_events_scope_idx
      on rate_events (property_id, rate_plan_id, rate_product_id, stay_date, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_rate_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'rate_events is append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger rate_events_no_update
      before update or delete on rate_events
      for each row execute function prevent_rate_event_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists rate_events_no_update on rate_events`.execute(db);
  await sql`drop function if exists prevent_rate_event_mutation()`.execute(db);
  await sql`drop table if exists rate_events`.execute(db);
  await sql`drop table if exists rate_calendar_days`.execute(db);
  await sql`drop table if exists rate_plan_products`.execute(db);
  await sql`drop table if exists rate_plans`.execute(db);
}
