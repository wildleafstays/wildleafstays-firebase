import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table reservation_revenue_schedules (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null unique,
      reservation_financial_snapshot_id uuid not null unique,
      quote_id uuid not null unique,
      allocation_version text not null
        check (allocation_version = 'REVENUE_BASIS_V1'),
      currency_code char(3) not null,
      accepted_total_minor integer not null check (accepted_total_minor >= 0),
      consideration_minor integer not null check (consideration_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      exclusive_tax_minor integer not null check (exclusive_tax_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      revenue_basis_minor integer not null check (revenue_basis_minor >= 0),
      line_count integer not null check (line_count >= 0),
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      foreign key (reservation_financial_snapshot_id)
        references reservation_financial_snapshots(id) on delete restrict,
      foreign key (quote_id)
        references quote_promotion_snapshots(quote_id) on delete restrict,
      check (tax_minor = inclusive_tax_minor + exclusive_tax_minor),
      check (consideration_minor = accepted_total_minor - exclusive_tax_minor),
      check (revenue_basis_minor = consideration_minor - inclusive_tax_minor)
    )
  `.execute(db);

  await sql`
    create table reservation_revenue_schedule_lines (
      id uuid primary key default gen_random_uuid(),
      schedule_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null,
      quote_id uuid not null,
      line_number integer not null check (line_number >= 1),
      line_type text not null
        check (line_type in ('ACCOMMODATION', 'EXTRA_GUEST', 'FEE')),
      service_scope text not null
        check (service_scope in ('NIGHT', 'STAY')),
      stay_date date,
      source_quote_night_id uuid,
      source_final_fee_line_id uuid,
      source_line_key text,
      consideration_minor integer not null check (consideration_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      revenue_minor integer not null check (revenue_minor >= 0),
      currency_code char(3) not null,
      created_at timestamptz not null default now(),
      unique (schedule_id, line_number),
      unique (schedule_id, line_type, source_quote_night_id),
      unique (schedule_id, source_final_fee_line_id),
      foreign key (schedule_id, property_id, organization_id)
        references reservation_revenue_schedules(id, property_id, organization_id)
        on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict,
      foreign key (source_quote_night_id)
        references quote_nights(id) on delete restrict,
      foreign key (source_final_fee_line_id, quote_id)
        references quote_final_fee_lines(id, quote_id) on delete restrict,
      check (inclusive_tax_minor <= consideration_minor),
      check (revenue_minor = consideration_minor - inclusive_tax_minor),
      check (
        (
          line_type in ('ACCOMMODATION', 'EXTRA_GUEST')
          and service_scope = 'NIGHT'
          and stay_date is not null
          and source_quote_night_id is not null
          and source_final_fee_line_id is null
          and source_line_key is null
        )
        or
        (
          line_type = 'FEE'
          and source_quote_night_id is null
          and source_final_fee_line_id is not null
          and source_line_key is not null
          and (
            (service_scope = 'NIGHT' and stay_date is not null)
            or
            (service_scope = 'STAY' and stay_date is null)
          )
        )
      )
    )
  `.execute(db);

  await sql`
    create index reservation_revenue_schedules_property_created_idx
      on reservation_revenue_schedules (property_id, created_at desc, id desc)
  `.execute(db);

  await sql`
    create index reservation_revenue_schedule_lines_schedule_idx
      on reservation_revenue_schedule_lines (schedule_id, line_number)
  `.execute(db);

  await sql`
    create or replace function validate_reservation_revenue_schedule()
    returns trigger
    language plpgsql
    as $$
    declare
      target_schedule_id uuid;
      schedule_row reservation_revenue_schedules%rowtype;
      financial_row reservation_financial_snapshots%rowtype;
      observed_line_count integer;
      observed_consideration bigint;
      observed_inclusive_tax bigint;
      observed_revenue bigint;
    begin
      if tg_table_name = 'reservation_revenue_schedules' then
        target_schedule_id := new.id;
      else
        target_schedule_id := new.schedule_id;
      end if;

      select *
      into schedule_row
      from reservation_revenue_schedules
      where id = target_schedule_id;

      if not found then
        raise exception 'reservation revenue schedule does not exist';
      end if;

      select *
      into financial_row
      from reservation_financial_snapshots
      where id = schedule_row.reservation_financial_snapshot_id;

      if not found then
        raise exception 'reservation revenue schedule financial snapshot does not exist';
      end if;

      if financial_row.reservation_id <> schedule_row.reservation_id
        or financial_row.organization_id <> schedule_row.organization_id
        or financial_row.property_id <> schedule_row.property_id
        or financial_row.quote_id <> schedule_row.quote_id
        or financial_row.currency_code <> schedule_row.currency_code
        or financial_row.total_minor <> schedule_row.accepted_total_minor
        or financial_row.inclusive_tax_minor <> schedule_row.inclusive_tax_minor
        or financial_row.exclusive_tax_minor <> schedule_row.exclusive_tax_minor
        or financial_row.tax_minor <> schedule_row.tax_minor
      then
        raise exception 'reservation revenue schedule does not match accepted financial snapshot';
      end if;

      if exists (
        select 1
        from reservation_revenue_schedule_lines line
        where line.schedule_id = target_schedule_id
          and (
            line.organization_id <> schedule_row.organization_id
            or line.property_id <> schedule_row.property_id
            or line.reservation_id <> schedule_row.reservation_id
            or line.quote_id <> schedule_row.quote_id
            or line.currency_code <> schedule_row.currency_code
          )
      ) then
        raise exception 'reservation revenue schedule line identity does not match its schedule';
      end if;

      if exists (
        select 1
        from reservation_revenue_schedule_lines line
        left join quote_nights night
          on night.id = line.source_quote_night_id
        where line.schedule_id = target_schedule_id
          and line.line_type in ('ACCOMMODATION', 'EXTRA_GUEST')
          and (
            night.id is null
            or night.quote_id <> schedule_row.quote_id
            or night.organization_id <> schedule_row.organization_id
            or night.property_id <> schedule_row.property_id
            or night.stay_date <> line.stay_date
          )
      ) then
        raise exception 'reservation revenue nightly line does not match its immutable quote night';
      end if;

      if exists (
        select 1
        from reservation_revenue_schedule_lines line
        left join quote_final_fee_lines fee
          on fee.id = line.source_final_fee_line_id
          and fee.quote_id = line.quote_id
        where line.schedule_id = target_schedule_id
          and line.line_type = 'FEE'
          and (
            fee.id is null
            or fee.organization_id <> schedule_row.organization_id
            or fee.property_id <> schedule_row.property_id
            or fee.line_key <> line.source_line_key
            or fee.stay_date is distinct from line.stay_date
            or fee.fee_minor <> line.consideration_minor
          )
      ) then
        raise exception 'reservation revenue fee line does not match its immutable final fee line';
      end if;

      if exists (
        select 1
        from reservation_revenue_schedule_lines line
        where line.schedule_id = target_schedule_id
          and line.line_type in ('ACCOMMODATION', 'EXTRA_GUEST')
          and line.inclusive_tax_minor <> (
            select coalesce(sum(tax.tax_minor), 0)
            from quote_final_tax_lines tax
            where tax.quote_id = schedule_row.quote_id
              and tax.price_mode = 'INCLUSIVE'
              and tax.charge_type = line.line_type
              and tax.stay_date = line.stay_date
              and tax.final_fee_line_id is null
          )
      ) then
        raise exception 'reservation revenue nightly line inclusive tax does not match final tax lines';
      end if;

      if exists (
        select 1
        from reservation_revenue_schedule_lines line
        where line.schedule_id = target_schedule_id
          and line.line_type = 'FEE'
          and line.inclusive_tax_minor <> (
            select coalesce(sum(tax.tax_minor), 0)
            from quote_final_tax_lines tax
            where tax.quote_id = schedule_row.quote_id
              and tax.price_mode = 'INCLUSIVE'
              and tax.charge_type = 'FEE'
              and tax.final_fee_line_id = line.source_final_fee_line_id
          )
      ) then
        raise exception 'reservation revenue fee line inclusive tax does not match final tax lines';
      end if;

      select
        count(*),
        coalesce(sum(line.consideration_minor), 0),
        coalesce(sum(line.inclusive_tax_minor), 0),
        coalesce(sum(line.revenue_minor), 0)
      into
        observed_line_count,
        observed_consideration,
        observed_inclusive_tax,
        observed_revenue
      from reservation_revenue_schedule_lines line
      where line.schedule_id = target_schedule_id;

      if observed_line_count <> schedule_row.line_count then
        raise exception 'reservation revenue schedule line count does not match header';
      end if;

      if observed_consideration <> schedule_row.consideration_minor
        or observed_inclusive_tax <> schedule_row.inclusive_tax_minor
        or observed_revenue <> schedule_row.revenue_basis_minor
      then
        raise exception 'reservation revenue schedule lines do not reconcile to header';
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create constraint trigger reservation_revenue_schedules_validate
      after insert on reservation_revenue_schedules
      deferrable initially deferred
      for each row execute function validate_reservation_revenue_schedule()
  `.execute(db);

  await sql`
    create constraint trigger reservation_revenue_schedule_lines_validate
      after insert on reservation_revenue_schedule_lines
      deferrable initially deferred
      for each row execute function validate_reservation_revenue_schedule()
  `.execute(db);

  await sql`
    create or replace function prevent_reservation_revenue_schedule_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'reservation revenue schedules are immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger reservation_revenue_schedules_no_mutation
      before update or delete on reservation_revenue_schedules
      for each row execute function prevent_reservation_revenue_schedule_mutation()
  `.execute(db);

  await sql`
    create trigger reservation_revenue_schedule_lines_no_mutation
      before update or delete on reservation_revenue_schedule_lines
      for each row execute function prevent_reservation_revenue_schedule_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists reservation_revenue_schedule_lines_validate
      on reservation_revenue_schedule_lines
  `.execute(db);

  await sql`
    drop trigger if exists reservation_revenue_schedules_validate
      on reservation_revenue_schedules
  `.execute(db);

  await sql`
    drop trigger if exists reservation_revenue_schedule_lines_no_mutation
      on reservation_revenue_schedule_lines
  `.execute(db);

  await sql`
    drop trigger if exists reservation_revenue_schedules_no_mutation
      on reservation_revenue_schedules
  `.execute(db);

  await sql`drop function if exists prevent_reservation_revenue_schedule_mutation()`.execute(db);
  await sql`drop function if exists validate_reservation_revenue_schedule()`.execute(db);

  await sql`drop table if exists reservation_revenue_schedule_lines`.execute(db);
  await sql`drop table if exists reservation_revenue_schedules`.execute(db);
}
