import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quotes (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      quote_reference text not null,
      rate_plan_id uuid not null,
      rate_plan_code text not null,
      rate_plan_name text not null,
      meal_plan_code text not null,
      rate_product_id uuid not null,
      rate_product_version integer not null check (rate_product_version >= 1),
      product_type text not null check (product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      product_label text not null,
      room_category_id uuid,
      arrival_date date not null,
      departure_date date not null,
      quantity integer not null check (quantity >= 1 and quantity <= 20),
      currency_code char(3) not null,
      accommodation_minor integer not null check (accommodation_minor >= 0),
      extra_guest_minor integer not null check (extra_guest_minor >= 0),
      tax_minor integer not null default 0 check (tax_minor >= 0),
      fee_minor integer not null default 0 check (fee_minor >= 0),
      total_minor integer not null check (total_minor >= 0),
      arrival_closed_to_arrival boolean not null,
      departure_closed_to_departure boolean not null,
      minimum_stay_snapshot integer not null check (minimum_stay_snapshot >= 1),
      maximum_stay_snapshot integer,
      commercial_status text not null
        check (commercial_status in ('PRE_TAX_ONLY')),
      hold_eligible boolean not null default false,
      expires_at timestamptz not null,
      created_by_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, quote_reference),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (rate_plan_id, property_id, organization_id)
        references rate_plans(id, property_id, organization_id) on delete restrict,
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      check (departure_date > arrival_date),
      check (maximum_stay_snapshot is null or maximum_stay_snapshot >= minimum_stay_snapshot),
      check (
        (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (product_type = 'FULL_PROPERTY' and room_category_id is null)
      ),
      check (total_minor = accommodation_minor + extra_guest_minor + tax_minor + fee_minor),
      check (commercial_status <> 'PRE_TAX_ONLY' or hold_eligible = false)
    )
  `.execute(db);

  await sql`
    create index quotes_property_created_idx
      on quotes (property_id, created_at desc)
  `.execute(db);

  await sql`
    create index quotes_expiry_idx
      on quotes (expires_at)
  `.execute(db);

  await sql`
    create table quote_units (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      unit_index integer not null check (unit_index >= 1 and unit_index <= 20),
      adults integer not null check (adults >= 1),
      child_ages_json jsonb not null default '[]'::jsonb,
      included_adults integer not null check (included_adults >= 1),
      included_children integer not null check (included_children >= 0),
      max_adults integer not null check (max_adults >= 1),
      max_children integer not null check (max_children >= 0),
      max_occupancy integer not null check (max_occupancy >= 1),
      extra_adults integer not null check (extra_adults >= 0),
      extra_children integer not null check (extra_children >= 0),
      created_at timestamptz not null default now(),
      unique (quote_id, unit_index),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table quote_nights (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      stay_date date not null,
      nightly_unit_rate_minor integer not null check (nightly_unit_rate_minor >= 0),
      accommodation_minor integer not null check (accommodation_minor >= 0),
      extra_adult_minor integer not null check (extra_adult_minor >= 0),
      extra_child_minor integer not null check (extra_child_minor >= 0),
      extra_guest_minor integer not null check (extra_guest_minor >= 0),
      night_total_minor integer not null check (night_total_minor >= 0),
      sellable_quantity_snapshot integer not null check (sellable_quantity_snapshot >= 0),
      rate_source text not null,
      rate_override_version integer,
      minimum_stay integer not null check (minimum_stay >= 1),
      maximum_stay integer,
      closed_to_arrival boolean not null,
      closed_to_departure boolean not null,
      stop_sell boolean not null,
      created_at timestamptz not null default now(),
      unique (quote_id, stay_date),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      check (rate_override_version is null or rate_override_version >= 1),
      check (maximum_stay is null or maximum_stay >= minimum_stay),
      check (night_total_minor = accommodation_minor + extra_guest_minor)
    )
  `.execute(db);

  await sql`
    create table quote_events (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      event_type text not null check (event_type in ('QUOTE_CREATED')),
      details_json jsonb not null default '{}'::jsonb,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create or replace function prevent_quote_snapshot_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'quote snapshots are immutable';
    end;
    $$
  `.execute(db);

  for (const table of ["quotes", "quote_units", "quote_nights", "quote_events"]) {
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
  for (const table of ["quote_events", "quote_nights", "quote_units", "quotes"]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }
  await sql`drop function if exists prevent_quote_snapshot_mutation()`.execute(db);
  await sql`drop table if exists quote_events`.execute(db);
  await sql`drop table if exists quote_nights`.execute(db);
  await sql`drop table if exists quote_units`.execute(db);
  await sql`drop table if exists quotes`.execute(db);
}
