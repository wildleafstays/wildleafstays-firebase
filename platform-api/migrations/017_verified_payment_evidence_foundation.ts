import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_provider_evidence (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_event_id text not null check (length(btrim(provider_event_id)) between 1 and 200),
      provider_payment_id text not null check (length(btrim(provider_payment_id)) between 1 and 200),
      provider_order_id text,
      amount_minor integer not null check (amount_minor >= 0),
      currency_code char(3) not null,
      verification_method text not null check (verification_method in ('WEBHOOK_SIGNATURE', 'PROVIDER_API')),
      payload_sha256 char(64) not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
      source text not null,
      request_id text not null,
      correlation_id text not null,
      received_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (provider, provider_event_id),
      unique (provider, provider_payment_id),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      check (provider_order_id is null or length(btrim(provider_order_id)) between 1 and 200)
    )
  `.execute(db);

  await sql`
    create index payment_provider_evidence_intent_received_idx
      on payment_provider_evidence (payment_intent_id, received_at desc)
  `.execute(db);

  await sql`
    create index payment_provider_evidence_reservation_received_idx
      on payment_provider_evidence (reservation_id, received_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_provider_evidence_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'verified payment provider evidence is immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_provider_evidence_no_mutation
      before update or delete on payment_provider_evidence
      for each row execute function prevent_payment_provider_evidence_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop trigger if exists payment_provider_evidence_no_mutation on payment_provider_evidence`.execute(
    db
  );
  await sql`drop function if exists prevent_payment_provider_evidence_mutation()`.execute(db);
  await sql`drop table if exists payment_provider_evidence`.execute(db);
}
