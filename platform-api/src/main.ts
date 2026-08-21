import { buildApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { createDatabase } from "./infrastructure/database/database.js";
import { FirebaseIdentityVerifier } from "./infrastructure/identity/firebase-identity-verifier.js";
import { FirebasePropertyAssetStorage } from "./infrastructure/storage/firebase-property-asset-storage.js";
import { UnavailablePropertyAssetStorage } from "./infrastructure/storage/unavailable-property-asset-storage.js";

const config = loadConfig();
const db = createDatabase(config);
const identityVerifier = new FirebaseIdentityVerifier(config.FIREBASE_PROJECT_ID);
const propertyAssetStorage = config.FIREBASE_STORAGE_BUCKET
  ? new FirebasePropertyAssetStorage(config.FIREBASE_STORAGE_BUCKET)
  : new UnavailablePropertyAssetStorage();
const app = await buildApp({ config, db, identityVerifier, propertyAssetStorage });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Graceful shutdown started");
  try {
    await app.close();
    await db.destroy();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  }
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "Platform API failed to start");
  await db.destroy();
  process.exit(1);
}
