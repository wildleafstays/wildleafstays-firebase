import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table properties
      add column services_description text,
      add column spaces_description text,
      add column public_address text,
      add column location_description text,
      add column map_url text,
      add column nearby_attractions text
  `.execute(db);

  await sql`
    create table property_guest_reviews (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      reservation_id uuid not null unique,
      rating integer not null check (rating between 1 and 5),
      title text,
      review_text text not null,
      reviewer_display_name text not null,
      status text not null default 'PENDING'
        check (status in ('PENDING', 'PUBLISHED', 'REJECTED')),
      submitted_at timestamptz not null default now(),
      published_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      foreign key (reservation_id, property_id, organization_id)
        references reservations(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_guest_reviews_public_idx
      on property_guest_reviews (property_id, status, published_at desc)
      where status = 'PUBLISHED'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists property_guest_reviews`.execute(db);
  await sql`
    alter table properties
      drop column if exists nearby_attractions,
      drop column if exists map_url,
      drop column if exists location_description,
      drop column if exists public_address,
      drop column if exists spaces_description,
      drop column if exists services_description
  `.execute(db);
}
