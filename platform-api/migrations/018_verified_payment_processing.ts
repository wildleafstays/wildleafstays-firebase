import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table payment_successes (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      outcome text not null
        check (outcome in ('RESERVATION_CONFIRMED', 'RECONCILIATION_REQUIRED')),
      inventory_allocation_id uuid,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (payment_intent_id),
      unique (payment_evidence_id),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (payment_evidence_id, property_id, organization_id)
        references payment_provider_evidence(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      foreign key (inventory_allocation_id, property_id, organization_id)
        references inventory_allocations(id, property_id, organization_id) on delete restrict,
      check (
        (outcome = 'RESERVATION_CONFIRMED' and inventory_allocation_id is not null)
        or
        (outcome = 'RECONCILIATION_REQUIRED' and inventory_allocation_id is null)
      )
    )
  `.execute(db);

  await sql`
    create index payment_successes_reservation_created_idx
      on payment_successes (reservation_id, created_at desc)
  `.execute(db);

  await sql`
    create table payment_reconciliation_cases (
      id uuid primary key default gen_random_uuid(),
      payment_intent_id uuid not null,
      payment_evidence_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      reason_code text not null
        check (reason_code in (
          'INVENTORY_HOLD_EXPIRED',
          'INVENTORY_HOLD_NOT_ACTIVE',
          'INVENTORY_HOLD_UNAVAILABLE',
          'RESERVATION_STATE_MISMATCH',
          'DUPLICATE_VERIFIED_PAYMENT'
        )),
      required_action text not null
        check (required_action in ('REFUND_REQUIRED', 'MANUAL_REVIEW')),
      status text not null default 'OPEN'
        check (status in ('OPEN', 'RESOLVED')),
      details_json jsonb not null default '{}'::jsonb,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      resolved_at timestamptz,
      resolved_by_user_id uuid references users(id) on delete restrict,
      resolution_note text,
      unique (id, property_id, organization_id),
      unique (payment_evidence_id),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (payment_evidence_id, property_id, organization_id)
        references payment_provider_evidence(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      check (
        (status = 'OPEN' and resolved_at is null and resolved_by_user_id is null and resolution_note is null)
        or
        (status = 'RESOLVED' and resolved_at is not null)
      )
    )
  `.execute(db);

  await sql`
    create index payment_reconciliation_cases_property_status_created_idx
      on payment_reconciliation_cases (property_id, status, created_at desc)
  `.execute(db);

  await sql`
    create or replace function prevent_payment_success_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'payment success records are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_successes_no_mutation
      before update or delete on payment_successes
      for each row execute function prevent_payment_success_mutation()
  `.execute(db);

  await sql`
    create or replace function protect_payment_reconciliation_identity()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'DELETE' then
        raise exception 'payment reconciliation cases cannot be deleted';
      end if;

      if (
        new.payment_intent_id,
        new.payment_evidence_id,
        new.organization_id,
        new.property_id,
        new.reservation_id,
        new.reason_code,
        new.required_action,
        new.details_json,
        new.source,
        new.request_id,
        new.correlation_id,
        new.created_at
      ) is distinct from (
        old.payment_intent_id,
        old.payment_evidence_id,
        old.organization_id,
        old.property_id,
        old.reservation_id,
        old.reason_code,
        old.required_action,
        old.details_json,
        old.source,
        old.request_id,
        old.correlation_id,
        old.created_at
      ) then
        raise exception 'payment reconciliation identity is immutable';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger payment_reconciliation_cases_protect_identity
      before update or delete on payment_reconciliation_cases
      for each row execute function protect_payment_reconciliation_identity()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_reconciliation_cases_protect_identity
      on payment_reconciliation_cases
  `.execute(db);
  await sql`drop function if exists protect_payment_reconciliation_identity()`.execute(db);

  await sql`
    drop trigger if exists payment_successes_no_mutation on payment_successes
  `.execute(db);
  await sql`drop function if exists prevent_payment_success_mutation()`.execute(db);

  await sql`drop table if exists payment_reconciliation_cases`.execute(db);
  await sql`drop table if exists payment_successes`.execute(db);
}
