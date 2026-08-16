import type { ActorContext } from "../../access/domain/actor-context.js";

export interface SessionView {
  user: {
    id: string;
    email: string | null;
  };
  platformRoles: string[];
  organizations: Array<{
    membershipId: string;
    organizationId: string;
    role: string;
  }>;
  propertyGrants: Array<{
    grantId: string;
    organizationId: string;
    propertyId: string;
    role: string;
  }>;
}

export class SessionService {
  getSession(actor: ActorContext): SessionView {
    return {
      user: {
        id: actor.userId,
        email: actor.email
      },
      platformRoles: [...actor.platformRoles],
      organizations: actor.organizationMemberships.map((membership) => ({
        membershipId: membership.membershipId,
        organizationId: membership.organizationId,
        role: membership.role
      })),
      propertyGrants: actor.propertyGrants.map((grant) => ({
        grantId: grant.grantId,
        organizationId: grant.organizationId,
        propertyId: grant.propertyId,
        role: grant.role
      }))
    };
  }
}
