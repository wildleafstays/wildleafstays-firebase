import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../src/modules/access/domain/authorization-service.js";
import type { ActorContext } from "../src/modules/access/domain/actor-context.js";
import { Permissions } from "../src/modules/access/domain/permissions.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const propertyId = "22222222-2222-4222-8222-222222222222";

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    userId: "33333333-3333-4333-8333-333333333333",
    email: "owner@example.com",
    platformRoles: [],
    organizationMemberships: [],
    propertyGrants: [],
    ...overrides
  };
}

describe("AuthorizationService", () => {
  const service = new AuthorizationService();

  it("allows a platform super admin across tenant boundaries", () => {
    const current = actor({ platformRoles: ["SUPER_ADMIN"] });
    expect(
      service.can(current, Permissions.SETTLEMENT_MANAGE, {
        kind: "property",
        organizationId,
        propertyId
      })
    ).toBe(true);
  });

  it("allows an organization owner to manage every property in the organization", () => {
    const current = actor({
      organizationMemberships: [
        {
          membershipId: "44444444-4444-4444-8444-444444444444",
          organizationId,
          role: "OWNER"
        }
      ]
    });

    expect(
      service.can(current, Permissions.PROPERTY_MANAGE, {
        kind: "property",
        organizationId,
        propertyId
      })
    ).toBe(true);
  });

  it("does not leak organization owner permissions into another organization", () => {
    const current = actor({
      organizationMemberships: [
        {
          membershipId: "44444444-4444-4444-8444-444444444444",
          organizationId,
          role: "OWNER"
        }
      ]
    });

    expect(
      service.can(current, Permissions.PROPERTY_MANAGE, {
        kind: "property",
        organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        propertyId
      })
    ).toBe(false);
  });

  it("allows a property revenue manager to manage rates only for the granted property", () => {
    const current = actor({
      organizationMemberships: [
        {
          membershipId: "44444444-4444-4444-8444-444444444444",
          organizationId,
          role: "VIEWER"
        }
      ],
      propertyGrants: [
        {
          grantId: "55555555-5555-4555-8555-555555555555",
          organizationId,
          propertyId,
          role: "REVENUE_MANAGER"
        }
      ]
    });

    expect(
      service.can(current, Permissions.RATES_MANAGE, {
        kind: "property",
        organizationId,
        propertyId
      })
    ).toBe(true);

    expect(
      service.can(current, Permissions.RATES_MANAGE, {
        kind: "property",
        organizationId,
        propertyId: "66666666-6666-4666-8666-666666666666"
      })
    ).toBe(false);
  });

  it("does not let a front desk role manage financial settlements", () => {
    const current = actor({
      propertyGrants: [
        {
          grantId: "55555555-5555-4555-8555-555555555555",
          organizationId,
          propertyId,
          role: "FRONT_DESK"
        }
      ]
    });

    expect(
      service.can(current, Permissions.SETTLEMENT_MANAGE, {
        kind: "property",
        organizationId,
        propertyId
      })
    ).toBe(false);
  });
});
