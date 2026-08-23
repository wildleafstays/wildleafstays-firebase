import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import {
  AuditExplorerService,
  type ListAuditEventsInput
} from "../application/audit-explorer-service.js";

export interface AuditRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface OrganizationParams {
  organizationId: string;
}

interface AuditEventParams extends OrganizationParams {
  auditEventId: string;
}

type AuditListQuery = Omit<ListAuditEventsInput, "organizationId">;

const organizationParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId"],
  properties: {
    organizationId: { type: "string", format: "uuid" }
  }
} as const;

const auditEventParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "auditEventId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    auditEventId: { type: "string", format: "uuid" }
  }
} as const;

const auditListQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    propertyId: { type: "string", format: "uuid" },
    actorType: {
      type: "string",
      enum: ["USER", "SYSTEM", "PROVIDER"]
    },
    actorUserId: { type: "string", format: "uuid" },
    action: { type: "string", minLength: 1 },
    entityType: { type: "string", minLength: 1 },
    entityId: { type: "string", minLength: 1 },
    createdFrom: { type: "string", format: "date-time" },
    createdBefore: { type: "string", format: "date-time" },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 50
    },
    cursor: {
      type: "string",
      minLength: 1,
      maxLength: 500,
      pattern: "^[A-Za-z0-9_-]+$"
    }
  }
} as const;

export async function registerAuditRoutes(
  app: FastifyInstance,
  deps: AuditRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const audit = new AuditExplorerService();

  app.get<{ Params: OrganizationParams; Querystring: AuditListQuery }>(
    "/v1/partner/organizations/:organizationId/audit-events",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Audit"],
        summary: "List organization audit events",
        description:
          "Returns a read-only, organization-scoped audit event timeline ordered newest first. The list exposes summary fields only; before/after/metadata payloads are available from the detail endpoint. IP address and user-agent are not exposed.",
        security: [{ bearerAuth: [] }],
        params: organizationParamsSchema,
        querystring: auditListQuerySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      const result = await audit.list(deps.db, request.actor, {
        organizationId: request.params.organizationId,
        ...(request.query.propertyId !== undefined ? { propertyId: request.query.propertyId } : {}),
        ...(request.query.actorType !== undefined ? { actorType: request.query.actorType } : {}),
        ...(request.query.actorUserId !== undefined
          ? { actorUserId: request.query.actorUserId }
          : {}),
        ...(request.query.action !== undefined ? { action: request.query.action } : {}),
        ...(request.query.entityType !== undefined ? { entityType: request.query.entityType } : {}),
        ...(request.query.entityId !== undefined ? { entityId: request.query.entityId } : {}),
        ...(request.query.createdFrom !== undefined
          ? { createdFrom: request.query.createdFrom }
          : {}),
        ...(request.query.createdBefore !== undefined
          ? { createdBefore: request.query.createdBefore }
          : {}),
        ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
        ...(request.query.cursor !== undefined ? { cursor: request.query.cursor } : {})
      });

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.get<{ Params: AuditEventParams }>(
    "/v1/partner/organizations/:organizationId/audit-events/:auditEventId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Audit"],
        summary: "Get an organization audit event",
        description:
          "Returns one organization-scoped audit event including canonical before, after and metadata JSON. IP address and user-agent remain internal and are not exposed.",
        security: [{ bearerAuth: [] }],
        params: auditEventParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }

      const result = await audit.get(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.auditEventId
      );

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );
}
