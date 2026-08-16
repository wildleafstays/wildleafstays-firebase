import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table properties
      add column submission_sequence integer not null default 0 check (submission_sequence >= 0),
      add column submitted_at timestamptz,
      add column approved_at timestamptz,
      add column live_at timestamptz
  `.execute(db);

  await sql`
    create table amenity_catalog (
      code text primary key,
      name text not null,
      category text not null check (
        category in (
          'CONNECTIVITY',
          'PARKING_TRANSPORT',
          'FOOD_BEVERAGE',
          'ACCESSIBILITY',
          'LEISURE',
          'FAMILY',
          'BUSINESS',
          'SERVICES',
          'SAFETY',
          'OUTDOOR',
          'OTHER'
        )
      ),
      active boolean not null default true,
      sort_order integer not null default 0 check (sort_order >= 0),
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    insert into amenity_catalog (code, name, category, sort_order)
    values
      ('WIFI', 'Wi-Fi', 'CONNECTIVITY', 10),
      ('PARKING', 'Parking', 'PARKING_TRANSPORT', 20),
      ('EV_CHARGING', 'EV Charging', 'PARKING_TRANSPORT', 30),
      ('RESTAURANT', 'Restaurant', 'FOOD_BEVERAGE', 40),
      ('ROOM_SERVICE', 'Room Service', 'FOOD_BEVERAGE', 50),
      ('BREAKFAST', 'Breakfast', 'FOOD_BEVERAGE', 60),
      ('LIFT', 'Lift / Elevator', 'ACCESSIBILITY', 70),
      ('WHEELCHAIR_ACCESS', 'Wheelchair Access', 'ACCESSIBILITY', 80),
      ('STEP_FREE_ACCESS', 'Step-Free Access', 'ACCESSIBILITY', 90),
      ('SWIMMING_POOL', 'Swimming Pool', 'LEISURE', 100),
      ('SPA', 'Spa', 'LEISURE', 110),
      ('GYM', 'Gym', 'LEISURE', 120),
      ('KIDS_AREA', 'Kids Area', 'FAMILY', 130),
      ('POWER_BACKUP', 'Power Backup', 'SERVICES', 140),
      ('LAUNDRY', 'Laundry Service', 'SERVICES', 150),
      ('HOUSEKEEPING', 'Housekeeping', 'SERVICES', 160),
      ('CCTV', 'CCTV', 'SAFETY', 170),
      ('FIRE_SAFETY', 'Fire Safety Equipment', 'SAFETY', 180),
      ('GARDEN', 'Garden', 'OUTDOOR', 190),
      ('BONFIRE', 'Bonfire Area', 'OUTDOOR', 200)
  `.execute(db);

  await sql`
    create table property_amenities (
      organization_id uuid not null,
      property_id uuid not null,
      amenity_code text not null references amenity_catalog(code) on delete restrict,
      details text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (property_id, amenity_code),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index property_amenities_property_idx
      on property_amenities (property_id, amenity_code)
  `.execute(db);

  await sql`
    create table property_policies (
      property_id uuid primary key,
      organization_id uuid not null,
      children_policy text not null default 'ALLOWED' check (
        children_policy in ('ALLOWED', 'NOT_ALLOWED', 'RESTRICTIONS_APPLY')
      ),
      pets_policy text not null default 'NOT_ALLOWED' check (
        pets_policy in ('ALLOWED', 'NOT_ALLOWED', 'ON_REQUEST')
      ),
      smoking_policy text not null default 'NON_SMOKING' check (
        smoking_policy in ('NON_SMOKING', 'DESIGNATED_AREAS', 'SMOKING_ALLOWED')
      ),
      parties_events_policy text not null default 'ON_REQUEST' check (
        parties_events_policy in ('ALLOWED', 'NOT_ALLOWED', 'ON_REQUEST')
      ),
      minimum_checkin_age integer check (
        minimum_checkin_age is null or minimum_checkin_age between 0 and 100
      ),
      quiet_hours_start time,
      quiet_hours_end time,
      house_rules text,
      version integer not null default 1 check (version > 0),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create table property_media (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      media_type text not null check (media_type in ('IMAGE', 'VIDEO')),
      storage_provider text not null check (storage_provider in ('FIREBASE', 'GCS', 'OTHER')),
      storage_key text not null,
      mime_type text,
      alt_text text,
      caption text,
      is_cover boolean not null default false,
      sort_order integer not null default 0 check (sort_order >= 0),
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (storage_provider, storage_key),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (media_type = 'IMAGE' or is_cover = false)
    )
  `.execute(db);

  await sql`
    create unique index property_media_one_cover_idx
      on property_media (property_id)
      where is_cover = true and status = 'ACTIVE'
  `.execute(db);

  await sql`
    create index property_media_property_idx
      on property_media (property_id, status, sort_order)
  `.execute(db);

  await sql`
    create table property_documents (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      document_type text not null check (
        document_type in (
          'OWNERSHIP_PROOF',
          'LEASE_AGREEMENT',
          'PROPERTY_LICENSE',
          'LOCAL_REGISTRATION',
          'GST_CERTIFICATE',
          'PAN',
          'FSSAI',
          'FIRE_NOC',
          'ID_PROOF',
          'OTHER'
        )
      ),
      storage_provider text not null check (storage_provider in ('FIREBASE', 'GCS', 'OTHER')),
      storage_key text not null,
      original_filename text not null,
      issued_on date,
      expires_on date,
      verification_status text not null default 'PENDING' check (
        verification_status in ('PENDING', 'VERIFIED', 'REJECTED')
      ),
      verification_reason text,
      verified_by_user_id uuid references users(id) on delete restrict,
      verified_at timestamptz,
      status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
      created_by_user_id uuid references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (storage_provider, storage_key),
      unique (id, property_id, organization_id),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict,
      check (expires_on is null or issued_on is null or expires_on >= issued_on)
    )
  `.execute(db);

  await sql`
    create index property_documents_property_idx
      on property_documents (property_id, status, document_type)
  `.execute(db);

  await sql`
    create table property_review_rounds (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      property_id uuid not null,
      submission_number integer not null check (submission_number > 0),
      submitted_by_user_id uuid not null references users(id) on delete restrict,
      submitted_at timestamptz not null default now(),
      review_started_by_user_id uuid references users(id) on delete restrict,
      review_started_at timestamptz,
      decision text check (decision in ('CHANGES_REQUIRED', 'APPROVED')),
      decision_reason text,
      decided_by_user_id uuid references users(id) on delete restrict,
      decided_at timestamptz,
      status text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (property_id, submission_number),
      foreign key (property_id, organization_id)
        references properties(id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create unique index property_review_rounds_one_open_idx
      on property_review_rounds (property_id)
      where status = 'OPEN'
  `.execute(db);

  await sql`
    create index property_review_rounds_property_idx
      on property_review_rounds (property_id, submission_number desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists property_review_rounds`.execute(db);
  await sql`drop table if exists property_documents`.execute(db);
  await sql`drop table if exists property_media`.execute(db);
  await sql`drop table if exists property_policies`.execute(db);
  await sql`drop table if exists property_amenities`.execute(db);
  await sql`drop table if exists amenity_catalog`.execute(db);

  await sql`
    alter table properties
      drop column if exists live_at,
      drop column if exists approved_at,
      drop column if exists submitted_at,
      drop column if exists submission_sequence
  `.execute(db);
}
