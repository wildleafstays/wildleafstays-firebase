import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_intents (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      payment_reference text not null,
      purpose text not null default 'RESERVATION_TOTAL'
        check (purpose in ('RESERVATION_TOTAL')),
      amount_minor integer not null check (amount_minor >= 0),
      currency_code char(3) not null,
      status text not null default 'PENDING'
        check (status in ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
      expires_at timestamptz not null,
      created_by_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (property_id, payment_reference),
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      check (expires_at > created_at)
    )
  `.execute(db);

  await sql`
    create unique index payment_intents_one_pending_per_reservation_idx
      on payment_intents (reservation_id)
      where status = 'PENDING'
  `.execute(db);

  await sql`
    create index payment_intents_property_status_created_idx
      on payment_intents (property_id, status, created_at desc)
  `.execute(db);

  await sql`
    create index payment_intents_expiry_idx
      on payment_intents (expires_at)
      where status = 'PENDING'
  `.execute(db);

  await sql`
    create table payment_events (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      event_type text not null,
      details_json jsonb not null default '{}'::jsonb,
      actor_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index payment_events_intent_created_idx
      on payment_events (payment_intent_id, created_at)
  `.execute(db);

  await sql`
    create or replace function protect_payment_intent_identity()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        raise exception 'payment intents cannot be deleted';
      end if;

      if (
        new.organization_id,
        new.property_id,
        new.reservation_id,
        new.payment_reference,
        new.purpose,
        new.amount_minor,
        new.currency_code,
        new.expires_at,
        new.created_by_user_id,
        new.source,
        new.request_id,
        new.correlation_id,
        new.created_at
      ) is distinct from (
        old.organization_id,
        old.property_id,
        old.reservation_id,
        old.payment_reference,
        old.purpose,
        old.amount_minor,
        old.currency_code,
        old.expires_at,
        old.created_by_user_id,
        old.source,
        old.request_id,
        old.correlation_id,
        old.created_at
      ) then
        raise exception 'payment intent identity and monetary snapshot are immutable';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_intents_protect_identity
      before update or delete on payment_intents
      for each row execute function protect_payment_intent_identity()
  `.execute(db);

  await sql`
    create or replace function prevent_payment_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment events are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_events_no_mutation
      before update or delete on payment_events
      for each row execute function prevent_payment_event_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_events_no_mutation on payment_events
  `.execute(db);
  await sql`drop function if exists prevent_payment_event_mutation()`.execute(db);

  await sql`
    drop trigger if exists payment_intents_protect_identity on payment_intents
  `.execute(db);
  await sql`drop function if exists protect_payment_intent_identity()`.execute(db);

  await sql`drop table if exists payment_events`.execute(db);
  await sql`drop table if exists payment_intents`.execute(db);
}
