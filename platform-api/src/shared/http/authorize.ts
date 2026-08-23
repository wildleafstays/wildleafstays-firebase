import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthorizationService } from "../../modules/access/domain/authorization-service.js";
import type { AuthorizationScope } from "../../modules/access/domain/actor-context.js";
import type { Permission } from "../../modules/access/domain/permissions.js";
import { AuthenticationError } from "../errors/app-error.js";

export function requirePermission(
  permission: Permission,
  scopeResolver: (request: FastifyRequest) => AuthorizationScope
) {
  const authorization = new AuthorizationService();

  return async function authorize(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.actor) {
      throw new AuthenticationError();
    }
    authorization.assert(request.actor, permission, scopeResolver(request));
  };
}
