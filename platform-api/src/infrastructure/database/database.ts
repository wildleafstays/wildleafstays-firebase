import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types as pgTypes } from "pg";
import type { AppConfig } from "../../config/env.js";
import type { Database } from "./types.js";

// PostgreSQL DATE is a calendar date, not an instant in time.
// Keep OID 1082 as YYYY-MM-DD so business dates never shift with process timezone.
pgTypes.setTypeParser(1082, (value) => value);
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
