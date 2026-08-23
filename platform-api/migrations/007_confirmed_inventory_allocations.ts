import { sql, type Kysely } from "kysely";

async function replaceInventoryEventTypeConstraint(
  db: Kysely<unknown>,
  includeAllocationEvents: boolean
): Promise<void> {
  await sql`
    do $$
    declare
      constraint_name text;
    begin
      for constraint_name in
        select conname
        from pg_constraint
        where conrelid = 'inventory_events'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%event_type%'
      loop
        execute format(
          'alter table inventory_events drop constraint %I',
          constraint_name
        );
      end loop;
    end;
    $$
  `.execute(db);

  if (includeAllocationEvents) {
    await sql`
      alter table inventory_events
        add constraint inventory_events_event_type_check_v2
        check (
          event_type in (
            'BUCKET_MATERIALIZED',
            'CONTROL_CHANGED',
            'BLOCK_CREATED',
            'BLOCK_RELEASED',
            'CAPACITY_REFRESHED',
            'HOLD_CREATED',
            'HOLD_RELEASED',
            'HOLD_EXPIRED',
            'ALLOCATION_CONFIRMED',
            'ALLOCATION_RELEASED',
            'BOOKING_CONFIRMED',
            'BOOKING_CANCELLED'
          )
        )
    `.execute(db);
  } else {
    // Historical allocation events are immutable. On rollback, restore the old
    // write constraint as NOT VALID so existing Phase 3C history remains legal
    // while new writes are still checked against the pre-3C event set.
    await sql`
      alter table inventory_events
        add constraint inventory_events_event_type_check
        check (
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
        ) not valid
    `.execute(db);
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await replaceInventoryEventTypeConstraint(db, true);

  await sql`
    create table inventory_allocations (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      hold_id uuid not null,
      confirmation_reference text not null,
      start_date date not null,
      end_date date not null,
      status text not null default 'CONFIRMED'
        check (status in ('CONFIRMED', 'RELEASED')),
      confirmed_by_user_id uuid references users(id) on delete restrict,
      confirmed_at timestamptz not null default now(),
      released_by_user_id uuid references users(id) on delete restrict,
      released_at timestamptz,
      release_reason text,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (hold_id),
      unique (property_id, confirmation_reference),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (hold_id, property_id, organization_id)
        references inventory_holds(id, property_id, organization_id) on delete restrict,
      check (end_date > start_date),
      check (
        (status = 'CONFIRMED'
          and released_at is null
          and released_by_user_id is null
          and release_reason is null)
        or
        (status = 'RELEASED'
          and released_at is not null
          and release_reason is not null)
      )
    )
  `.execute(db);

  await sql`
    create index inventory_allocations_property_status_idx
      on inventory_allocations (property_id, status, confirmed_at desc)
  `.execute(db);

  await sql`
    create table inventory_allocation_items (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      allocation_id uuid not null,
      source_hold_item_id uuid not null,
      bucket_type text not null
        check (bucket_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      room_category_id uuid,
      quantity integer not null check (quantity > 0),
      created_at timestamptz not null default now(),
      unique (id, allocation_id, property_id, organization_id),
      unique (allocation_id, source_hold_item_id),
      foreign key (allocation_id, property_id, organization_id)
        references inventory_allocations(id, property_id, organization_id) on delete restrict,
      foreign key (source_hold_item_id)
        references inventory_hold_items(id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      check (
        (bucket_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (bucket_type = 'FULL_PROPERTY' and room_category_id is null and quantity = 1)
      )
    )
  `.execute(db);

  await sql`
    create index inventory_allocation_items_allocation_idx
      on inventory_allocation_items (allocation_id)
  `.execute(db);

  await sql`
    create table inventory_allocation_nights (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      allocation_id uuid not null,
      allocation_item_id uuid not null,
      source_hold_night_id uuid not null,
      bucket_id uuid not null,
      stay_date date not null,
      quantity integer not null check (quantity > 0),
      created_at timestamptz not null default now(),
      unique (allocation_item_id, stay_date),
      unique (source_hold_night_id),
      foreign key (allocation_id, property_id, organization_id)
        references inventory_allocations(id, property_id, organization_id) on delete restrict,
      foreign key (allocation_item_id, allocation_id, property_id, organization_id)
        references inventory_allocation_items(
          id,
          allocation_id,
          property_id,
          organization_id
        ) on delete restrict,
      foreign key (source_hold_night_id)
        references inventory_hold_nights(id) on delete restrict,
      foreign key (bucket_id, property_id, organization_id)
        references inventory_daily_buckets(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index inventory_allocation_nights_allocation_idx
      on inventory_allocation_nights (allocation_id, stay_date)
  `.execute(db);

  await sql`
    create index inventory_allocation_nights_bucket_idx
      on inventory_allocation_nights (bucket_id, stay_date)
  `.execute(db);

  await sql`
    create or replace function prevent_inventory_allocation_detail_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'inventory allocation detail rows are append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger inventory_allocation_items_no_update
      before update or delete on inventory_allocation_items
      for each row execute function prevent_inventory_allocation_detail_mutation()
  `.execute(db);

  await sql`
    create trigger inventory_allocation_nights_no_update
      before update or delete on inventory_allocation_nights
      for each row execute function prevent_inventory_allocation_detail_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists inventory_allocation_nights_no_update
      on inventory_allocation_nights
  `.execute(db);

  await sql`
    drop trigger if exists inventory_allocation_items_no_update
      on inventory_allocation_items
  `.execute(db);

  await sql`
    drop function if exists prevent_inventory_allocation_detail_mutation()
  `.execute(db);

  await sql`drop table if exists inventory_allocation_nights`.execute(db);
  await sql`drop table if exists inventory_allocation_items`.execute(db);
  await sql`drop table if exists inventory_allocations`.execute(db);

  await replaceInventoryEventTypeConstraint(db, false);
}
