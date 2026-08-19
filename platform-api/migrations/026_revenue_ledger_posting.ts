import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists financial_ledger_entries_validate on financial_ledger_entries
  `.execute(db);
  await sql`
    drop trigger if exists financial_ledger_journals_validate on financial_ledger_journals
  `.execute(db);
  await sql`drop function if exists validate_financial_ledger_journal()`.execute(db);

  await sql`
    do $$
    declare
      target_name text;
    begin
      select c.conname
      into target_name
      from pg_constraint c
      where c.conrelid = 'financial_ledger_journals'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%journal_type%'
        and pg_get_constraintdef(c.oid) ilike '%PAYMENT_RECEIVED%'
        and pg_get_constraintdef(c.oid) ilike '%REFUND_PROCESSED%'
        and pg_get_constraintdef(c.oid) not ilike '%payment_evidence_id%'
        and pg_get_constraintdef(c.oid) not ilike '%refund_finalization_id%'
      limit 1;

      if target_name is null then
        raise exception 'existing financial ledger journal type constraint not found';
      end if;
      execute format('alter table financial_ledger_journals drop constraint %I', target_name);

      target_name := null;
      select c.conname
      into target_name
      from pg_constraint c
      where c.conrelid = 'financial_ledger_journals'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%payment_evidence_id%'
        and pg_get_constraintdef(c.oid) ilike '%refund_finalization_id%'
        and pg_get_constraintdef(c.oid) not ilike '%journal_type in%'
      limit 1;

      if target_name is null then
        raise exception 'existing financial ledger source-shape constraint not found';
      end if;
      execute format('alter table financial_ledger_journals drop constraint %I', target_name);

      target_name := null;
      select c.conname
      into target_name
      from pg_constraint c
      where c.conrelid = 'financial_ledger_entries'::regclass
        and c.contype = 'c'
        and pg_get_constraintdef(c.oid) ilike '%account_code%'
        and pg_get_constraintdef(c.oid) ilike '%PAYMENT_PROVIDER_CLEARING%'
        and pg_get_constraintdef(c.oid) ilike '%GUEST_FUNDS_HELD%'
      limit 1;

      if target_name is null then
        raise exception 'existing financial ledger account constraint not found';
      end if;
      execute format('alter table financial_ledger_entries drop constraint %I', target_name);
    end;
    $$
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      alter column payment_intent_id drop not null,
      add column revenue_schedule_line_id uuid,
      add column stay_completion_history_id uuid,
      add column recognition_date date
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      add constraint financial_ledger_journals_revenue_schedule_line_key
        unique (revenue_schedule_line_id),
      add constraint financial_ledger_journals_revenue_schedule_line_fkey
        foreign key (revenue_schedule_line_id)
        references reservation_revenue_schedule_lines(id) on delete restrict,
      add constraint financial_ledger_journals_stay_completion_history_fkey
        foreign key (stay_completion_history_id)
        references reservation_status_history(id) on delete restrict,
      add constraint financial_ledger_journals_journal_type_check_v2
        check (journal_type in ('PAYMENT_RECEIVED', 'REFUND_PROCESSED', 'REVENUE_RECOGNIZED')),
      add constraint financial_ledger_journals_source_shape_check_v2
        check (
          (
            journal_type = 'PAYMENT_RECEIVED'
            and payment_intent_id is not null
            and payment_evidence_id is not null
            and refund_finalization_id is null
            and revenue_schedule_line_id is null
            and stay_completion_history_id is null
            and recognition_date is null
          )
          or
          (
            journal_type = 'REFUND_PROCESSED'
            and payment_intent_id is not null
            and payment_evidence_id is null
            and refund_finalization_id is not null
            and revenue_schedule_line_id is null
            and stay_completion_history_id is null
            and recognition_date is null
          )
          or
          (
            journal_type = 'REVENUE_RECOGNIZED'
            and payment_intent_id is null
            and payment_evidence_id is null
            and refund_finalization_id is null
            and revenue_schedule_line_id is not null
            and stay_completion_history_id is not null
            and recognition_date is not null
          )
        )
  `.execute(db);

  await sql`
    alter table financial_ledger_entries
      add constraint financial_ledger_entries_account_code_check_v2
        check (account_code in ('PAYMENT_PROVIDER_CLEARING', 'GUEST_FUNDS_HELD', 'STAY_REVENUE'))
  `.execute(db);

  await sql`
    create index financial_ledger_journals_revenue_recognition_date_idx
      on financial_ledger_journals (property_id, recognition_date, id)
      where journal_type = 'REVENUE_RECOGNIZED'
  `.execute(db);

  await sql`
    create or replace function validate_financial_ledger_journal()
    returns trigger
    language plpgsql
    as $$
    declare
      target_journal_id uuid;
      journal_row financial_ledger_journals%rowtype;
      revenue_line reservation_revenue_schedule_lines%rowtype;
      revenue_schedule reservation_revenue_schedules%rowtype;
      reservation_row reservations%rowtype;
      checkout_history reservation_status_history%rowtype;
      expected_recognition_date date;
      entry_count integer;
      debit_total bigint;
      credit_total bigint;
      exact_entry_count integer;
    begin
      if tg_table_name = 'financial_ledger_journals' then
        target_journal_id := new.id;
      else
        target_journal_id := new.journal_id;
      end if;

      select *
      into journal_row
      from financial_ledger_journals
      where id = target_journal_id;

      if not found then
        raise exception 'financial ledger journal does not exist';
      end if;

      if journal_row.journal_type = 'PAYMENT_RECEIVED' then
        if not exists (
          select 1
          from payment_provider_evidence evidence
          where evidence.id = journal_row.payment_evidence_id
            and evidence.organization_id = journal_row.organization_id
            and evidence.property_id = journal_row.property_id
            and evidence.reservation_id = journal_row.reservation_id
            and evidence.payment_intent_id = journal_row.payment_intent_id
            and evidence.amount_minor = journal_row.amount_minor
            and evidence.currency_code = journal_row.currency_code
        ) then
          raise exception 'payment-received ledger journal does not match verified payment evidence';
        end if;
      elsif journal_row.journal_type = 'REFUND_PROCESSED' then
        if not exists (
          select 1
          from payment_refund_finalizations finalization
          where finalization.id = journal_row.refund_finalization_id
            and finalization.organization_id = journal_row.organization_id
            and finalization.property_id = journal_row.property_id
            and finalization.reservation_id = journal_row.reservation_id
            and finalization.payment_intent_id = journal_row.payment_intent_id
            and finalization.status = 'PROCESSED'
            and finalization.amount_minor = journal_row.amount_minor
            and finalization.currency_code = journal_row.currency_code
        ) then
          raise exception 'refund ledger journal does not match processed refund finalization';
        end if;
      elsif journal_row.journal_type = 'REVENUE_RECOGNIZED' then
        select line.*
        into revenue_line
        from reservation_revenue_schedule_lines line
        where line.id = journal_row.revenue_schedule_line_id;

        if not found then
          raise exception 'revenue ledger journal source schedule line does not exist';
        end if;

        select schedule.*
        into revenue_schedule
        from reservation_revenue_schedules schedule
        where schedule.id = revenue_line.schedule_id;

        if not found then
          raise exception 'revenue ledger journal source schedule does not exist';
        end if;

        select reservation.*
        into reservation_row
        from reservations reservation
        where reservation.id = journal_row.reservation_id;

        if not found then
          raise exception 'revenue ledger journal reservation does not exist';
        end if;

        if reservation_row.status <> 'CHECKED_OUT'
          or revenue_line.organization_id <> journal_row.organization_id
          or revenue_line.property_id <> journal_row.property_id
          or revenue_line.reservation_id <> journal_row.reservation_id
          or revenue_line.currency_code <> journal_row.currency_code
          or revenue_line.revenue_minor <> journal_row.amount_minor
          or revenue_line.revenue_minor <= 0
          or revenue_schedule.reservation_id <> journal_row.reservation_id
          or revenue_schedule.organization_id <> journal_row.organization_id
          or revenue_schedule.property_id <> journal_row.property_id
        then
          raise exception 'revenue ledger journal does not match immutable revenue schedule economics';
        end if;

        select history.*
        into checkout_history
        from reservation_status_history history
        where history.id = journal_row.stay_completion_history_id;

        if not found
          or checkout_history.organization_id <> journal_row.organization_id
          or checkout_history.property_id <> journal_row.property_id
          or checkout_history.reservation_id <> journal_row.reservation_id
          or checkout_history.from_status <> 'CHECKED_IN'
          or checkout_history.to_status <> 'CHECKED_OUT'
          or checkout_history.reason <> 'FRONT_DESK_CHECK_OUT'
        then
          raise exception 'revenue ledger journal does not match canonical stay completion history';
        end if;

        if date_trunc('milliseconds', checkout_history.created_at)
          is distinct from journal_row.occurred_at
        then
          raise exception 'revenue ledger occurrence time does not match canonical checkout';
        end if;

        if revenue_line.service_scope = 'NIGHT' then
          expected_recognition_date := revenue_line.stay_date;
        elsif revenue_line.service_scope = 'STAY' then
          expected_recognition_date := reservation_row.departure_date;
        else
          raise exception 'unsupported revenue recognition service scope';
        end if;

        if journal_row.recognition_date is distinct from expected_recognition_date then
          raise exception 'revenue ledger recognition date does not match immutable service period';
        end if;
      else
        raise exception 'unsupported financial ledger journal type';
      end if;

      select
        count(*),
        coalesce(sum(entry.amount_minor) filter (where entry.direction = 'DEBIT'), 0),
        coalesce(sum(entry.amount_minor) filter (where entry.direction = 'CREDIT'), 0)
      into entry_count, debit_total, credit_total
      from financial_ledger_entries entry
      where entry.journal_id = target_journal_id;

      if entry_count <> 2
        or debit_total <> journal_row.amount_minor
        or credit_total <> journal_row.amount_minor
      then
        raise exception 'financial ledger journal must contain exactly two balanced entries';
      end if;

      if journal_row.journal_type = 'PAYMENT_RECEIVED' then
        select count(*)
        into exact_entry_count
        from financial_ledger_entries entry
        where entry.journal_id = target_journal_id
          and entry.amount_minor = journal_row.amount_minor
          and entry.currency_code = journal_row.currency_code
          and (
            (
              entry.line_number = 1
              and entry.account_code = 'PAYMENT_PROVIDER_CLEARING'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'GUEST_FUNDS_HELD'
              and entry.direction = 'CREDIT'
            )
          );
      elsif journal_row.journal_type = 'REFUND_PROCESSED' then
        select count(*)
        into exact_entry_count
        from financial_ledger_entries entry
        where entry.journal_id = target_journal_id
          and entry.amount_minor = journal_row.amount_minor
          and entry.currency_code = journal_row.currency_code
          and (
            (
              entry.line_number = 1
              and entry.account_code = 'GUEST_FUNDS_HELD'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'PAYMENT_PROVIDER_CLEARING'
              and entry.direction = 'CREDIT'
            )
          );
      else
        select count(*)
        into exact_entry_count
        from financial_ledger_entries entry
        where entry.journal_id = target_journal_id
          and entry.amount_minor = journal_row.amount_minor
          and entry.currency_code = journal_row.currency_code
          and (
            (
              entry.line_number = 1
              and entry.account_code = 'GUEST_FUNDS_HELD'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'STAY_REVENUE'
              and entry.direction = 'CREDIT'
            )
          );
      end if;

      if exact_entry_count <> 2 then
        raise exception 'financial ledger journal account directions do not match its journal type';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create constraint trigger financial_ledger_journals_validate
      after insert on financial_ledger_journals
      deferrable initially deferred
      for each row execute function validate_financial_ledger_journal()
  `.execute(db);

  await sql`
    create constraint trigger financial_ledger_entries_validate
      after insert on financial_ledger_entries
      deferrable initially deferred
      for each row execute function validate_financial_ledger_journal()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists financial_ledger_entries_validate on financial_ledger_entries
  `.execute(db);
  await sql`
    drop trigger if exists financial_ledger_journals_validate on financial_ledger_journals
  `.execute(db);
  await sql`drop function if exists validate_financial_ledger_journal()`.execute(db);

  await sql`
    drop trigger if exists financial_ledger_entries_no_mutation on financial_ledger_entries
  `.execute(db);
  await sql`
    drop trigger if exists financial_ledger_journals_no_mutation on financial_ledger_journals
  `.execute(db);

  await sql`
    delete from financial_ledger_entries
    where journal_id in (
      select id
      from financial_ledger_journals
      where journal_type = 'REVENUE_RECOGNIZED'
    )
  `.execute(db);

  await sql`
    delete from financial_ledger_journals
    where journal_type = 'REVENUE_RECOGNIZED'
  `.execute(db);

  await sql`
    drop index if exists financial_ledger_journals_revenue_recognition_date_idx
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      drop constraint if exists financial_ledger_journals_source_shape_check_v2,
      drop constraint if exists financial_ledger_journals_journal_type_check_v2,
      drop constraint if exists financial_ledger_journals_stay_completion_history_fkey,
      drop constraint if exists financial_ledger_journals_revenue_schedule_line_fkey,
      drop constraint if exists financial_ledger_journals_revenue_schedule_line_key
  `.execute(db);

  await sql`
    alter table financial_ledger_entries
      drop constraint if exists financial_ledger_entries_account_code_check_v2
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      alter column payment_intent_id set not null,
      drop column if exists recognition_date,
      drop column if exists stay_completion_history_id,
      drop column if exists revenue_schedule_line_id
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      add constraint financial_ledger_journals_journal_type_check
        check (journal_type in ('PAYMENT_RECEIVED', 'REFUND_PROCESSED')),
      add constraint financial_ledger_journals_check
        check (
          (
            journal_type = 'PAYMENT_RECEIVED'
            and payment_evidence_id is not null
            and refund_finalization_id is null
          )
          or
          (
            journal_type = 'REFUND_PROCESSED'
            and payment_evidence_id is null
            and refund_finalization_id is not null
          )
        )
  `.execute(db);

  await sql`
    alter table financial_ledger_entries
      add constraint financial_ledger_entries_account_code_check
        check (account_code in ('PAYMENT_PROVIDER_CLEARING', 'GUEST_FUNDS_HELD'))
  `.execute(db);

  await sql`
    create or replace function validate_financial_ledger_journal()
    returns trigger
    language plpgsql
    as $$
    declare
      target_journal_id uuid;
      journal_row financial_ledger_journals%rowtype;
      entry_count integer;
      debit_total bigint;
      credit_total bigint;
      exact_entry_count integer;
    begin
      if tg_table_name = 'financial_ledger_journals' then
        target_journal_id := new.id;
      else
        target_journal_id := new.journal_id;
      end if;

      select *
      into journal_row
      from financial_ledger_journals
      where id = target_journal_id;

      if not found then
        raise exception 'financial ledger journal does not exist';
      end if;

      if journal_row.journal_type = 'PAYMENT_RECEIVED' then
        if not exists (
          select 1
          from payment_provider_evidence evidence
          where evidence.id = journal_row.payment_evidence_id
            and evidence.organization_id = journal_row.organization_id
            and evidence.property_id = journal_row.property_id
            and evidence.reservation_id = journal_row.reservation_id
            and evidence.payment_intent_id = journal_row.payment_intent_id
            and evidence.amount_minor = journal_row.amount_minor
            and evidence.currency_code = journal_row.currency_code
        ) then
          raise exception 'payment-received ledger journal does not match verified payment evidence';
        end if;
      elsif journal_row.journal_type = 'REFUND_PROCESSED' then
        if not exists (
          select 1
          from payment_refund_finalizations finalization
          where finalization.id = journal_row.refund_finalization_id
            and finalization.organization_id = journal_row.organization_id
            and finalization.property_id = journal_row.property_id
            and finalization.reservation_id = journal_row.reservation_id
            and finalization.payment_intent_id = journal_row.payment_intent_id
            and finalization.status = 'PROCESSED'
            and finalization.amount_minor = journal_row.amount_minor
            and finalization.currency_code = journal_row.currency_code
        ) then
          raise exception 'refund ledger journal does not match processed refund finalization';
        end if;
      else
        raise exception 'unsupported financial ledger journal type';
      end if;

      select
        count(*),
        coalesce(sum(entry.amount_minor) filter (where entry.direction = 'DEBIT'), 0),
        coalesce(sum(entry.amount_minor) filter (where entry.direction = 'CREDIT'), 0)
      into entry_count, debit_total, credit_total
      from financial_ledger_entries entry
      where entry.journal_id = target_journal_id;

      if entry_count <> 2
        or debit_total <> journal_row.amount_minor
        or credit_total <> journal_row.amount_minor
      then
        raise exception 'financial ledger journal must contain exactly two balanced entries';
      end if;

      if journal_row.journal_type = 'PAYMENT_RECEIVED' then
        select count(*)
        into exact_entry_count
        from financial_ledger_entries entry
        where entry.journal_id = target_journal_id
          and entry.amount_minor = journal_row.amount_minor
          and entry.currency_code = journal_row.currency_code
          and (
            (
              entry.line_number = 1
              and entry.account_code = 'PAYMENT_PROVIDER_CLEARING'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'GUEST_FUNDS_HELD'
              and entry.direction = 'CREDIT'
            )
          );
      else
        select count(*)
        into exact_entry_count
        from financial_ledger_entries entry
        where entry.journal_id = target_journal_id
          and entry.amount_minor = journal_row.amount_minor
          and entry.currency_code = journal_row.currency_code
          and (
            (
              entry.line_number = 1
              and entry.account_code = 'GUEST_FUNDS_HELD'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'PAYMENT_PROVIDER_CLEARING'
              and entry.direction = 'CREDIT'
            )
          );
      end if;

      if exact_entry_count <> 2 then
        raise exception 'financial ledger journal account directions do not match its journal type';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create constraint trigger financial_ledger_journals_validate
      after insert on financial_ledger_journals
      deferrable initially deferred
      for each row execute function validate_financial_ledger_journal()
  `.execute(db);

  await sql`
    create constraint trigger financial_ledger_entries_validate
      after insert on financial_ledger_entries
      deferrable initially deferred
      for each row execute function validate_financial_ledger_journal()
  `.execute(db);

  await sql`
    create trigger financial_ledger_journals_no_mutation
      before update or delete on financial_ledger_journals
      for each row execute function prevent_financial_ledger_mutation()
  `.execute(db);

  await sql`
    create trigger financial_ledger_entries_no_mutation
      before update or delete on financial_ledger_entries
      for each row execute function prevent_financial_ledger_mutation()
  `.execute(db);
}
