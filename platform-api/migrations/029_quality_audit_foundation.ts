import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quality_standard_templates (
      id uuid primary key,
      code text not null unique
        check (code ~ '^[A-Z0-9_-]{2,50}$'),
      name text not null
        check (char_length(name) between 2 and 160),
      status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'INACTIVE')),
      current_version integer not null default 0
        check (current_version >= 0),
      created_by_user_id uuid not null references users(id) on delete restrict,
      updated_by_user_id uuid not null references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table quality_standard_template_versions (
      id uuid primary key,
      template_id uuid not null
        references quality_standard_templates(id) on delete restrict,
      version_number integer not null
        check (version_number > 0),
      status text not null default 'DRAFT'
        check (status in ('DRAFT', 'PUBLISHED', 'RETIRED')),
      title text not null
        check (char_length(title) between 2 and 200),
      notes text,
      created_by_user_id uuid not null references users(id) on delete restrict,
      published_by_user_id uuid references users(id) on delete restrict,
      published_at timestamptz,
      created_at timestamptz not null default now(),
      unique (template_id, version_number),
      unique (id, template_id),
      check (
        (status = 'DRAFT' and published_by_user_id is null and published_at is null)
        or
        (status in ('PUBLISHED', 'RETIRED')
          and published_by_user_id is not null
          and published_at is not null)
      )
    )
  `.execute(db);

  await sql`
    create table quality_standard_template_items (
      id uuid primary key,
      template_version_id uuid not null
        references quality_standard_template_versions(id) on delete restrict,
      code text not null
        check (code ~ '^[A-Z0-9_-]{2,60}$'),
      title text not null
        check (char_length(title) between 2 and 200),
      description text,
      category text not null
        check (char_length(category) between 1 and 100),
      check_type text not null
        check (
          check_type in (
            'MANDATORY_PASS',
            'SCORED_QUALITY_ITEM',
            'INFORMATIONAL_DISCLOSURE',
            'IMPROVEMENT_RECOMMENDATION'
          )
        ),
      max_score integer,
      sort_order integer not null default 0
        check (sort_order >= 0),
      created_at timestamptz not null default now(),
      unique (template_version_id, code),
      unique (id, template_version_id),
      check (
        (check_type = 'SCORED_QUALITY_ITEM' and max_score is not null and max_score > 0)
        or
        (check_type <> 'SCORED_QUALITY_ITEM' and max_score is null)
      )
    )
  `.execute(db);

  await sql`
    create index quality_template_items_version_sort_idx
      on quality_standard_template_items (template_version_id, sort_order, code)
  `.execute(db);

  await sql`
    create table quality_assessments (
      id uuid primary key,
      organization_id uuid not null,
      property_id uuid not null,
      template_version_id uuid not null
        references quality_standard_template_versions(id) on delete restrict,
      trigger_type text not null
        check (
          trigger_type in (
            'SCHEDULED_AUDIT',
            'REPEATED_LOW_REVIEWS',
            'SERIOUS_COMPLAINT',
            'OWNERSHIP_MANAGEMENT_CHANGE',
            'RENOVATION',
            'SAFETY_INCIDENT'
          )
        ),
      trigger_reference text,
      status text not null default 'DRAFT'
        check (status in ('DRAFT', 'IN_PROGRESS', 'COMPLETED')),
      assigned_auditor_user_id uuid references users(id) on delete restrict,
      created_by_user_id uuid not null references users(id) on delete restrict,
      started_at timestamptz,
      completed_at timestamptz,
      completed_by_user_id uuid references users(id) on delete restrict,
      mandatory_failure_count integer not null default 0
        check (mandatory_failure_count >= 0),
      score_basis_points integer
        check (score_basis_points is null or score_basis_points between 0 and 10000),
      outcome text
        check (outcome is null or outcome in ('PASS', 'FAIL')),
      requires_lifecycle_review boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (
        (status = 'DRAFT'
          and started_at is null
          and completed_at is null
          and completed_by_user_id is null
          and outcome is null)
        or
        (status = 'IN_PROGRESS'
          and started_at is not null
          and completed_at is null
          and completed_by_user_id is null
          and outcome is null)
        or
        (status = 'COMPLETED'
          and started_at is not null
          and completed_at is not null
          and completed_by_user_id is not null
          and outcome is not null)
      )
    )
  `.execute(db);

  await sql`
    create index quality_assessments_property_created_idx
      on quality_assessments (organization_id, property_id, created_at desc, id desc)
  `.execute(db);

  await sql`
    create index quality_assessments_status_idx
      on quality_assessments (status, created_at desc)
  `.execute(db);

  await sql`
    create table quality_assessment_results (
      id uuid primary key,
      assessment_id uuid not null
        references quality_assessments(id) on delete restrict,
      template_item_id uuid not null
        references quality_standard_template_items(id) on delete restrict,
      result_status text not null
        check (result_status in ('PASS', 'FAIL', 'OBSERVED', 'NOT_APPLICABLE')),
      score integer
        check (score is null or score >= 0),
      notes text,
      recorded_by_user_id uuid not null references users(id) on delete restrict,
      recorded_at timestamptz not null default now(),
      unique (assessment_id, template_item_id)
    )
  `.execute(db);

  await sql`
    create index quality_assessment_results_assessment_idx
      on quality_assessment_results (assessment_id, recorded_at, id)
  `.execute(db);

  await sql`
    create or replace function prevent_published_quality_version_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.status in ('PUBLISHED', 'RETIRED') then
        raise exception 'published quality standard versions are immutable';
      end if;

      if tg_op = 'DELETE' then
        return old;
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger quality_standard_versions_immutable
      before update or delete on quality_standard_template_versions
      for each row execute function prevent_published_quality_version_mutation()
  `.execute(db);

  await sql`
    create or replace function guard_quality_template_item_mutation()
    returns trigger
    language plpgsql
    as $$
    declare
      version_id uuid;
      version_status text;
    begin
      if tg_op = 'DELETE' then
        version_id := old.template_version_id;
      else
        version_id := new.template_version_id;
      end if;

      select status
      into version_status
      from quality_standard_template_versions
      where id = version_id;

      if version_status is null then
        raise exception 'quality standard version not found';
      end if;

      if version_status <> 'DRAFT' then
        raise exception 'published quality standard items are immutable';
      end if;

      if tg_op = 'DELETE' then
        return old;
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger quality_template_items_draft_only
      before insert or update or delete on quality_standard_template_items
      for each row execute function guard_quality_template_item_mutation()
  `.execute(db);

  await sql`
    create or replace function prevent_completed_quality_assessment_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      if old.status = 'COMPLETED' then
        raise exception 'completed quality assessments are immutable';
      end if;

      if tg_op = 'DELETE' then
        return old;
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger quality_assessments_completed_immutable
      before update or delete on quality_assessments
      for each row execute function prevent_completed_quality_assessment_mutation()
  `.execute(db);

  await sql`
    create or replace function guard_quality_assessment_result_mutation()
    returns trigger
    language plpgsql
    as $$
    declare
      target_assessment_id uuid;
      assessment_status text;
    begin
      if tg_op = 'DELETE' then
        target_assessment_id := old.assessment_id;
      else
        target_assessment_id := new.assessment_id;
      end if;

      select status
      into assessment_status
      from quality_assessments
      where id = target_assessment_id;

      if assessment_status is null then
        raise exception 'quality assessment not found';
      end if;

      if assessment_status = 'COMPLETED' then
        raise exception 'completed quality assessment results are immutable';
      end if;

      if tg_op = 'DELETE' then
        return old;
      end if;

      return new;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger quality_assessment_results_completed_immutable
      before insert or update or delete on quality_assessment_results
      for each row execute function guard_quality_assessment_result_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists quality_assessment_results_completed_immutable
      on quality_assessment_results
  `.execute(db);

  await sql`
    drop function if exists guard_quality_assessment_result_mutation()
  `.execute(db);

  await sql`
    drop trigger if exists quality_assessments_completed_immutable
      on quality_assessments
  `.execute(db);

  await sql`
    drop function if exists prevent_completed_quality_assessment_mutation()
  `.execute(db);

  await sql`
    drop trigger if exists quality_template_items_draft_only
      on quality_standard_template_items
  `.execute(db);

  await sql`
    drop function if exists guard_quality_template_item_mutation()
  `.execute(db);

  await sql`
    drop trigger if exists quality_standard_versions_immutable
      on quality_standard_template_versions
  `.execute(db);

  await sql`
    drop function if exists prevent_published_quality_version_mutation()
  `.execute(db);

  await sql`drop table if exists quality_assessment_results`.execute(db);
  await sql`drop table if exists quality_assessments`.execute(db);
  await sql`drop table if exists quality_standard_template_items`.execute(db);
  await sql`drop table if exists quality_standard_template_versions`.execute(db);
  await sql`drop table if exists quality_standard_templates`.execute(db);
}
