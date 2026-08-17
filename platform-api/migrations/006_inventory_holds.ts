import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table inventory_holds (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'RELEASED', 'EXPIRED')),
      start_date date not null,
      end_date date not null,
      expires_at timestamptz not null,
      client_reference text,
      created_by_user_id uuid references users(id) on delete restrict,
      released_by_user_id uuid references users(id) on delete restrict,
      released_at timestamptz,
      release_reason text,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (end_date > start_date),
      check (
        (status = 'ACTIVE' and released_at is null and release_reason is null)
        or
        (status in ('RELEASED', 'EXPIRED') and released_at is not null)
      )
    )
  `.execute(db);

  await sql`
    create index inventory_holds_property_status_expiry_idx
      on inventory_holds (property_id, status, expires_at)
  `.execute(db);

  await sql`
    create index inventory_holds_due_idx
      on inventory_holds (expires_at, property_id)
      where status = 'ACTIVE'
  `.execute(db);

  await sql`
    create table inventory_hold_items (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      hold_id uuid not null,
      bucket_type text not null
        check (bucket_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      room_category_id uuid,
      quantity integer not null check (quantity > 0),
      created_at timestamptz not null default now(),
      unique (id, hold_id, property_id, organization_id),
      unique nulls not distinct (hold_id, bucket_type, room_category_id),
      foreign key (hold_id, property_id, organization_id)
        references inventory_holds(id, property_id, organization_id) on delete restrict,
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
    create index inventory_hold_items_hold_idx
      on inventory_hold_items (hold_id)
  `.execute(db);

  await sql`
    create table inventory_hold_nights (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      hold_id uuid not null,
      hold_item_id uuid not null,
      bucket_id uuid not null,
      stay_date date not null,
      quantity integer not null check (quantity > 0),
      created_at timestamptz not null default now(),
      unique (hold_item_id, stay_date),
      foreign key (hold_id, property_id, organization_id)
        references inventory_holds(id, property_id, organization_id) on delete restrict,
      foreign key (hold_item_id, hold_id, property_id, organization_id)
        references inventory_hold_items(id, hold_id, property_id, organization_id) on delete restrict,
      foreign key (bucket_id, property_id, organization_id)
        references inventory_daily_buckets(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index inventory_hold_nights_hold_idx
      on inventory_hold_nights (hold_id, stay_date)
  `.execute(db);

  await sql`
    create index inventory_hold_nights_bucket_idx
      on inventory_hold_nights (bucket_id, stay_date)
  `.execute(db);

  await sql`
    create or replace function prevent_inventory_hold_detail_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'inventory hold allocation details are append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger inventory_hold_items_no_update
      before update or delete on inventory_hold_items
      for each row execute function prevent_inventory_hold_detail_mutation()
  `.execute(db);

  await sql`
    create trigger inventory_hold_nights_no_update
      before update or delete on inventory_hold_nights
      for each row execute function prevent_inventory_hold_detail_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists inventory_hold_nights_no_update
      on inventory_hold_nights
  `.execute(db);
  await sql`
    drop trigger if exists inventory_hold_items_no_update
      on inventory_hold_items
  `.execute(db);
  await sql`drop function if exists prevent_inventory_hold_detail_mutation()`.execute(db);
  await sql`drop table if exists inventory_hold_nights`.execute(db);
  await sql`drop table if exists inventory_hold_items`.execute(db);
  await sql`drop table if exists inventory_holds`.execute(db);
}
