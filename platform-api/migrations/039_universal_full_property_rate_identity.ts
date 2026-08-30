import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Full-property pricing and occupancy are derived from every active physical
  // room and its single EP rate source. This row is only the stable product
  // identity needed by public quoting; it never owns a separate villa price.
  await sql`
    with active_categories as (
      select
        rc.organization_id,
        rc.property_id,
        rc.id as room_category_id,
        count(pu.id)::int as physical_capacity
      from room_categories rc
      join physical_units pu
        on pu.organization_id = rc.organization_id
       and pu.property_id = rc.property_id
       and pu.room_category_id = rc.id
       and pu.status = 'ACTIVE'
      where rc.status = 'ACTIVE'
      group by rc.organization_id, rc.property_id, rc.id
      having count(pu.id) > 0
    ),
    ep_sources as (
      select
        ac.organization_id,
        ac.property_id,
        ac.room_category_id,
        ac.physical_capacity,
        product.rate_plan_id,
        product.base_rate_minor,
        count(*) over (
          partition by ac.property_id, ac.room_category_id
        )::int as source_count
      from active_categories ac
      join rate_plan_products product
        on product.organization_id = ac.organization_id
       and product.property_id = ac.property_id
       and product.room_category_id = ac.room_category_id
       and product.product_type = 'ROOM_CATEGORY'
       and product.status = 'ACTIVE'
      join rate_plans plan
        on plan.id = product.rate_plan_id
       and plan.organization_id = product.organization_id
       and plan.property_id = product.property_id
       and plan.status = 'ACTIVE'
       and plan.meal_plan_code = 'EP'
    ),
    ready_properties as (
      select
        p.organization_id,
        p.id as property_id,
        min(source.rate_plan_id::text)::uuid as rate_plan_id,
        least(
          100000000::bigint,
          sum(source.base_rate_minor::bigint * source.physical_capacity)
        )::int as derived_base_rate_minor
      from properties p
      join ep_sources source
        on source.organization_id = p.organization_id
       and source.property_id = p.id
       and source.source_count = 1
      where p.sale_mode in ('BOTH', 'FULL_PROPERTY_ONLY')
        and p.status <> 'ARCHIVED'
      group by p.organization_id, p.id
      having count(*) = (
        select count(*)
        from active_categories category
        where category.organization_id = p.organization_id
          and category.property_id = p.id
      )
    )
    insert into rate_plan_products (
      id,
      organization_id,
      property_id,
      rate_plan_id,
      product_type,
      room_category_id,
      base_rate_minor,
      floor_rate_minor,
      ceiling_rate_minor,
      included_adults,
      included_children,
      max_adults,
      max_children,
      max_occupancy,
      extra_adult_minor,
      extra_child_minor,
      created_by_user_id,
      updated_by_user_id
    )
    select
      gen_random_uuid(),
      ready.organization_id,
      ready.property_id,
      ready.rate_plan_id,
      'FULL_PROPERTY',
      null,
      ready.derived_base_rate_minor,
      null,
      null,
      1,
      0,
      1,
      0,
      1,
      0,
      0,
      null,
      null
    from ready_properties ready
    where not exists (
      select 1
      from rate_plan_products existing
      join rate_plans existing_plan
        on existing_plan.id = existing.rate_plan_id
       and existing_plan.status = 'ACTIVE'
       and existing_plan.meal_plan_code = 'EP'
      where existing.organization_id = ready.organization_id
        and existing.property_id = ready.property_id
        and existing.product_type = 'FULL_PROPERTY'
        and existing.status = 'ACTIVE'
    )
    on conflict (rate_plan_id, product_type, room_category_id) do nothing
  `.execute(db);
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // The generated identity can be referenced by immutable quotes. Removing it
  // automatically would make rollback destructive, so the data remains valid.
}
