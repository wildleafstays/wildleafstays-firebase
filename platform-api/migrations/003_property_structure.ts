import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table property_structures (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text,
      name text not null,
      structure_type text not null check (
        structure_type in ('BUILDING', 'WING', 'BLOCK', 'TOWER', 'CLUSTER', 'OTHER')
      ),
      sort_order integer not null default 0 check (sort_order >= 0),
      has_lift boolean not null default false,
      wheelchair_accessible boolean not null default false,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'RETIRED')),
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create unique index property_structures_code_unique_ci
      on property_structures (property_id, lower(code))
      where code is not null
  `.execute(db);

  await sql`
    create index property_structures_property_idx
      on property_structures (property_id, status, sort_order)
  `.execute(db);

  await sql`
    create table property_floors (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      structure_id uuid not null,
      code text,
      name text not null,
      floor_number integer,
      sort_order integer not null default 0 check (sort_order >= 0),
      lift_accessible boolean not null default false,
      wheelchair_accessible boolean not null default false,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'RETIRED')),
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, structure_id, property_id, organization_id),
      foreign key (structure_id, property_id, organization_id)
        references property_structures(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create unique index property_floors_code_unique_ci
      on property_floors (structure_id, lower(code))
      where code is not null
  `.execute(db);

  await sql`
    create index property_floors_property_idx
      on property_floors (property_id, structure_id, status, sort_order)
  `.execute(db);

  await sql`
    create table room_categories (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      code text not null,
      name text not null,
      accommodation_type text not null check (
        accommodation_type in (
          'ROOM', 'SUITE', 'COTTAGE', 'HUT', 'VILLA',
          'APARTMENT', 'DORM', 'TENT', 'OTHER'
        )
      ),
      description text,
      base_occupancy integer not null default 2 check (base_occupancy > 0),
      max_adults integer not null default 2 check (max_adults > 0),
      max_children integer not null default 0 check (max_children >= 0),
      max_occupancy integer not null default 2 check (max_occupancy > 0),
      size_sqm numeric(7, 2),
      bed_configuration text,
      extra_bed_allowed boolean not null default false,
      default_view_label text,
      sort_order integer not null default 0 check (sort_order >= 0),
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'RETIRED')),
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (base_occupancy <= max_occupancy),
      check (max_adults <= max_occupancy),
      check (size_sqm is null or size_sqm > 0)
    )
  `.execute(db);

  await sql`
    create unique index room_categories_code_unique_ci
      on room_categories (property_id, lower(code))
  `.execute(db);

  await sql`
    create index room_categories_property_idx
      on room_categories (property_id, status, sort_order)
  `.execute(db);

  await sql`
    create table physical_units (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      room_category_id uuid not null,
      structure_id uuid,
      floor_id uuid,
      unit_code text not null,
      display_name text,
      has_view boolean not null default false,
      view_label text,
      wheelchair_accessible boolean not null default false,
      step_free_accessible boolean not null default false,
      lift_accessible boolean not null default false,
      smoking_policy text not null default 'NON_SMOKING'
        check (smoking_policy in ('NON_SMOKING', 'SMOKING')),
      internal_notes text,
      sort_order integer not null default 0 check (sort_order >= 0),
      status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED')),
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (room_category_id, property_id, organization_id)
        references room_categories(id, property_id, organization_id) on delete restrict,
      foreign key (structure_id, property_id, organization_id)
        references property_structures(id, property_id, organization_id) on delete restrict,
      foreign key (floor_id, structure_id, property_id, organization_id)
        references property_floors(id, structure_id, property_id, organization_id) on delete restrict,
      check (floor_id is null or structure_id is not null),
      check (has_view or view_label is null)
    )
  `.execute(db);

  await sql`
    create unique index physical_units_code_unique_ci
      on physical_units (property_id, lower(unit_code))
  `.execute(db);

  await sql`
    create index physical_units_property_idx
      on physical_units (property_id, status, sort_order)
  `.execute(db);

  await sql`
    create index physical_units_category_idx
      on physical_units (room_category_id, status)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists physical_units`.execute(db);
  await sql`drop table if exists room_categories`.execute(db);
  await sql`drop table if exists property_floors`.execute(db);
  await sql`drop table if exists property_structures`.execute(db);
}
