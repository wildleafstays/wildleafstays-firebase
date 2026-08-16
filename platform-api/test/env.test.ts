import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("parses a valid configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:password@localhost:5432/wildleaf",
      FIREBASE_PROJECT_ID: "wildleaf-test",
      PORT: "8081"
    });

    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(8081);
    expect(config.DB_MAX_CONNECTIONS).toBe(10);
  });

  it("rejects a missing database URL", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        FIREBASE_PROJECT_ID: "wildleaf-test"
      })
    ).toThrow(/DATABASE_URL/);
  });
});
