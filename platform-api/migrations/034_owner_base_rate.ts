import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table rate_plan_products
      alter column floor_rate_minor drop not null,
      alter column ceiling_rate_minor drop not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1
        from rate_plan_products
        where floor_rate_minor is null
           or ceiling_rate_minor is null
      ) then
        raise exception
          'Cannot restore mandatory rate guardrails while unbounded rate products exist';
      end if;

      alter table rate_plan_products
        alter column floor_rate_minor set not null,
        alter column ceiling_rate_minor set not null;
    end
    $$
  `.execute(db);
}
