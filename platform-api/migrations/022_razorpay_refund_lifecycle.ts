import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_refund_provider_events (
      id uuid primary key default gen_random_uuid(),
      refund_submission_id uuid not null,
      refund_request_id uuid not null,
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      reconciliation_case_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_event_id text not null
        check (length(btrim(provider_event_id)) between 1 and 200),
      provider_refund_id text not null
        check (length(btrim(provider_refund_id)) between 1 and 200),
      provider_payment_id text not null
        check (length(btrim(provider_payment_id)) between 1 and 200),
      event_type text not null
        check (event_type in ('refund.created', 'refund.processed', 'refund.failed')),
      provider_status text not null
        check (provider_status in ('PENDING', 'PROCESSED', 'FAILED')),
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
      payload_sha256 char(64) not null
        check (payload_sha256 ~ '^[0-9a-f]{64}$'),
      provider_refund_created_at timestamptz not null,
      provider_event_created_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (provider, provider_event_id),
      foreign key (refund_submission_id, property_id, organization_id)
        references payment_refund_submissions(id, property_id, organization_id) on delete restrict,
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
    create index payment_refund_provider_events_submission_created_idx
      on payment_refund_provider_events (refund_submission_id, created_at desc)
  `.execute(db);

  await sql`
    create table payment_refund_finalizations (
      id uuid primary key default gen_random_uuid(),
      refund_submission_id uuid not null unique,
      refund_request_id uuid not null,
      finalization_event_id uuid not null unique,
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      reconciliation_case_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      provider text not null check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_event_id text not null,
      provider_refund_id text not null,
      status text not null check (status in ('PROCESSED', 'FAILED')),
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
      provider_event_created_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (refund_submission_id, property_id, organization_id)
        references payment_refund_submissions(id, property_id, organization_id) on delete restrict,
      foreign key (refund_request_id, property_id, organization_id)
        references payment_refund_requests(id, property_id, organization_id) on delete restrict,
      foreign key (finalization_event_id, property_id, organization_id)
        references payment_refund_provider_events(id, property_id, organization_id) on delete restrict,
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
    create index payment_refund_finalizations_property_created_idx
      on payment_refund_finalizations (property_id, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_refund_lifecycle_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment refund lifecycle records are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_refund_provider_events_no_mutation
      before update or delete on payment_refund_provider_events
      for each row execute function prevent_payment_refund_lifecycle_mutation()
  `.execute(db);

  await sql`
    create trigger payment_refund_finalizations_no_mutation
      before update or delete on payment_refund_finalizations
      for each row execute function prevent_payment_refund_lifecycle_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_refund_finalizations_no_mutation
      on payment_refund_finalizations
  `.execute(db);
  await sql`
    drop trigger if exists payment_refund_provider_events_no_mutation
      on payment_refund_provider_events
  `.execute(db);
  await sql`drop function if exists prevent_payment_refund_lifecycle_mutation()`.execute(db);
  await sql`drop table if exists payment_refund_finalizations`.execute(db);
  await sql`drop table if exists payment_refund_provider_events`.execute(db);
}
