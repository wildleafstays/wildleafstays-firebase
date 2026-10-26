import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table physical_units
      add column external_channel text,
      add column external_reference text
  `.execute(db);

  await sql`
    alter table physical_units
      add constraint physical_units_external_channel_check
      check (
        external_channel is null
        or external_channel in ('AIRBNB', 'BOOKING_COM', 'OTHER')
      ),
      add constraint physical_units_external_reference_pair_check
      check (
        (external_channel is null and external_reference is null)
        or (external_channel is not null and external_reference is not null)
      )
  `.execute(db);

  await sql`
    create unique index physical_units_external_reference_unique
      on physical_units (property_id, external_channel, external_reference)
      where external_channel is not null
        and external_reference is not null
        and status <> 'RETIRED'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists physical_units_external_reference_unique`.execute(db);
  await sql`
    alter table physical_units
      drop constraint if exists physical_units_external_reference_pair_check,
      drop constraint if exists physical_units_external_channel_check,
      drop column if exists external_reference,
      drop column if exists external_channel
  `.execute(db);
}
