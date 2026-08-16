import { ForbiddenError } from "../../../shared/errors/app-error.js";
import type { ActorContext, AuthorizationScope } from "./actor-context.js";
import type { Permission } from "./permissions.js";
import {
  organizationRoleCoversAllProperties,
  permissionsForOrganizationRole,
  permissionsForPlatformRole,
  permissionsForPropertyRole
} from "./roles.js";

export class AuthorizationService {
  can(actor: ActorContext, permission: Permission, scope: AuthorizationScope): boolean {
    if (actor.platformRoles.some((role) => permissionsForPlatformRole(role).has(permission))) {
      return true;
    }

    if (scope.kind === "platform") {
      return false;
    }

    const membership = actor.organizationMemberships.find(
      (item) => item.organizationId === scope.organizationId
    );

    if (membership && permissionsForOrganizationRole(membership.role).has(permission)) {
      if (scope.kind === "organization") {
        return true;
      }
      if (organizationRoleCoversAllProperties(membership.role)) {
        return true;
      }
    }

    if (scope.kind === "property") {
      const grant = actor.propertyGrants.find(
        (item) =>
          item.organizationId === scope.organizationId && item.propertyId === scope.propertyId
      );
      return Boolean(grant && permissionsForPropertyRole(grant.role).has(permission));
    }

    return false;
  }

  assert(actor: ActorContext, permission: Permission, scope: AuthorizationScope): void {
    if (!this.can(actor, permission, scope)) {
      throw new ForbiddenError("The current user is not permitted to perform this action", {
        permission,
        scope
      });
    }
  }
}
