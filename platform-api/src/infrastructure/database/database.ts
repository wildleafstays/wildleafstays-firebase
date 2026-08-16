import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "./types.js";

export function createDatabase(
  config: Pick<AppConfig, "DATABASE_URL" | "DB_MAX_CONNECTIONS">
): Kysely<Database> {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool })
  });
}

export async function checkDatabaseReadiness(db: Kysely<Database>): Promise<void> {
  await sql`select 1`.execute(db);
}
