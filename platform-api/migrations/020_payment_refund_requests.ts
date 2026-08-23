import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_refund_requests (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      reconciliation_case_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_payment_id text not null
        check (length(btrim(provider_payment_id)) between 1 and 200),
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
      reason_code text not null check (reason_code ~ '^[A-Z0-9_]{2,64}$'),
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (payment_evidence_id, property_id, organization_id)
        references payment_provider_evidence(id, property_id, organization_id) on delete restrict,
      foreign key (reconciliation_case_id, property_id, organization_id)
        references payment_reconciliation_cases(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index payment_refund_requests_evidence_created_idx
      on payment_refund_requests (payment_evidence_id, created_at desc)
  `.execute(db);

  await sql`
    create index payment_refund_requests_property_created_idx
      on payment_refund_requests (property_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_refund_request_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment refund requests are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_refund_requests_no_mutation
      before update or delete on payment_refund_requests
      for each row execute function prevent_payment_refund_request_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_refund_requests_no_mutation
      on payment_refund_requests
  `.execute(db);
  await sql`drop function if exists prevent_payment_refund_request_mutation()`.execute(db);
  await sql`drop table if exists payment_refund_requests`.execute(db);
}
