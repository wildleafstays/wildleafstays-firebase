import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { UserRecord } from "../../identity/infrastructure/user-repository.js";
import type {
  ActorContext,
  OrganizationMembershipContext,
  PropertyGrantContext
} from "../domain/actor-context.js";
import type { OrganizationRole, PlatformRole, PropertyRole } from "../domain/roles.js";

export class AccessRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async loadActorContext(user: UserRecord): Promise<ActorContext> {
    const [platformRows, membershipRows, grantRows] = await Promise.all([
      this.db
        .selectFrom("platform_staff_roles")
        .select(["role_code"])
        .where("user_id", "=", user.id)
        .where("status", "=", "ACTIVE")
        .execute(),
      this.db
        .selectFrom("organization_memberships")
        .select(["id", "organization_id", "role_code"])
        .where("user_id", "=", user.id)
        .where("status", "=", "ACTIVE")
        .execute(),
      this.db
        .selectFrom("property_access_grants as grant")
        .innerJoin(
          "organization_memberships as membership",
          "membership.id",
          "grant.organization_membership_id"
        )
        .select([
          "grant.id as grant_id",
          "grant.organization_id",
          "grant.property_id",
          "grant.role_code"
        ])
        .where("membership.user_id", "=", user.id)
        .where("membership.status", "=", "ACTIVE")
        .where("grant.status", "=", "ACTIVE")
        .execute()
    ]);

    const organizationMemberships: OrganizationMembershipContext[] = membershipRows.map((row) => ({
      membershipId: row.id,
      organizationId: row.organization_id,
      role: row.role_code as OrganizationRole
    }));

    const propertyGrants: PropertyGrantContext[] = grantRows.map((row) => ({
      grantId: row.grant_id,
      organizationId: row.organization_id,
      propertyId: row.property_id,
      role: row.role_code as PropertyRole
    }));

    return {
      userId: user.id,
      email: user.email,
      platformRoles: platformRows.map((row) => row.role_code as PlatformRole),
      organizationMemberships,
      propertyGrants
    };
  }
}
