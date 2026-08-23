import type { FastifyInstance } from "fastify";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { UserRepository } from "../infrastructure/user-repository.js";
import { SessionService } from "../application/session-service.js";

export interface SessionRouteDependencies {
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

const sessionResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["user", "platformRoles", "organizations", "propertyGrants"],
  properties: {
    user: {
      type: "object",
      additionalProperties: false,
      required: ["id", "email"],
      properties: {
        id: { type: "string", format: "uuid" },
        email: { anyOf: [{ type: "string" }, { type: "null" }] }
      }
    },
    platformRoles: { type: "array", items: { type: "string" } },
    organizations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["membershipId", "organizationId", "role"],
        properties: {
          membershipId: { type: "string", format: "uuid" },
          organizationId: { type: "string", format: "uuid" },
          role: { type: "string" }
        }
      }
    },
    propertyGrants: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["grantId", "organizationId", "propertyId", "role"],
        properties: {
          grantId: { type: "string", format: "uuid" },
          organizationId: { type: "string", format: "uuid" },
          propertyId: { type: "string", format: "uuid" },
          role: { type: "string" }
        }
      }
    }
  }
} as const;

export async function registerSessionRoutes(
  app: FastifyInstance,
  deps: SessionRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const service = new SessionService();

  app.get(
    "/v1/session",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Identity"],
        summary: "Return the authenticated user's Wildleaf access context",
        security: [{ bearerAuth: [] }],
        response: {
          200: sessionResponseSchema
        }
      }
    },
    async (request) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }
      return service.getSession(request.actor);
    }
  );
}
