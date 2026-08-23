import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { loadConfig } from "../../config/env.js";
import { createDatabase } from "./database.js";

async function main(): Promise<void> {
  const direction = process.argv[2] ?? "up";
  const config = loadConfig();
  const db = createDatabase(config);

  try {
    const migrationFolder = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../migrations"
    );

    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs,
        path,
        migrationFolder,
        import: async (modulePath) => import(pathToFileURL(modulePath).href)
      })
    });

    const result =
      direction === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();

    for (const item of result.results ?? []) {
      const status = item.status === "Success" ? "OK" : item.status;
      console.log(`${status}: ${item.migrationName}`);
    }

    if (result.error) {
      console.error("Migration failed", result.error);
      process.exitCode = 1;
    }
  } finally {
    await db.destroy();
  }
}

await main();
