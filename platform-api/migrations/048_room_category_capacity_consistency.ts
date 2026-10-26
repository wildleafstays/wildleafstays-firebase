import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Older onboarding accepted a total occupancy that could not be represented
  // by the adult/child limits. Preserve the configured total and child limit,
  // and expand the adult limit only as much as needed to make the category
  // allocatable. This also unblocks creation of its room-rate product.
  await sql`
    update room_categories
    set
      max_adults = greatest(max_adults, max_occupancy - max_children),
      updated_at = now()
    where max_occupancy > max_adults + max_children
  `.execute(db);

  await sql`
    alter table room_categories
      add constraint room_categories_max_guest_split_covers_occupancy
      check (max_occupancy <= max_adults + max_children)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table room_categories
      drop constraint if exists room_categories_max_guest_split_covers_occupancy
  `.execute(db);
}
