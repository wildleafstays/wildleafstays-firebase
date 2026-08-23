import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table quote_inventory_holds
      add constraint quote_inventory_holds_reservation_link_key
      unique (id, quote_id, inventory_hold_id, property_id, organization_id)
  `.execute(db);

  await sql`
    create table reservations (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_reference text not null,
      quote_id uuid not null unique,
      quote_inventory_hold_id uuid not null unique,
      inventory_hold_id uuid not null unique,
      status text not null default 'HELD'
        check (
          status in (
            'HELD',
            'PAYMENT_PENDING',
            'CONFIRMED',
            'CHECKED_IN',
            'CHECKED_OUT',
            'CANCELLED',
            'EXPIRED',
            'NO_SHOW'
          )
        ),
      hold_expires_at timestamptz not null,
      arrival_date date not null,
      departure_date date not null,
      product_type text not null check (product_type in ('ROOM_CATEGORY', 'FULL_PROPERTY')),
      room_category_id uuid,
      quantity integer not null check (quantity between 1 and 20),
      currency_code char(3) not null,
      total_minor integer not null check (total_minor >= 0),
      created_by_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (id, quote_id, property_id, organization_id),
      unique (property_id, reservation_reference),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (
        quote_inventory_hold_id,
        quote_id,
        inventory_hold_id,
        property_id,
        organization_id
      )
        references quote_inventory_holds(
          id,
          quote_id,
          inventory_hold_id,
          property_id,
          organization_id
        ) on delete restrict,
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      check (departure_date > arrival_date),
      check (hold_expires_at > created_at),
      check (
        (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (product_type = 'FULL_PROPERTY' and room_category_id is null and quantity = 1)
      )
    )
  `.execute(db);

  await sql`
    create index reservations_property_status_arrival_idx
      on reservations (property_id, status, arrival_date)
  `.execute(db);

  await sql`
    create index reservations_hold_expiry_idx
      on reservations (hold_expires_at)
      where status in ('HELD', 'PAYMENT_PENDING')
  `.execute(db);

  await sql`
    create table reservation_financial_snapshots (
      id uuid primary key default gen_random_uuid(),
      reservation_id uuid not null unique,
      quote_id uuid not null unique,
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
      quantity integer not null check (quantity between 1 and 20),
      commercial_status text not null check (commercial_status = 'COMMERCIAL_RULES_APPLIED'),
      promotion_status text not null check (promotion_status = 'EVALUATED'),
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
      foreign key (reservation_id, quote_id, property_id, organization_id)
        references reservations(id, quote_id, property_id, organization_id) on delete restrict,
      foreign key (quote_id)
        references quote_promotion_snapshots(quote_id) on delete restrict,
      check (departure_date > arrival_date),
      check (
        (product_type = 'ROOM_CATEGORY' and room_category_id is not null)
        or
        (product_type = 'FULL_PROPERTY' and room_category_id is null and quantity = 1)
      ),
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
    create table reservation_lead_guest_snapshots (
      id uuid primary key default gen_random_uuid(),
      reservation_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      guest_name text not null,
      email text,
      phone_e164 text,
      created_at timestamptz not null default now(),
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      check (length(btrim(guest_name)) between 1 and 160),
      check (email is null or length(email) between 3 and 320),
      check (phone_e164 is null or phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
      check (email is not null or phone_e164 is not null)
    )
  `.execute(db);

  await sql`
    create table reservation_status_history (
      id uuid primary key default gen_random_uuid(),
      reservation_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      sequence_number integer not null check (sequence_number >= 1),
      from_status text,
      to_status text not null,
      reason text not null,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (reservation_id, sequence_number),
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      check (
        from_status is null
        or from_status in (
          'HELD',
          'PAYMENT_PENDING',
          'CONFIRMED',
          'CHECKED_IN',
          'CHECKED_OUT',
          'CANCELLED',
          'EXPIRED',
          'NO_SHOW'
        )
      ),
      check (
        to_status in (
          'HELD',
          'PAYMENT_PENDING',
          'CONFIRMED',
          'CHECKED_IN',
          'CHECKED_OUT',
          'CANCELLED',
          'EXPIRED',
          'NO_SHOW'
        )
      )
    )
  `.execute(db);

  await sql`
    create index reservation_status_history_reservation_idx
      on reservation_status_history (reservation_id, sequence_number)
  `.execute(db);

  await sql`
    create or replace function prevent_reservation_detail_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'reservation snapshots and history are immutable';
    end;
    $$
  `.execute(db);

  for (const table of [
    "reservation_financial_snapshots",
    "reservation_lead_guest_snapshots",
    "reservation_status_history"
  ]) {
    await sql
      .raw(
        `
        create trigger ${table}_no_mutation
          before update or delete on ${table}
          for each row execute function prevent_reservation_detail_mutation()
      `
      )
      .execute(db);
  }

  await sql`
    create or replace function protect_reservation_identity()
    returns trigger
    language plpgsql
    as $$
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
    $$
  `.execute(db);

  await sql`
    create trigger reservations_protect_identity
      before update or delete on reservations
      for each row execute function protect_reservation_identity()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists reservations_protect_identity on reservations
  `.execute(db);
  await sql`drop function if exists protect_reservation_identity()`.execute(db);

  for (const table of [
    "reservation_status_history",
    "reservation_lead_guest_snapshots",
    "reservation_financial_snapshots"
  ]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`drop function if exists prevent_reservation_detail_mutation()`.execute(db);
  await sql`drop table if exists reservation_status_history`.execute(db);
  await sql`drop table if exists reservation_lead_guest_snapshots`.execute(db);
  await sql`drop table if exists reservation_financial_snapshots`.execute(db);
  await sql`drop table if exists reservations`.execute(db);

  await sql`
    alter table quote_inventory_holds
      drop constraint if exists quote_inventory_holds_reservation_link_key
  `.execute(db);
}
