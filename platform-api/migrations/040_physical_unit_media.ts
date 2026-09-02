import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table physical_unit_media (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      physical_unit_id uuid not null,
      storage_provider text not null check (
        storage_provider in ('FIREBASE', 'GCS', 'OTHER')
      ),
      storage_key text not null,
      mime_type text,
      alt_text text,
      caption text,
      sort_order integer not null default 0 check (sort_order >= 0),
      status text not null default 'ACTIVE' check (
        status in ('ACTIVE', 'ARCHIVED')
      ),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (storage_provider, storage_key),
      unique (id, physical_unit_id, property_id, organization_id),
      foreign key (physical_unit_id, property_id, organization_id)
        references physical_units(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index physical_unit_media_unit_idx
      on physical_unit_media (
        physical_unit_id,
        status,
        sort_order,
        created_at
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists physical_unit_media`.execute(db);
}
