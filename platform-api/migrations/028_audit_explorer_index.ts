import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create index audit_events_organization_created_idx
      on audit_events (organization_id, created_at desc, id desc)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists audit_events_organization_created_idx
  `.execute(db);
}
