import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create extension if not exists btree_gist`.execute(db);

  await sql`
    create table inventory_daily_buckets (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      bucket_type text not null check (bucket_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      room_category_id uuid,
      stay_date date not null,
      capacity integer not null check (capacity >= 0),
      held_quantity integer not null default 0 check (held_quantity >= 0),
      confirmed_quantity integer not null default 0 check (confirmed_quantity >= 0),
      overbooking_limit integer not null default 0 check (overbooking_limit >= 0),
      stop_sell boolean not null default false,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique nulls not distinct (property_id, bucket_type, room_category_id, stay_date),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      check (
        (bucket_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (bucket_type = 'FULL_PROPERTY' and room_category_id is null)
      ),
      check (bucket_type = 'ROOM_CATEGORY' or overbooking_limit = 0),
      check (capacity + overbooking_limit >= held_quantity + confirmed_quantity)
    )
  `.execute(db);

  await sql`
    create index inventory_daily_buckets_property_date_idx
      on inventory_daily_buckets (property_id, stay_date, bucket_type)
  `.execute(db);

  await sql`
    create table inventory_blocks (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      scope_type text not null check (
        scope_type in ('PROPERTY', 'ROOM_CATEGORY', 'PHYSICAL_UNIT')
      ),
      room_category_id uuid,
      physical_unit_id uuid,
      block_type text not null check (
        block_type in (
          'MAINTENANCE',
          'RENOVATION',
          'OWNER_USE',
          'STAFF_USE',
          'REGULATORY_CLOSURE',
          'WILDLEAF_QUALITY',
          'MANUAL'
        )
      ),
      start_date date not null,
      end_date date not null,
      quantity integer not null default 1 check (quantity > 0),
      reason text not null,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED')),
      created_by_user_id uuid references users(id) on delete restrict,
      released_by_user_id uuid references users(id) on delete restrict,
      released_at timestamptz,
      release_reason text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      foreign key (physical_unit_id, property_id, organization_id)
        references physical_units(id, property_id, organization_id) on delete restrict,
      check (end_date > start_date),
      check (
        (scope_type = 'PROPERTY'
          and room_category_id is null
          and physical_unit_id is null
          and quantity = 1)
        or
        (scope_type = 'ROOM_CATEGORY'
          and room_category_id is not null
          and physical_unit_id is null)
        or
        (scope_type = 'PHYSICAL_UNIT'
          and room_category_id is not null
          and physical_unit_id is not null
          and quantity = 1)
      ),
      check (
        (status = 'ACTIVE' and released_at is null and released_by_user_id is null)
        or
        (status = 'RELEASED' and released_at is not null)
      )
    )
  `.execute(db);

  await sql`
    create index inventory_blocks_property_date_idx
      on inventory_blocks (property_id, start_date, end_date, status)
  `.execute(db);

  await sql`
    create index inventory_blocks_category_date_idx
      on inventory_blocks (room_category_id, start_date, end_date, status)
      where room_category_id is not null
  `.execute(db);

  await sql`
    alter table inventory_blocks
      add constraint inventory_blocks_no_overlapping_unit_blocks
      exclude using gist (
        physical_unit_id with =,
        daterange(start_date, end_date, '[)') with &&
      )
      where (scope_type = 'PHYSICAL_UNIT' and status = 'ACTIVE')
  `.execute(db);

  await sql`
    create table inventory_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organizations(id) on delete restrict,
      property_id uuid not null,
      room_category_id uuid,
      physical_unit_id uuid,
      stay_date date,
      event_type text not null check (
        event_type in (
          'BUCKET_MATERIALIZED',
          'CONTROL_CHANGED',
          'BLOCK_CREATED',
          'BLOCK_RELEASED',
          'CAPACITY_REFRESHED',
          'HOLD_CREATED',
          'HOLD_RELEASED',
          'HOLD_EXPIRED',
          'BOOKING_CONFIRMED',
          'BOOKING_CANCELLED'
        )
      ),
      quantity_delta integer not null default 0,
      details_json jsonb not null default '{}'::jsonb,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      foreign key (physical_unit_id, property_id, organization_id)
        references physical_units(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index inventory_events_scope_idx
      on inventory_events (property_id, room_category_id, stay_date, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_inventory_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'inventory_events is append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger inventory_events_no_update
      before update or delete on inventory_events
      for each row execute function prevent_inventory_event_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists inventory_events_no_update on inventory_events`.execute(db);
  await sql`drop function if exists prevent_inventory_event_mutation()`.execute(db);
  await sql`drop table if exists inventory_events`.execute(db);
  await sql`drop table if exists inventory_blocks`.execute(db);
  await sql`drop table if exists inventory_daily_buckets`.execute(db);
}
