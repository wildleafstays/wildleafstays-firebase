import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table guest_reservation_links (
      reservation_id uuid primary key
        references reservations(id) on delete restrict,
      user_id uuid not null
        references users(id) on delete restrict,
      link_source text not null
        check (link_source = 'AUTHENTICATED_CHECKOUT'),
      linked_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create index guest_reservation_links_user_linked_idx
      on guest_reservation_links (user_id, linked_at desc, reservation_id)
  `.execute(db);

  await sql`
    create or replace function prevent_guest_reservation_link_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'guest reservation links are immutable';
      return null;
    end;
    $$
  `.execute(db);

  await sql`
    create trigger guest_reservation_links_immutable
      before update or delete on guest_reservation_links
      for each row execute function prevent_guest_reservation_link_mutation()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop trigger if exists guest_reservation_links_immutable
      on guest_reservation_links
  `.execute(db);

  await sql`
    drop function if exists prevent_guest_reservation_link_mutation()
  `.execute(db);

  await sql`
    drop table if exists guest_reservation_links
  `.execute(db);
}
