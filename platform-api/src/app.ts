import { randomUUID } from "node:crypto";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { AppConfig } from "./config/env.js";
import { checkDatabaseReadiness } from "./infrastructure/database/database.js";
import type { Database } from "./infrastructure/database/types.js";
import type { IdentityVerifier } from "./infrastructure/identity/identity-verifier.js";
import type { PropertyAssetStorage } from "./infrastructure/storage/property-asset-storage.js";
import { UnavailablePropertyAssetStorage } from "./infrastructure/storage/unavailable-property-asset-storage.js";
import { AccessRepository } from "./modules/access/infrastructure/access-repository.js";
import { registerAuditRoutes } from "./modules/audit/transport/audit-routes.js";
import { registerCommercialRuleRoutes } from "./modules/commercial/transport/commercial-rule-routes.js";
import { registerPromotionRuleRoutes } from "./modules/commercial/transport/promotion-rule-routes.js";
import { UserRepository } from "./modules/identity/infrastructure/user-repository.js";
import { registerSessionRoutes } from "./modules/identity/transport/session-routes.js";
import { registerInventoryAllocationRoutes } from "./modules/inventory/transport/inventory-allocation-routes.js";
import { registerInventoryHoldRoutes } from "./modules/inventory/transport/inventory-hold-routes.js";
import { registerInventoryRoutes } from "./modules/inventory/transport/inventory-routes.js";
import { registerOrganizationRoutes } from "./modules/organizations/transport/organization-routes.js";
import { RazorpayProvider } from "./modules/payments/infrastructure/razorpay-provider.js";
import { registerPaymentRoutes } from "./modules/payments/transport/payment-routes.js";
import { registerPublicCatalogRoutes } from "./modules/public-booking/transport/public-catalog-routes.js";
import { MAX_PROPERTY_DOCUMENT_BYTES } from "./modules/property-onboarding/application/property-asset-upload-service.js";
import { registerPropertyOnboardingRoutes } from "./modules/property-onboarding/transport/property-onboarding-routes.js";
import { registerPropertyRoutes } from "./modules/properties/transport/property-routes.js";
import { registerPropertySetupRoutes } from "./modules/property-setup/transport/property-setup-routes.js";
import { registerQuoteRoutes } from "./modules/quotes/transport/quote-routes.js";
import { registerRateRoutes } from "./modules/rates/transport/rate-routes.js";
import { registerReportRoutes } from "./modules/reports/transport/report-routes.js";
import { registerReservationRoutes } from "./modules/reservations/transport/reservation-routes.js";
import { registerErrorHandler } from "./shared/http/error-handler.js";

export interface AppDependencies {
  config: AppConfig;
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  propertyAssetStorage?: PropertyAssetStorage;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "headers.authorization"],
        censor: "[REDACTED]"
      }
    },
    genReqId(request) {
      const supplied = request.headers["x-request-id"];
      if (typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) {
        return supplied;
      }
      return randomUUID();
    }
  });

  app.decorateRequest("actor", null);
  app.decorateRequest("correlationId", "");

  app.addHook("onRequest", async (request, reply) => {
    const supplied = request.headers["x-correlation-id"];
    request.correlationId =
      typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)
        ? supplied
        : request.id;
    void reply.header("x-request-id", request.id);
    void reply.header("x-correlation-id", request.correlationId);
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false
  });

  await app.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Wildleaf Platform API",
        description: "Transactional API for the Wildleaf hospitality operating platform.",
        version: "0.1.0"
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Firebase ID token"
          }
        }
      }
    }
  });

  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      // Leave one byte beyond the largest domain limit so its verifier can
      // return the canonical size error before Busboy truncates the stream.
      fileSize: MAX_PROPERTY_DOCUMENT_BYTES + 1
    }
  });

  if (deps.config.NODE_ENV !== "production") {
    app.get("/openapi.json", async () => app.swagger());
  }

  registerErrorHandler(app);

  app.get(
    "/health/live",
    {
      schema: {
        tags: ["Health"],
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "service"],
            properties: {
              status: { type: "string" },
              service: { type: "string" }
            }
          }
        }
      }
    },
    async () => ({ status: "ok", service: "wildleaf-platform-api" })
  );

  app.get(
    "/health/ready",
    {
      schema: {
        tags: ["Health"],
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "database"],
            properties: {
              status: { type: "string" },
              database: { type: "string" }
            }
          }
        }
      }
    },
    async () => {
      await checkDatabaseReadiness(deps.db);
      return { status: "ok", database: "ready" };
    }
  );

  const razorpayProvider =
    deps.config.RAZORPAY_KEY_ID &&
    deps.config.RAZORPAY_KEY_SECRET &&
    deps.config.RAZORPAY_WEBHOOK_SECRET
      ? new RazorpayProvider({
          keyId: deps.config.RAZORPAY_KEY_ID,
          keySecret: deps.config.RAZORPAY_KEY_SECRET,
          webhookSecret: deps.config.RAZORPAY_WEBHOOK_SECRET
        })
      : null;

  await registerPublicCatalogRoutes(app, {
    db: deps.db,
    razorpayOrderGateway: razorpayProvider
  });

  const userRepository = new UserRepository(deps.db);
  const accessRepository = new AccessRepository(deps.db);

  await registerSessionRoutes(app, {
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerOrganizationRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerAuditRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerPropertyRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerPropertySetupRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerPropertyOnboardingRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository,
    propertyAssetStorage: deps.propertyAssetStorage ?? new UnavailablePropertyAssetStorage()
  });

  await registerInventoryRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerInventoryHoldRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerInventoryAllocationRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerRateRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerQuoteRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerReservationRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerReportRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerPaymentRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository,
    razorpayProvider
  });

  await registerCommercialRuleRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  await registerPromotionRuleRoutes(app, {
    db: deps.db,
    identityVerifier: deps.identityVerifier,
    userRepository,
    accessRepository
  });

  return app;
}
