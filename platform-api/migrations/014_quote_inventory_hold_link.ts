import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quote_inventory_holds (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null unique,
      inventory_hold_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      linked_by_user_id uuid references users(id) on delete restrict,
      source text not null,
      request_id text not null,
      correlation_id text not null,
      created_at timestamptz not null default now(),
      unique (id, property_id, organization_id),
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (quote_id)
        references quote_promotion_snapshots(quote_id) on delete restrict,
      foreign key (inventory_hold_id, property_id, organization_id)
        references inventory_holds(id, property_id, organization_id) on delete restrict
    )
  `.execute(db);

  await sql`
    create index quote_inventory_holds_property_created_idx
      on quote_inventory_holds (property_id, created_at desc)
  `.execute(db);

  await sql`
    create trigger quote_inventory_holds_no_mutation
      before update or delete on quote_inventory_holds
      for each row execute function prevent_quote_snapshot_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists quote_inventory_holds_no_mutation
      on quote_inventory_holds
  `.execute(db);
  await sql`drop table if exists quote_inventory_holds`.execute(db);
}
