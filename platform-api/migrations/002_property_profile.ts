import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table properties
      add column property_type text,
      add column sale_mode text,
      add column short_description text,
      add column description text,
      add column address_line_1 text,
      add column address_line_2 text,
      add column locality text,
      add column city text,
      add column state_region text,
      add column postal_code text,
      add column country_code char(2) not null default 'IN',
      add column latitude numeric(9, 6),
      add column longitude numeric(9, 6),
      add column contact_phone text,
      add column contact_email text,
      add column check_in_time time,
      add column check_out_time time
  `.execute(db);

  await sql`
    alter table properties
      add constraint properties_property_type_check
        check (
          property_type is null
          or property_type in (
            'HOTEL',
            'RESORT',
            'VILLA',
            'HOMESTAY',
            'COTTAGE_CLUSTER',
            'APARTMENT',
            'HOSTEL',
            'OTHER'
          )
        ),
      add constraint properties_sale_mode_check
        check (
          sale_mode is null
          or sale_mode in ('ROOMS_ONLY', 'FULL_PROPERTY_ONLY', 'BOTH')
        ),
      add constraint properties_latitude_check
        check (latitude is null or latitude between -90 and 90),
      add constraint properties_longitude_check
        check (longitude is null or longitude between -180 and 180)
  `.execute(db);

  await sql`
    create index properties_location_idx
      on properties (country_code, state_region, city)
      where status <> 'ARCHIVED'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists properties_location_idx`.execute(db);

  await sql`
    alter table properties
      drop constraint if exists properties_longitude_check,
      drop constraint if exists properties_latitude_check,
      drop constraint if exists properties_sale_mode_check,
      drop constraint if exists properties_property_type_check,
      drop column if exists check_out_time,
      drop column if exists check_in_time,
      drop column if exists contact_email,
      drop column if exists contact_phone,
      drop column if exists longitude,
      drop column if exists latitude,
      drop column if exists country_code,
      drop column if exists postal_code,
      drop column if exists state_region,
      drop column if exists city,
      drop column if exists locality,
      drop column if exists address_line_2,
      drop column if exists address_line_1,
      drop column if exists description,
      drop column if exists short_description,
      drop column if exists sale_mode,
      drop column if exists property_type
  `.execute(db);
}
