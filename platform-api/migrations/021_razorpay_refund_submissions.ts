import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_refund_submissions (
      id uuid primary key default gen_random_uuid(),
      refund_request_id uuid not null,
      attempt_sequence integer not null check (attempt_sequence > 0),
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      reconciliation_case_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_payment_id text not null
        check (length(btrim(provider_payment_id)) between 1 and 200),
      provider_refund_id text not null
        check (length(btrim(provider_refund_id)) between 1 and 200),
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
      idempotency_key text not null
        check (
          length(idempotency_key) between 10 and 200
          and idempotency_key ~ '^[A-Za-z0-9_-]+$'
        ),
      initial_provider_status text not null
        check (initial_provider_status in ('PENDING', 'PROCESSED', 'FAILED')),
      provider_created_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (refund_request_id, attempt_sequence),
      unique (provider, provider_refund_id),
      unique (provider, idempotency_key),
      foreign key (refund_request_id, property_id, organization_id)
        references payment_refund_requests(id, property_id, organization_id) on delete restrict,
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
    create index payment_refund_submissions_property_created_idx
      on payment_refund_submissions (property_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_refund_submission_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment refund submissions are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_refund_submissions_no_mutation
      before update or delete on payment_refund_submissions
      for each row execute function prevent_payment_refund_submission_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_refund_submissions_no_mutation
      on payment_refund_submissions
  `.execute(db);
  await sql`drop function if exists prevent_payment_refund_submission_mutation()`.execute(db);
  await sql`drop table if exists payment_refund_submissions`.execute(db);
}
