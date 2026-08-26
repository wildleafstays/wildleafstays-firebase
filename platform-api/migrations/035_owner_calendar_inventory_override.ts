import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table inventory_daily_buckets
      add column capacity_override integer,
      add constraint inventory_daily_buckets_capacity_override_valid
        check (capacity_override is null or capacity_override between 0 and 1000),
      drop constraint inventory_daily_buckets_check2,
      add constraint inventory_daily_buckets_effective_capacity_commitments
        check (
          coalesce(capacity_override, capacity) + overbooking_limit
            >= held_quantity + confirmed_quantity
        )
  `.execute(db);

  // Legacy room categories pre-date the owner-friendly pricing defaults.
  // Backfill a conservative room-only baseline so their calendar can be
  // edited immediately; owners can still change these values in setup.
  await sql`
    update room_categories
    set
      base_adults = case
        when base_adults is null or base_children is null
          then least(max_adults, base_occupancy)
        else base_adults
      end,
      base_children = case
        when base_adults is null or base_children is null
          then base_occupancy - least(max_adults, base_occupancy)
        else base_children
      end,
      default_extra_adult_minor = coalesce(default_extra_adult_minor, 0),
      default_extra_child_minor = coalesce(default_extra_child_minor, 0),
      updated_at = now()
    where base_adults is null
       or base_children is null
       or default_extra_adult_minor is null
       or default_extra_child_minor is null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1
        from inventory_daily_buckets
        where held_quantity + confirmed_quantity > capacity + overbooking_limit
      ) then
        raise exception
          'Cannot remove inventory capacity overrides while commitments exceed physical capacity';
      end if;

      alter table inventory_daily_buckets
        drop constraint inventory_daily_buckets_effective_capacity_commitments,
        drop constraint inventory_daily_buckets_capacity_override_valid,
        drop column capacity_override,
        add constraint inventory_daily_buckets_check2
          check (capacity + overbooking_limit >= held_quantity + confirmed_quantity);
    end
    $$
  `.execute(db);
}
