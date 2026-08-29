import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table platform_owner_responsibility_terms (
      id uuid primary key default gen_random_uuid(),
      version_number integer not null unique check (version_number > 0),
      effective_from date not null unique,
      terms_text text not null check (char_length(terms_text) between 100 and 8000),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table property_owner_responsibility_acceptances (
      id uuid primary key default gen_random_uuid(),
      property_id uuid not null,
      organization_id uuid not null,
      accepted_terms_version_id uuid not null
        references platform_owner_responsibility_terms(id) on delete restrict,
      acceptance_text text not null check (char_length(acceptance_text) between 100 and 8000),
      accepted_by_user_id uuid not null references users(id) on delete restrict,
      accepted_at timestamptz not null default now(),
      ip_address text,
      user_agent text,
      unique (property_id, accepted_terms_version_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_owner_responsibility_acceptances_property_idx
      on property_owner_responsibility_acceptances (property_id, accepted_at desc)
  `.execute(db);

  await sql`
    insert into platform_owner_responsibility_terms (
      version_number,
      effective_from,
      terms_text
    ) values (
      1,
      '2026-08-28',
      'I confirm that I am authorized to list and manage this property. I am responsible for keeping all property information, photographs, amenities, room and category details, rates, inventory, fees, policies, licences, permissions and legal or regulatory disclosures complete, accurate and current. Except for statutory calculations controlled by the Wildleaf platform, I remain responsible for compliance with applicable laws and for delivering the guest service described in my listing. I understand that Wildleaf provides a booking platform and may review, restrict or suspend inaccurate, unlawful or misleading listings.'
    )
  `.execute(db);

  await sql`
    create or replace function protect_platform_owner_responsibility_terms()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'Owner responsibility term versions are append-only';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger platform_owner_responsibility_terms_append_only
      before update or delete on platform_owner_responsibility_terms
      for each row execute function protect_platform_owner_responsibility_terms()
  `.execute(db);

  await sql`
    create or replace function protect_property_owner_responsibility_acceptance()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'Accepted owner responsibility evidence is immutable';
    end;
    $$
  `.execute(db);

  await sql`
    create trigger property_owner_responsibility_acceptances_immutable
      before update or delete on property_owner_responsibility_acceptances
      for each row execute function protect_property_owner_responsibility_acceptance()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists property_owner_responsibility_acceptances_immutable
      on property_owner_responsibility_acceptances
  `.execute(db);
  await sql`drop function if exists protect_property_owner_responsibility_acceptance`.execute(db);
  await sql`
    drop trigger if exists platform_owner_responsibility_terms_append_only
      on platform_owner_responsibility_terms
  `.execute(db);
  await sql`drop function if exists protect_platform_owner_responsibility_terms`.execute(db);
  await sql`drop table if exists property_owner_responsibility_acceptances`.execute(db);
  await sql`drop table if exists platform_owner_responsibility_terms`.execute(db);
}
