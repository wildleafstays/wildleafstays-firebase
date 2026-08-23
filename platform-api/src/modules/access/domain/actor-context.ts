import type { OrganizationRole, PlatformRole, PropertyRole } from "./roles.js";

export interface OrganizationMembershipContext {
  membershipId: string;
  organizationId: string;
  role: OrganizationRole;
}

export interface PropertyGrantContext {
  grantId: string;
  organizationId: string;
  propertyId: string;
  role: PropertyRole;
}

export interface ActorContext {
  userId: string;
  email: string | null;
  platformRoles: PlatformRole[];
  organizationMemberships: OrganizationMembershipContext[];
  propertyGrants: PropertyGrantContext[];
}

export type AuthorizationScope =
  | { kind: "platform" }
  | { kind: "organization"; organizationId: string }
  | { kind: "property"; organizationId: string; propertyId: string };
