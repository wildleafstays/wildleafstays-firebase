import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // A missing promotion setting previously made an otherwise complete hotel
  // unable to create an exact public quote. No promotions is the safe default:
  // it adds no discount and keeps explicit future owner configuration intact.
  await sql`
    insert into property_promotion_settings (
      property_id,
      organization_id,
      created_by_user_id,
      updated_by_user_id
    )
    select p.id, p.organization_id, null, null
    from properties p
    where not exists (
      select 1
      from property_promotion_settings s
      where s.property_id = p.id
    )
    on conflict (property_id) do nothing
  `.execute(db);

  await sql`
    insert into property_promotion_setting_versions (
      organization_id,
      property_id,
      version_number,
      effective_from,
      promotion_mode,
      created_by_user_id
    )
    select s.organization_id, s.property_id, 1, current_date, 'NO_PROMOTIONS', null
    from property_promotion_settings s
    where s.current_version = 0
      and not exists (
        select 1
        from property_promotion_setting_versions v
        where v.property_id = s.property_id
      )
    on conflict (property_id, version_number) do nothing
  `.execute(db);

  await sql`
    update property_promotion_settings s
    set current_version = 1,
        updated_at = now()
    where s.current_version = 0
      and exists (
        select 1
        from property_promotion_setting_versions v
        where v.property_id = s.property_id
          and v.version_number = 1
          and v.promotion_mode = 'NO_PROMOTIONS'
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    delete from property_promotion_setting_versions v
    where v.version_number = 1
      and v.promotion_mode = 'NO_PROMOTIONS'
      and v.created_by_user_id is null
      and not exists (
        select 1
        from quote_promotion_snapshots q
        where q.promotion_settings_version_id = v.id
      )
  `.execute(db);

  await sql`
    update property_promotion_settings s
    set current_version = 0,
        updated_at = now()
    where s.current_version = 1
      and not exists (
        select 1
        from property_promotion_setting_versions v
        where v.property_id = s.property_id
      )
  `.execute(db);

  await sql`
    delete from property_promotion_settings s
    where s.current_version = 0
      and s.created_by_user_id is null
      and not exists (
        select 1
        from property_promotion_setting_versions v
        where v.property_id = s.property_id
      )
  `.execute(db);
}
