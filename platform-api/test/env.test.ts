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
  it("parses optional Razorpay configuration", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://user:password@localhost:5432/wildleaf",
      FIREBASE_PROJECT_ID: "wildleaf-test",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "test_key_secret",
      RAZORPAY_WEBHOOK_SECRET: "test_webhook_secret"
    });

    expect(config.RAZORPAY_KEY_ID).toBe("rzp_test_key");
    expect(config.RAZORPAY_KEY_SECRET).toBe("test_key_secret");
    expect(config.RAZORPAY_WEBHOOK_SECRET).toBe("test_webhook_secret");
  });
  it("rejects partial Razorpay configuration", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://user:password@localhost:5432/wildleaf",
        FIREBASE_PROJECT_ID: "wildleaf-test",
        RAZORPAY_KEY_ID: "rzp_test_key"
      })
    ).toThrow(/configured together/);
  });
});
