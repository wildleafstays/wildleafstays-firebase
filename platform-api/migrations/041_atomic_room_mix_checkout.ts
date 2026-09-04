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

  for (const table of [
    "room_mix_quotes",
    "room_mix_quote_items",
    "room_mix_inventory_holds"
  ]) {
    await sql
      .raw(`
        create trigger ${table}_no_mutation
          before update or delete on ${table}
          for each row execute function prevent_quote_snapshot_mutation()
      `)
      .execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "room_mix_inventory_holds",
    "room_mix_quote_items",
    "room_mix_quotes"
  ]) {
    await sql
      .raw(`drop trigger if exists ${table}_no_mutation on ${table}`)
      .execute(db);
  }

  await sql`drop table if exists room_mix_inventory_holds`.execute(db);
  await sql`drop table if exists room_mix_quote_items`.execute(db);
  await sql`drop table if exists room_mix_quotes`.execute(db);
}
