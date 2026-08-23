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
    alter table financial_ledger_journals
      drop constraint if exists financial_ledger_journals_source_shape_check_v2,
      drop constraint if exists financial_ledger_journals_journal_type_check_v2
  `.execute(db);

  await sql`
    create table reservation_revenue_reversals (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      operation_id text not null
        check (
          length(operation_id) between 8 and 200
          and operation_id ~ '^[A-Za-z0-9._:-]+$'
        ),
      reason_code text not null
        check (reason_code ~ '^[A-Z0-9_]{2,64}$'),
      note text not null
        check (length(btrim(note)) between 10 and 1000),
      currency_code char(3) not null
        check (currency_code ~ '^[A-Z]{3}$'),
      amount_minor integer not null check (amount_minor > 0),
      line_count integer not null check (line_count between 1 and 100),
      actor_user_id uuid not null references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (reservation_id, operation_id),
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table reservation_revenue_reversal_lines (
      id uuid primary key default gen_random_uuid(),
      reversal_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      line_number integer not null check (line_number between 1 and 100),
      revenue_schedule_line_id uuid not null,
      revenue_recognition_journal_id uuid not null,
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null
        check (currency_code ~ '^[A-Z]{3}$'),
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (reversal_id, line_number),
      unique (reversal_id, revenue_schedule_line_id),
      foreign key (reversal_id, property_id, organization_id)
        references reservation_revenue_reversals(id, property_id, organization_id)
        on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      foreign key (revenue_schedule_line_id)
        references reservation_revenue_schedule_lines(id) on delete restrict,
      foreign key (revenue_recognition_journal_id)
        references financial_ledger_journals(id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index reservation_revenue_reversals_property_created_idx
      on reservation_revenue_reversals (property_id, created_at desc, id desc)
  `.execute(db);

  await sql`
    create index reservation_revenue_reversal_lines_schedule_line_idx
      on reservation_revenue_reversal_lines (revenue_schedule_line_id, created_at, id)
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      add column revenue_reversal_line_id uuid
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      add constraint financial_ledger_journals_revenue_reversal_line_key
        unique (revenue_reversal_line_id),
      add constraint financial_ledger_journals_revenue_reversal_line_fkey
        foreign key (revenue_reversal_line_id)
        references reservation_revenue_reversal_lines(id) on delete restrict,
      add constraint financial_ledger_journals_journal_type_check_v3
        check (
          journal_type in (
            'PAYMENT_RECEIVED',
            'REFUND_PROCESSED',
            'REVENUE_RECOGNIZED',
            'REVENUE_REVERSED'
          )
        ),
      add constraint financial_ledger_journals_source_shape_check_v3
        check (
          (
            journal_type = 'PAYMENT_RECEIVED'
            and payment_intent_id is not null
            and payment_evidence_id is not null
            and refund_finalization_id is null
            and revenue_schedule_line_id is null
            and stay_completion_history_id is null
            and recognition_date is null
            and revenue_reversal_line_id is null
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
            and revenue_reversal_line_id is null
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
            and revenue_reversal_line_id is null
          )
          or
          (
            journal_type = 'REVENUE_REVERSED'
            and payment_intent_id is null
            and payment_evidence_id is null
            and refund_finalization_id is null
            and revenue_schedule_line_id is null
            and stay_completion_history_id is null
            and recognition_date is null
            and revenue_reversal_line_id is not null
          )
        )
  `.execute(db);

  await sql`
    create or replace function validate_reservation_revenue_reversal()
    returns trigger
    language plpgsql
    as $$
    declare
      target_reversal_id uuid;
      reversal_row reservation_revenue_reversals%rowtype;
      reservation_row reservations%rowtype;
      observed_line_count integer;
      observed_amount bigint;
    begin
      if tg_table_name = 'reservation_revenue_reversals' then
        target_reversal_id := new.id;
      else
        target_reversal_id := new.reversal_id;
      end if;

      select *
      into reversal_row
      from reservation_revenue_reversals
      where id = target_reversal_id;

      if not found then
        raise exception 'reservation revenue reversal does not exist';
      end if;

      select *
      into reservation_row
      from reservations
      where id = reversal_row.reservation_id;

      if not found
        or reservation_row.organization_id <> reversal_row.organization_id
        or reservation_row.property_id <> reversal_row.property_id
        or reservation_row.status <> 'CHECKED_OUT'
        or reservation_row.currency_code <> reversal_row.currency_code
      then
        raise exception 'revenue reversal requires the canonical checked-out reservation';
      end if;

      if exists (
        select 1
        from reservation_revenue_reversal_lines reversal_line
        left join reservation_revenue_schedule_lines schedule_line
          on schedule_line.id = reversal_line.revenue_schedule_line_id
        left join financial_ledger_journals recognized
          on recognized.id = reversal_line.revenue_recognition_journal_id
        where reversal_line.reversal_id = target_reversal_id
          and (
            reversal_line.organization_id <> reversal_row.organization_id
            or reversal_line.property_id <> reversal_row.property_id
            or reversal_line.reservation_id <> reversal_row.reservation_id
            or reversal_line.currency_code <> reversal_row.currency_code
            or schedule_line.id is null
            or schedule_line.organization_id <> reversal_row.organization_id
            or schedule_line.property_id <> reversal_row.property_id
            or schedule_line.reservation_id <> reversal_row.reservation_id
            or schedule_line.currency_code <> reversal_row.currency_code
            or schedule_line.revenue_minor <= 0
            or recognized.id is null
            or recognized.journal_type <> 'REVENUE_RECOGNIZED'
            or recognized.organization_id <> reversal_row.organization_id
            or recognized.property_id <> reversal_row.property_id
            or recognized.reservation_id <> reversal_row.reservation_id
            or recognized.revenue_schedule_line_id <> schedule_line.id
            or recognized.amount_minor <> schedule_line.revenue_minor
            or recognized.currency_code <> reversal_row.currency_code
          )
      ) then
        raise exception 'revenue reversal line does not match immutable recognized revenue';
      end if;

      if exists (
        select 1
        from reservation_revenue_reversal_lines reversal_line
        join financial_ledger_journals recognized
          on recognized.id = reversal_line.revenue_recognition_journal_id
        where reversal_line.reversal_id = target_reversal_id
          and (
            select coalesce(sum(other.amount_minor), 0)
            from reservation_revenue_reversal_lines other
            where other.revenue_schedule_line_id = reversal_line.revenue_schedule_line_id
          ) > recognized.amount_minor
      ) then
        raise exception 'cumulative revenue reversal exceeds recognized revenue';
      end if;

      select count(*), coalesce(sum(line.amount_minor), 0)
      into observed_line_count, observed_amount
      from reservation_revenue_reversal_lines line
      where line.reversal_id = target_reversal_id;

      if observed_line_count <> reversal_row.line_count then
        raise exception 'revenue reversal line count does not match header';
      end if;

      if observed_amount <> reversal_row.amount_minor then
        raise exception 'revenue reversal lines do not reconcile to header';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create constraint trigger reservation_revenue_reversals_validate
      after insert on reservation_revenue_reversals
      deferrable initially deferred
      for each row execute function validate_reservation_revenue_reversal()
  `.execute(db);

  await sql`
    create constraint trigger reservation_revenue_reversal_lines_validate
      after insert on reservation_revenue_reversal_lines
      deferrable initially deferred
      for each row execute function validate_reservation_revenue_reversal()
  `.execute(db);

  await sql`
    create or replace function prevent_reservation_revenue_reversal_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'reservation revenue reversals are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger reservation_revenue_reversals_no_mutation
      before update or delete on reservation_revenue_reversals
      for each row execute function prevent_reservation_revenue_reversal_mutation()
  `.execute(db);

  await sql`
    create trigger reservation_revenue_reversal_lines_no_mutation
      before update or delete on reservation_revenue_reversal_lines
      for each row execute function prevent_reservation_revenue_reversal_mutation()
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
      reversal_line reservation_revenue_reversal_lines%rowtype;
      reversal_header reservation_revenue_reversals%rowtype;
      recognized_journal financial_ledger_journals%rowtype;
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
      elsif journal_row.journal_type = 'REVENUE_REVERSED' then
        select line.*
        into reversal_line
        from reservation_revenue_reversal_lines line
        where line.id = journal_row.revenue_reversal_line_id;

        if not found then
          raise exception 'revenue reversal ledger source line does not exist';
        end if;

        select reversal.*
        into reversal_header
        from reservation_revenue_reversals reversal
        where reversal.id = reversal_line.reversal_id;

        if not found then
          raise exception 'revenue reversal ledger source header does not exist';
        end if;

        select original.*
        into recognized_journal
        from financial_ledger_journals original
        where original.id = reversal_line.revenue_recognition_journal_id;

        if not found
          or recognized_journal.journal_type <> 'REVENUE_RECOGNIZED'
          or recognized_journal.revenue_schedule_line_id <> reversal_line.revenue_schedule_line_id
        then
          raise exception 'revenue reversal line does not reference canonical recognized revenue';
        end if;

        select reservation.*
        into reservation_row
        from reservations reservation
        where reservation.id = journal_row.reservation_id;

        if not found
          or reservation_row.status <> 'CHECKED_OUT'
          or reversal_header.organization_id <> journal_row.organization_id
          or reversal_header.property_id <> journal_row.property_id
          or reversal_header.reservation_id <> journal_row.reservation_id
          or reversal_header.currency_code <> journal_row.currency_code
          or reversal_line.organization_id <> journal_row.organization_id
          or reversal_line.property_id <> journal_row.property_id
          or reversal_line.reservation_id <> journal_row.reservation_id
          or reversal_line.currency_code <> journal_row.currency_code
          or reversal_line.amount_minor <> journal_row.amount_minor
          or recognized_journal.organization_id <> journal_row.organization_id
          or recognized_journal.property_id <> journal_row.property_id
          or recognized_journal.reservation_id <> journal_row.reservation_id
          or recognized_journal.currency_code <> journal_row.currency_code
        then
          raise exception 'revenue reversal ledger journal does not match immutable reversal economics';
        end if;

        if date_trunc('milliseconds', reversal_header.created_at)
          is distinct from journal_row.occurred_at
        then
          raise exception 'revenue reversal occurrence time does not match immutable reversal header';
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
      elsif journal_row.journal_type = 'REVENUE_RECOGNIZED' then
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
              and entry.account_code = 'STAY_REVENUE'
              and entry.direction = 'DEBIT'
            )
            or
            (
              entry.line_number = 2
              and entry.account_code = 'GUEST_FUNDS_HELD'
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
      where journal_type = 'REVENUE_REVERSED'
    )
  `.execute(db);

  await sql`
    delete from financial_ledger_journals
    where journal_type = 'REVENUE_REVERSED'
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      drop constraint if exists financial_ledger_journals_source_shape_check_v3,
      drop constraint if exists financial_ledger_journals_journal_type_check_v3,
      drop constraint if exists financial_ledger_journals_revenue_reversal_line_fkey,
      drop constraint if exists financial_ledger_journals_revenue_reversal_line_key
  `.execute(db);

  await sql`
    alter table financial_ledger_journals
      drop column if exists revenue_reversal_line_id
  `.execute(db);

  await sql`
    drop trigger if exists reservation_revenue_reversal_lines_validate
      on reservation_revenue_reversal_lines
  `.execute(db);
  await sql`
    drop trigger if exists reservation_revenue_reversals_validate
      on reservation_revenue_reversals
  `.execute(db);
  await sql`
    drop trigger if exists reservation_revenue_reversal_lines_no_mutation
      on reservation_revenue_reversal_lines
  `.execute(db);
  await sql`
    drop trigger if exists reservation_revenue_reversals_no_mutation
      on reservation_revenue_reversals
  `.execute(db);
  await sql`drop function if exists prevent_reservation_revenue_reversal_mutation()`.execute(db);
  await sql`drop function if exists validate_reservation_revenue_reversal()`.execute(db);
  await sql`drop table if exists reservation_revenue_reversal_lines`.execute(db);
  await sql`drop table if exists reservation_revenue_reversals`.execute(db);

  await sql`
    alter table financial_ledger_journals
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
