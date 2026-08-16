import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdentityVerifier } from "../../infrastructure/identity/identity-verifier.js";
import type { AccessRepository } from "../../modules/access/infrastructure/access-repository.js";
import type { UserRepository } from "../../modules/identity/infrastructure/user-repository.js";
import { AuthenticationError } from "../errors/app-error.js";

export interface AuthenticationDependencies {
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

export function requireAuthentication(deps: AuthenticationDependencies) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization ?? "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new AuthenticationError();
    }

    try {
      const identity = await deps.identityVerifier.verifyIdToken(token);
      const user = await deps.userRepository.upsertFromIdentity(identity);
      if (user.status !== "ACTIVE") {
        throw new AuthenticationError("User account is not active");
      }
      request.actor = await deps.accessRepository.loadActorContext(user);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      request.log.warn({ err: error }, "Identity verification failed");
      throw new AuthenticationError("Invalid or expired authentication token");
    }
  };
}
