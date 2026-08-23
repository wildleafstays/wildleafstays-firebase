import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table financial_ledger_journals (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      payment_intent_id uuid not null,
      journal_type text not null
        check (journal_type in ('PAYMENT_RECEIVED', 'REFUND_PROCESSED')),
      payment_evidence_id uuid,
      refund_finalization_id uuid,
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null,
      occurred_at timestamptz not null,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      unique (payment_evidence_id),
      unique (refund_finalization_id),
      foreign key (payment_intent_id, property_id, organization_id)
        references payment_intents(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      foreign key (payment_evidence_id, property_id, organization_id)
        references payment_provider_evidence(id, property_id, organization_id) on delete restrict,
      foreign key (refund_finalization_id, property_id, organization_id)
        references payment_refund_finalizations(id, property_id, organization_id) on delete restrict,
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
    )
  `.execute(db);

  await sql`
    create table financial_ledger_entries (
      id uuid primary key default gen_random_uuid(),
      journal_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      line_number smallint not null check (line_number in (1, 2)),
      account_code text not null
        check (account_code in ('PAYMENT_PROVIDER_CLEARING', 'GUEST_FUNDS_HELD')),
      direction text not null check (direction in ('DEBIT', 'CREDIT')),
      amount_minor integer not null check (amount_minor > 0),
      currency_code char(3) not null,
      created_at timestamptz not null default now(),
      unique (journal_id, line_number),
      foreign key (journal_id, property_id, organization_id)
        references financial_ledger_journals(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index financial_ledger_journals_property_occurred_idx
      on financial_ledger_journals (property_id, occurred_at desc, id desc)
  `.execute(db);

  await sql`
    create index financial_ledger_journals_reservation_occurred_idx
      on financial_ledger_journals (reservation_id, occurred_at, id)
  `.execute(db);

  await sql`
    create index financial_ledger_journals_payment_intent_occurred_idx
      on financial_ledger_journals (payment_intent_id, occurred_at, id)
  `.execute(db);

  await sql`
    insert into financial_ledger_journals (
      id,
      organization_id,
      property_id,
      reservation_id,
      payment_intent_id,
      journal_type,
      payment_evidence_id,
      refund_finalization_id,
      amount_minor,
      currency_code,
      occurred_at,
      source,
      request_id,
      correlation_id
    )
    select
      gen_random_uuid(),
      evidence.organization_id,
      evidence.property_id,
      evidence.reservation_id,
      evidence.payment_intent_id,
      'PAYMENT_RECEIVED',
      evidence.id,
      null,
      evidence.amount_minor,
      evidence.currency_code,
      evidence.received_at,
      evidence.source,
      evidence.request_id,
      evidence.correlation_id
    from payment_provider_evidence evidence
    where evidence.amount_minor > 0
  `.execute(db);

  await sql`
    insert into financial_ledger_journals (
      id,
      organization_id,
      property_id,
      reservation_id,
      payment_intent_id,
      journal_type,
      payment_evidence_id,
      refund_finalization_id,
      amount_minor,
      currency_code,
      occurred_at,
      source,
      request_id,
      correlation_id
    )
    select
      gen_random_uuid(),
      finalization.organization_id,
      finalization.property_id,
      finalization.reservation_id,
      finalization.payment_intent_id,
      'REFUND_PROCESSED',
      null,
      finalization.id,
      finalization.amount_minor,
      finalization.currency_code,
      finalization.provider_event_created_at,
      finalization.source,
      finalization.request_id,
      finalization.correlation_id
    from payment_refund_finalizations finalization
    where finalization.status = 'PROCESSED'
  `.execute(db);

  await sql`
    insert into financial_ledger_entries (
      id,
      journal_id,
      organization_id,
      property_id,
      line_number,
      account_code,
      direction,
      amount_minor,
      currency_code
    )
    select
      gen_random_uuid(),
      journal.id,
      journal.organization_id,
      journal.property_id,
      1,
      case
        when journal.journal_type = 'PAYMENT_RECEIVED' then 'PAYMENT_PROVIDER_CLEARING'
        else 'GUEST_FUNDS_HELD'
      end,
      'DEBIT',
      journal.amount_minor,
      journal.currency_code
    from financial_ledger_journals journal
    union all
    select
      gen_random_uuid(),
      journal.id,
      journal.organization_id,
      journal.property_id,
      2,
      case
        when journal.journal_type = 'PAYMENT_RECEIVED' then 'GUEST_FUNDS_HELD'
        else 'PAYMENT_PROVIDER_CLEARING'
      end,
      'CREDIT',
      journal.amount_minor,
      journal.currency_code
    from financial_ledger_journals journal
  `.execute(db);

  await sql`
    do $$
    begin
      if exists (
        select 1
        from financial_ledger_journals journal
        where
          (select count(*) from financial_ledger_entries entry where entry.journal_id = journal.id) <> 2
          or not exists (
            select 1
            from financial_ledger_entries entry
            where entry.journal_id = journal.id
              and entry.line_number = 1
              and entry.direction = 'DEBIT'
              and entry.amount_minor = journal.amount_minor
              and entry.currency_code = journal.currency_code
              and entry.account_code = case
                when journal.journal_type = 'PAYMENT_RECEIVED'
                  then 'PAYMENT_PROVIDER_CLEARING'
                else 'GUEST_FUNDS_HELD'
              end
          )
          or not exists (
            select 1
            from financial_ledger_entries entry
            where entry.journal_id = journal.id
              and entry.line_number = 2
              and entry.direction = 'CREDIT'
              and entry.amount_minor = journal.amount_minor
              and entry.currency_code = journal.currency_code
              and entry.account_code = case
                when journal.journal_type = 'PAYMENT_RECEIVED'
                  then 'GUEST_FUNDS_HELD'
                else 'PAYMENT_PROVIDER_CLEARING'
              end
          )
      ) then
        raise exception 'financial ledger backfill produced an invalid journal';
      end if;
    end;
    $$
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
    create or replace function prevent_financial_ledger_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'financial ledger records are immutable';
    end;
    $$
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

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists financial_ledger_entries_validate
      on financial_ledger_entries
  `.execute(db);

  await sql`
    drop trigger if exists financial_ledger_journals_validate
      on financial_ledger_journals
  `.execute(db);

  await sql`
    drop trigger if exists financial_ledger_entries_no_mutation
      on financial_ledger_entries
  `.execute(db);

  await sql`
    drop trigger if exists financial_ledger_journals_no_mutation
      on financial_ledger_journals
  `.execute(db);

  await sql`drop function if exists prevent_financial_ledger_mutation()`.execute(db);
  await sql`drop function if exists validate_financial_ledger_journal()`.execute(db);

  await sql`drop table if exists financial_ledger_entries`.execute(db);
  await sql`drop table if exists financial_ledger_journals`.execute(db);
}
