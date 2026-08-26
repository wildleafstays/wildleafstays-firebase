import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table room_categories
      add column base_adults integer,
      add column base_children integer,
      add column default_extra_adult_minor integer,
      add column default_extra_child_minor integer,

      add constraint room_categories_base_adults_valid
        check (
          base_adults is null
          or base_adults between 1 and 100
        ),

      add constraint room_categories_base_children_valid
        check (
          base_children is null
          or base_children between 0 and 100
        ),

      add constraint room_categories_default_extra_adult_valid
        check (
          default_extra_adult_minor is null
          or default_extra_adult_minor between 0 and 100000000
        ),

      add constraint room_categories_default_extra_child_valid
        check (
          default_extra_child_minor is null
          or default_extra_child_minor between 0 and 100000000
        ),

      add constraint room_categories_base_adults_within_max
        check (
          base_adults is null
          or base_adults <= max_adults
        ),

      add constraint room_categories_base_children_within_max
        check (
          base_children is null
          or base_children <= max_children
        ),

      add constraint room_categories_base_split_matches_total
        check (
          base_adults is null
          or base_children is null
          or base_adults + base_children = base_occupancy
        ),

      add constraint room_categories_base_split_within_max_occupancy
        check (
          base_adults is null
          or base_children is null
          or base_adults + base_children <= max_occupancy
        )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table room_categories
      drop constraint if exists room_categories_base_split_within_max_occupancy,
      drop constraint if exists room_categories_base_split_matches_total,
      drop constraint if exists room_categories_base_children_within_max,
      drop constraint if exists room_categories_base_adults_within_max,
      drop constraint if exists room_categories_default_extra_child_valid,
      drop constraint if exists room_categories_default_extra_adult_valid,
      drop constraint if exists room_categories_base_children_valid,
      drop constraint if exists room_categories_base_adults_valid,
      drop column if exists default_extra_child_minor,
      drop column if exists default_extra_adult_minor,
      drop column if exists base_children,
      drop column if exists base_adults
  `.execute(db);
}
