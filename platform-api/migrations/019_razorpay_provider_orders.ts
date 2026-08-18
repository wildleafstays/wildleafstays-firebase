import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_provider_orders (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider in ('RAZORPAY')),
      provider_order_id text not null,
      receipt text not null,
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null,
      provider_created_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (payment_intent_id),
      unique (provider, provider_order_id),
      unique (provider, receipt),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index payment_provider_orders_property_created_idx
      on payment_provider_orders (property_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_provider_order_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment provider order links are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_provider_orders_no_mutation
      before update or delete on payment_provider_orders
      for each row execute function prevent_payment_provider_order_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_provider_orders_no_mutation
      on payment_provider_orders
  `.execute(db);
  await sql`drop function if exists prevent_payment_provider_order_mutation()`.execute(db);
  await sql`drop table if exists payment_provider_orders`.execute(db);
}
