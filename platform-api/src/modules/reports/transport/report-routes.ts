import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { OwnerReportService } from "../application/owner-report-service.js";

export interface ReportRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface OrganizationParams {
  organizationId: string;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface ReportDateRangeQuery {
  startDate: string;
  endDate: string;
}

const organizationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId"],
  properties: {
    organizationId: { type: "string", format: "uuid" }
  }
} as const;

const propertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const reportDateRangeQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["startDate", "endDate"],
  properties: {
    startDate: { type: "string", format: "date" },
    endDate: { type: "string", format: "date" }
  }
} as const;

export async function registerReportRoutes(
  app: FastifyInstance,
  deps: ReportRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const reports = new OwnerReportService();

  app.get<{ Params: PropertyParams; Querystring: ReportDateRangeQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reports/occupancy",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Reports"],
        summary: "Get the property's confirmed occupancy report",
        description:
          "Returns a tenant-scoped, read-only confirmed booking and occupancy report for the half-open stay-date range [startDate, endDate). Confirmed room commitments come from canonical inventory. Full-property confirmation occupies the property's current active physical-unit capacity for that night.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        querystring: reportDateRangeQuerySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      const result = await reports.occupancy(deps.db, request.actor, {
        organizationId: request.params.organizationId,
        propertyId: request.params.propertyId,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      });

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.get<{ Params: PropertyParams; Querystring: ReportDateRangeQuery }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/reports/recognized-revenue",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Reports"],
        summary: "Get the property's recognized stay revenue report",
        description:
          "Returns tenant-scoped recognized stay revenue for the half-open date range [startDate, endDate). REVENUE_RECOGNIZED is grouped by canonical recognition_date. REVENUE_REVERSED is grouped by the property's local calendar date of occurred_at. Payment receipts, refunds, booking value and forecast revenue are not included.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        querystring: reportDateRangeQuerySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      const result = await reports.recognizedRevenue(deps.db, request.actor, {
        organizationId: request.params.organizationId,
        propertyId: request.params.propertyId,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      });

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.get<{ Params: OrganizationParams; Querystring: ReportDateRangeQuery }>(
    "/v1/partner/organizations/:organizationId/reports/portfolio-performance",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Reports"],
        summary: "Get organization portfolio performance",
        description:
          "Returns a read-only organization portfolio report for LIVE properties over the half-open date range [startDate, endDate). Occupancy uses canonical confirmed inventory and current active physical-unit capacity. Recognized stay revenue uses REVENUE_RECOGNIZED by recognition_date, while REVENUE_REVERSED uses each property's local calendar date of occurred_at. Payment receipts, refunds, booking value and forecast revenue are excluded.",
        security: [{ bearerAuth: [] }],
        params: organizationParamsSchema,
        querystring: reportDateRangeQuerySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      const result = await reports.portfolioPerformance(deps.db, request.actor, {
        organizationId: request.params.organizationId,
        startDate: request.query.startDate,
        endDate: request.query.endDate
      });

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );
}
