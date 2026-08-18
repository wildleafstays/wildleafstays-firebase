import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table payment_reconciliation_cases
      add column resolution_code text
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1
        from payment_reconciliation_cases
        where status = 'RESOLVED'
          and (
            resolution_note is null
            or length(btrim(resolution_note)) < 1
            or length(btrim(resolution_note)) > 1000
            or not (
              (
                required_action = 'REFUND_REQUIRED'
                and resolved_by_user_id is null
              )
              or
              (
                required_action = 'MANUAL_REVIEW'
                and resolved_by_user_id is not null
              )
            )
          )
      ) then
        raise exception
          'existing resolved payment reconciliation cannot be safely assigned a structured resolution code';
      end if;
    end;
    $$
  `.execute(db);

  await sql`
    update payment_reconciliation_cases
    set resolution_code = 'PROVIDER_REFUND_PROCESSED'
    where status = 'RESOLVED'
      and required_action = 'REFUND_REQUIRED'
  `.execute(db);

  await sql`
    update payment_reconciliation_cases
    set resolution_code = 'PAYMENT_RETAINED'
    where status = 'RESOLVED'
      and required_action = 'MANUAL_REVIEW'
      and resolved_by_user_id is not null
  `.execute(db);

  await sql`
    alter table payment_reconciliation_cases
      add constraint payment_reconciliation_resolution_lifecycle_check
      check (
        (
          status = 'OPEN'
          and resolved_at is null
          and resolved_by_user_id is null
          and resolution_note is null
          and resolution_code is null
        )
        or
        (
          status = 'RESOLVED'
          and resolved_at is not null
          and resolution_note is not null
          and length(btrim(resolution_note)) between 1 and 1000
          and (
            (
              required_action = 'REFUND_REQUIRED'
              and resolved_by_user_id is null
              and resolution_code = 'PROVIDER_REFUND_PROCESSED'
            )
            or
            (
              required_action = 'MANUAL_REVIEW'
              and resolved_by_user_id is not null
              and resolution_code = 'PAYMENT_RETAINED'
            )
          )
        )
      )
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

      if old.status = 'RESOLVED' and (
        new.status,
        new.resolved_at,
        new.resolved_by_user_id,
        new.resolution_note,
        new.resolution_code
      ) is distinct from (
        old.status,
        old.resolved_at,
        old.resolved_by_user_id,
        old.resolution_note,
        old.resolution_code
      ) then
        raise exception 'resolved payment reconciliation lifecycle is immutable';
      end if;

      return new;
    end;
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists payment_reconciliation_cases_protect_identity
      on payment_reconciliation_cases
  `.execute(db);

  await sql`
    alter table payment_reconciliation_cases
      drop constraint if exists payment_reconciliation_resolution_lifecycle_check
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
    alter table payment_reconciliation_cases
      drop column if exists resolution_code
  `.execute(db);

  await sql`
    create trigger payment_reconciliation_cases_protect_identity
      before update or delete on payment_reconciliation_cases
      for each row execute function protect_payment_reconciliation_identity()
  `.execute(db);
}
