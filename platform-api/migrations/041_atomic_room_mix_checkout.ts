import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table room_mix_quotes (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      room_mix_reference text not null,
      arrival_date date not null,
      departure_date date not null,
      quantity integer not null check (quantity between 2 and 20),
      currency_code char(3) not null,
      gross_accommodation_minor integer not null check (gross_accommodation_minor >= 0),
      gross_extra_guest_minor integer not null check (gross_extra_guest_minor >= 0),
      accommodation_discount_minor integer not null check (accommodation_discount_minor >= 0),
      extra_guest_discount_minor integer not null check (extra_guest_discount_minor >= 0),
      discount_minor integer not null check (discount_minor >= 0),
      discounted_accommodation_minor integer not null check (discounted_accommodation_minor >= 0),
      discounted_extra_guest_minor integer not null check (discounted_extra_guest_minor >= 0),
      inclusive_fee_minor integer not null check (inclusive_fee_minor >= 0),
      exclusive_fee_minor integer not null check (exclusive_fee_minor >= 0),
      fee_minor integer not null check (fee_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      exclusive_tax_minor integer not null check (exclusive_tax_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      total_minor integer not null check (total_minor >= 0),
      expires_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, room_mix_reference),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (departure_date > arrival_date),
      check (expires_at > created_at),
      check (discount_minor = accommodation_discount_minor + extra_guest_discount_minor),
      check (
        discounted_accommodation_minor =
          gross_accommodation_minor - accommodation_discount_minor
      ),
      check (
        discounted_extra_guest_minor =
          gross_extra_guest_minor - extra_guest_discount_minor
      ),
      check (fee_minor = inclusive_fee_minor + exclusive_fee_minor),
      check (tax_minor = inclusive_tax_minor + exclusive_tax_minor),
      check (
        total_minor =
          discounted_accommodation_minor +
          discounted_extra_guest_minor +
          exclusive_fee_minor +
          exclusive_tax_minor
      )
    )
  `.execute(db);

  await sql`
    create table room_mix_quote_items (
      id uuid primary key default gen_random_uuid(),
      room_mix_quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      item_index integer not null check (item_index between 1 and 20),
      quote_id uuid not null unique,
      quote_reference text not null,
      rate_product_id uuid not null,
      room_category_id uuid not null,
      quantity integer not null check (quantity between 1 and 20),
      total_minor integer not null check (total_minor >= 0),
      created_at timestamptz not null default now(),
      unique (room_mix_quote_id, item_index),
      unique (id, room_mix_quote_id, quote_id, property_id, organization_id),
      foreign key (room_mix_quote_id, property_id, organization_id)
        references room_mix_quotes(id, property_id, organization_id) on delete restrict,
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (rate_product_id, property_id, organization_id)
        references rate_plan_products(id, property_id, organization_id) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table room_mix_inventory_holds (
      id uuid primary key default gen_random_uuid(),
      room_mix_quote_id uuid not null unique,
      inventory_hold_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (
        id,
        room_mix_quote_id,
        inventory_hold_id,
        property_id,
        organization_id
      ),
      foreign key (room_mix_quote_id, property_id, organization_id)
        references room_mix_quotes(id, property_id, organization_id) on delete restrict,
      foreign key (inventory_hold_id, property_id, organization_id)
        references inventory_holds(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  for (const table of ["room_mix_quotes", "room_mix_quote_items", "room_mix_inventory_holds"]) {
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

  await sql`
    alter table reservations
      alter column quote_id drop not null,
      alter column quote_inventory_hold_id drop not null,
      add column room_mix_quote_id uuid
  `.execute(db);

  await sql`
    do $room_mix_constraints$
    declare
      constraint_row record;
    begin
      for constraint_row in
        select conname
        from pg_constraint
        where conrelid = 'reservations'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%product_type%'
      loop
        execute format('alter table reservations drop constraint %I', constraint_row.conname);
      end loop;
    end
    $room_mix_constraints$
  `.execute(db);

  await sql`
    alter table reservations
      add constraint reservations_product_type_v2_check
        check (product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY', 'ROOM_MIX')),
      add constraint reservations_product_shape_v2_check
        check (
          (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
          or
          (product_type = 'FULL_PROPERTY' and room_category_id is null and quantity = 1)
          or
          (product_type = 'ROOM_MIX' and room_category_id is null and quantity between 2 and 20)
        ),
      add constraint reservations_booking_source_v2_check
        check (
          (
            product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')
            and quote_id is not null
            and quote_inventory_hold_id is not null
            and room_mix_quote_id is null
          )
          or
          (
            product_type = 'ROOM_MIX'
            and quote_id is null
            and quote_inventory_hold_id is null
            and room_mix_quote_id is not null
          )
        ),
      add constraint reservations_room_mix_quote_key unique (room_mix_quote_id),
      add constraint reservations_room_mix_identity_key
        unique (id, room_mix_quote_id, property_id, organization_id),
      add constraint reservations_room_mix_quote_fkey
        foreign key (room_mix_quote_id, property_id, organization_id)
        references room_mix_quotes(id, property_id, organization_id) on delete restrict
  `.execute(db);

  await sql`
    create table reservation_room_mix_financial_snapshots (
      id uuid primary key default gen_random_uuid(),
      reservation_id uuid not null unique,
      room_mix_quote_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      room_mix_reference text not null,
      product_label text not null default 'Mixed rooms',
      arrival_date date not null,
      departure_date date not null,
      quantity integer not null check (quantity between 2 and 20),
      currency_code char(3) not null,
      gross_accommodation_minor integer not null check (gross_accommodation_minor >= 0),
      gross_extra_guest_minor integer not null check (gross_extra_guest_minor >= 0),
      accommodation_discount_minor integer not null check (accommodation_discount_minor >= 0),
      extra_guest_discount_minor integer not null check (extra_guest_discount_minor >= 0),
      discount_minor integer not null check (discount_minor >= 0),
      discounted_accommodation_minor integer not null check (discounted_accommodation_minor >= 0),
      discounted_extra_guest_minor integer not null check (discounted_extra_guest_minor >= 0),
      inclusive_fee_minor integer not null check (inclusive_fee_minor >= 0),
      exclusive_fee_minor integer not null check (exclusive_fee_minor >= 0),
      fee_minor integer not null check (fee_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      exclusive_tax_minor integer not null check (exclusive_tax_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      total_minor integer not null check (total_minor >= 0),
      created_at timestamptz not null default now(),
      foreign key (
        reservation_id,
        room_mix_quote_id,
        property_id,
        organization_id
      )
        references reservations(
          id,
          room_mix_quote_id,
          property_id,
          organization_id
        ) on delete restrict,
      foreign key (room_mix_quote_id, property_id, organization_id)
        references room_mix_quotes(id, property_id, organization_id) on delete restrict,
      check (departure_date > arrival_date),
      check (discount_minor = accommodation_discount_minor + extra_guest_discount_minor),
      check (
        discounted_accommodation_minor =
          gross_accommodation_minor - accommodation_discount_minor
      ),
      check (
        discounted_extra_guest_minor =
          gross_extra_guest_minor - extra_guest_discount_minor
      ),
      check (fee_minor = inclusive_fee_minor + exclusive_fee_minor),
      check (tax_minor = inclusive_tax_minor + exclusive_tax_minor),
      check (
        total_minor =
          discounted_accommodation_minor +
          discounted_extra_guest_minor +
          exclusive_fee_minor +
          exclusive_tax_minor
      )
    )
  `.execute(db);

  await sql`
    create trigger reservation_room_mix_financial_snapshots_no_mutation
      before update or delete on reservation_room_mix_financial_snapshots
      for each row execute function prevent_reservation_detail_mutation()
  `.execute(db);

  await sql`
    create or replace function protect_reservation_identity()
    returns trigger
    language plpgsql
    as $room_mix_identity$
    begin
      if tg_op = 'DELETE' then
        raise exception 'reservations cannot be deleted';
      end if;

      if (
        new.organization_id,
        new.property_id,
        new.reservation_reference,
        new.quote_id,
        new.quote_inventory_hold_id,
        new.room_mix_quote_id,
        new.inventory_hold_id,
        new.hold_expires_at,
        new.arrival_date,
        new.departure_date,
        new.product_type,
        new.room_category_id,
        new.quantity,
        new.currency_code,
        new.total_minor,
        new.created_by_user_id,
        new.source,
        new.request_id,
        new.correlation_id,
        new.created_at
      ) is distinct from (
        old.organization_id,
        old.property_id,
        old.reservation_reference,
        old.quote_id,
        old.quote_inventory_hold_id,
        old.room_mix_quote_id,
        old.inventory_hold_id,
        old.hold_expires_at,
        old.arrival_date,
        old.departure_date,
        old.product_type,
        old.room_category_id,
        old.quantity,
        old.currency_code,
        old.total_minor,
        old.created_by_user_id,
        old.source,
        old.request_id,
        old.correlation_id,
        old.created_at
      ) then
        raise exception 'reservation identity and accepted quote snapshot are immutable';
      end if;

      return new;
    end;
    $room_mix_identity$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $room_mix_rollback$
    begin
      if exists (select 1 from reservations where product_type = 'ROOM_MIX') then
        raise exception 'cannot roll back room-mix checkout while ROOM_MIX reservations exist';
      end if;
    end
    $room_mix_rollback$
  `.execute(db);

  await sql`
    drop trigger if exists reservation_room_mix_financial_snapshots_no_mutation
      on reservation_room_mix_financial_snapshots
  `.execute(db);
  await sql`drop table if exists reservation_room_mix_financial_snapshots`.execute(db);

  await sql`
    alter table reservations
      drop constraint if exists reservations_room_mix_quote_fkey,
      drop constraint if exists reservations_room_mix_identity_key,
      drop constraint if exists reservations_room_mix_quote_key,
      drop constraint if exists reservations_booking_source_v2_check,
      drop constraint if exists reservations_product_shape_v2_check,
      drop constraint if exists reservations_product_type_v2_check
  `.execute(db);

  await sql`
    alter table reservations
      drop column if exists room_mix_quote_id,
      alter column quote_id set not null,
      alter column quote_inventory_hold_id set not null,
      add constraint reservations_product_type_check
        check (product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      add constraint reservations_product_shape_check
        check (
          (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
          or
          (product_type = 'FULL_PROPERTY' and room_category_id is null and quantity = 1)
        )
  `.execute(db);

  await sql`
    create or replace function protect_reservation_identity()
    returns trigger
    language plpgsql
    as $reservation_identity_restore$
    begin
      if tg_op = 'DELETE' then
        raise exception 'reservations cannot be deleted';
      end if;

      if (
        new.organization_id,
        new.property_id,
        new.reservation_reference,
        new.quote_id,
        new.quote_inventory_hold_id,
        new.inventory_hold_id,
        new.hold_expires_at,
        new.arrival_date,
        new.departure_date,
        new.product_type,
        new.room_category_id,
        new.quantity,
        new.currency_code,
        new.total_minor,
        new.created_by_user_id,
        new.source,
        new.request_id,
        new.correlation_id,
        new.created_at
      ) is distinct from (
        old.organization_id,
        old.property_id,
        old.reservation_reference,
        old.quote_id,
        old.quote_inventory_hold_id,
        old.inventory_hold_id,
        old.hold_expires_at,
        old.arrival_date,
        old.departure_date,
        old.product_type,
        old.room_category_id,
        old.quantity,
        old.currency_code,
        old.total_minor,
        old.created_by_user_id,
        old.source,
        old.request_id,
        old.correlation_id,
        old.created_at
      ) then
        raise exception 'reservation identity and accepted quote snapshot are immutable';
      end if;

      return new;
    end;
    $reservation_identity_restore$
  `.execute(db);

  for (const table of ["room_mix_inventory_holds", "room_mix_quote_items", "room_mix_quotes"]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`drop table if exists room_mix_inventory_holds`.execute(db);
  await sql`drop table if exists room_mix_quote_items`.execute(db);
  await sql`drop table if exists room_mix_quotes`.execute(db);
}
