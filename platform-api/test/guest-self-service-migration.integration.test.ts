import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import {
  down as downGuestSelfService,
  up as upGuestSelfService
} from "../migrations/030_guest_self_service_foundation.js";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";

const config = loadConfig();
const db = createDatabase(config);

afterAll(async () => {
  await db.destroy();
});

describe("Phase 8A guest self-service migration", () => {
  it("[8A-19] migration 030 rollback removes table, trigger and immutability function", async () => {
    const schema = `phase8a_migration_${randomUUID().replaceAll("-", "")}`.toLowerCase();

    await db.transaction().execute(async (trx) => {
      await sql.raw(`create schema "${schema}"`).execute(trx);
      await sql.raw(`set local search_path to "${schema}"`).execute(trx);

      await sql`
        create table users (
          id uuid primary key
        )
      `.execute(trx);

      await sql`
        create table reservations (
          id uuid primary key
        )
      `.execute(trx);

      await upGuestSelfService(trx as unknown as Kysely<unknown>);

      const tableAfterUp = await sql<{ relation: string | null }>`
        select to_regclass('guest_reservation_links')::text as relation
      `.execute(trx);

      expect(tableAfterUp.rows[0]?.relation).toBe("guest_reservation_links");

      const triggerAfterUp = await sql<{ count: string }>`
        select count(*)::text as count
        from pg_trigger trigger_row
        join pg_class relation
          on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace_row
          on namespace_row.oid = relation.relnamespace
        where namespace_row.nspname = ${schema}
          and relation.relname = 'guest_reservation_links'
          and trigger_row.tgname = 'guest_reservation_links_immutable'
          and not trigger_row.tgisinternal
      `.execute(trx);

      expect(Number(triggerAfterUp.rows[0]?.count ?? 0)).toBe(1);

      const functionAfterUp = await sql<{ count: string }>`
        select count(*)::text as count
        from pg_proc function_row
        join pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
        where namespace_row.nspname = ${schema}
          and function_row.proname =
            'prevent_guest_reservation_link_mutation'
      `.execute(trx);

      expect(Number(functionAfterUp.rows[0]?.count ?? 0)).toBe(1);

      await downGuestSelfService(trx as unknown as Kysely<unknown>);

      const tableAfterDown = await sql<{ relation: string | null }>`
        select to_regclass('guest_reservation_links')::text as relation
      `.execute(trx);

      expect(tableAfterDown.rows[0]?.relation).toBeNull();

      const triggerAfterDown = await sql<{ count: string }>`
        select count(*)::text as count
        from pg_trigger trigger_row
        join pg_class relation
          on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace_row
          on namespace_row.oid = relation.relnamespace
        where namespace_row.nspname = ${schema}
          and trigger_row.tgname = 'guest_reservation_links_immutable'
          and not trigger_row.tgisinternal
      `.execute(trx);

      expect(Number(triggerAfterDown.rows[0]?.count ?? 0)).toBe(0);

      const functionAfterDown = await sql<{ count: string }>`
        select count(*)::text as count
        from pg_proc function_row
        join pg_namespace namespace_row
          on namespace_row.oid = function_row.pronamespace
        where namespace_row.nspname = ${schema}
          and function_row.proname =
            'prevent_guest_reservation_link_mutation'
      `.execute(trx);

      expect(Number(functionAfterDown.rows[0]?.count ?? 0)).toBe(0);

      await sql.raw(`drop schema "${schema}" cascade`).execute(trx);
    });
  });
});
