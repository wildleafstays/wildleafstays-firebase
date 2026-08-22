import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table reservation_cancellation_decisions (
      id uuid primary key default gen_random_uuid(),
      reservation_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      guest_user_id uuid not null,
      quote_id uuid not null,
      quote_cancellation_snapshot_id uuid not null,
      quote_cancellation_tier_snapshot_id uuid not null,
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      cancelled_at timestamptz not null,
      arrival_at timestamptz not null,
      minutes_before_arrival integer not null
        check (minutes_before_arrival >= 0),
      tier_minimum_minutes_before_arrival integer not null
        check (
          tier_minimum_minutes_before_arrival >= 0
          and tier_minimum_minutes_before_arrival <= minutes_before_arrival
        ),
      penalty_type text not null
        check (
          penalty_type in (
            'PERCENTAGE_OF_STAY',
            'FIXED_AMOUNT',
            'NIGHTS'
          )
        ),
      penalty_value integer not null
        check (penalty_value >= 0),
      accepted_total_minor integer not null
        check (accepted_total_minor >= 0),
      paid_minor integer not null
        check (paid_minor >= 0),
      penalty_minor integer not null
        check (penalty_minor >= 0),
      refund_due_minor integer not null
        check (refund_due_minor >= 0),
      currency_code char(3) not null
        check (currency_code ~ '^[A-Z]{3}$'),
      provider text not null
        check (provider ~ '^[A-Z0-9_]{2,32}$'),
      provider_payment_id text not null
        check (length(btrim(provider_payment_id)) between 1 and 200),
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),

      unique (id, property_id, organization_id),

      check (cancelled_at < arrival_at),

      check (
        (
          penalty_type = 'PERCENTAGE_OF_STAY'
          and penalty_value between 0 and 10000
        )
        or (
          penalty_type = 'FIXED_AMOUNT'
          and penalty_value >= 0
        )
        or (
          penalty_type = 'NIGHTS'
          and penalty_value between 0 and 365
        )
      ),

      check (penalty_minor <= accepted_total_minor),

      check (paid_minor = accepted_total_minor),

      check (
        refund_due_minor = greatest(0, paid_minor - penalty_minor)
      ),

      foreign key (reservation_id)
        references reservations(id) on delete restrict,

      foreign key (guest_user_id)
        references users(id) on delete restrict,

      foreign key (quote_id)
        references quotes(id) on delete restrict,

      foreign key (quote_cancellation_snapshot_id)
        references quote_cancellation_snapshots(id) on delete restrict,

      foreign key (quote_cancellation_tier_snapshot_id)
        references quote_cancellation_tier_snapshots(id) on delete restrict,

      foreign key (payment_intent_id)
        references payment_intents(id) on delete restrict,

      foreign key (payment_evidence_id)
        references payment_provider_evidence(id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index reservation_cancellation_decisions_guest_created_idx
      on reservation_cancellation_decisions (
        guest_user_id,
        cancelled_at desc,
        reservation_id
      )
  `.execute(db);

  await sql`
    create index reservation_cancellation_decisions_property_created_idx
      on reservation_cancellation_decisions (
        property_id,
        cancelled_at desc,
        reservation_id
      )
  `.execute(db);

  await sql`
    create or replace function prevent_reservation_cancellation_decision_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'reservation cancellation decisions are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger reservation_cancellation_decisions_no_mutation
      before update or delete on reservation_cancellation_decisions
      for each row execute function prevent_reservation_cancellation_decision_mutation()
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      alter column reconciliation_case_id drop not null,
      add column refund_source text not null default 'RECONCILIATION',
      add column cancellation_decision_id uuid
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      add constraint payment_refund_requests_refund_source_check
      check (
        refund_source in (
          'RECONCILIATION',
          'RESERVATION_CANCELLATION'
        )
      )
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      add constraint payment_refund_requests_cancellation_decision_fkey
      foreign key (cancellation_decision_id)
      references reservation_cancellation_decisions(id)
      on delete restrict
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      add constraint payment_refund_requests_backing_source_check
      check (
        (
          refund_source = 'RECONCILIATION'
          and reconciliation_case_id is not null
          and cancellation_decision_id is null
        )
        or
        (
          refund_source = 'RESERVATION_CANCELLATION'
          and reconciliation_case_id is null
          and cancellation_decision_id is not null
        )
      )
  `.execute(db);

  await sql`
    create unique index payment_refund_requests_cancellation_decision_uidx
      on payment_refund_requests (cancellation_decision_id)
      where cancellation_decision_id is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists payment_refund_requests_cancellation_decision_uidx
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      drop constraint if exists payment_refund_requests_backing_source_check,
      drop constraint if exists payment_refund_requests_cancellation_decision_fkey,
      drop constraint if exists payment_refund_requests_refund_source_check
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      drop column if exists cancellation_decision_id,
      drop column if exists refund_source
  `.execute(db);

  await sql`
    alter table payment_refund_requests
      alter column reconciliation_case_id set not null
  `.execute(db);

  await sql`
    drop trigger if exists reservation_cancellation_decisions_no_mutation
      on reservation_cancellation_decisions
  `.execute(db);

  await sql`
    drop function if exists prevent_reservation_cancellation_decision_mutation()
  `.execute(db);

  await sql`
    drop table if exists reservation_cancellation_decisions
  `.execute(db);
}
