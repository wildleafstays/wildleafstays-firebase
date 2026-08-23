import { ALL_PERMISSIONS, Permissions, type Permission } from "./permissions.js";

export const PlatformRoles = {
  SUPER_ADMIN: "SUPER_ADMIN",
  OPERATIONS_ADMIN: "OPERATIONS_ADMIN",
  REVENUE_MANAGER: "REVENUE_MANAGER",
  FINANCE_MANAGER: "FINANCE_MANAGER",
  QUALITY_AUDITOR: "QUALITY_AUDITOR",
  CUSTOMER_SUPPORT: "CUSTOMER_SUPPORT",
  CONTENT_MANAGER: "CONTENT_MANAGER",
  ANALYST: "ANALYST"
} as const;

export type PlatformRole = (typeof PlatformRoles)[keyof typeof PlatformRoles];

export const OrganizationRoles = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  FINANCE: "FINANCE",
  VIEWER: "VIEWER"
} as const;

export type OrganizationRole = (typeof OrganizationRoles)[keyof typeof OrganizationRoles];

export const PropertyRoles = {
  MANAGER: "MANAGER",
  FRONT_DESK: "FRONT_DESK",
  REVENUE_MANAGER: "REVENUE_MANAGER",
  HOUSEKEEPING: "HOUSEKEEPING",
  FINANCE: "FINANCE",
  VIEWER: "VIEWER"
} as const;

export type PropertyRole = (typeof PropertyRoles)[keyof typeof PropertyRoles];

const platformRolePermissions: Record<PlatformRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  OPERATIONS_ADMIN: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.PROPERTY_READ,
    Permissions.PROPERTY_MANAGE,
    Permissions.PROPERTY_APPROVE,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE,
    Permissions.QUALITY_READ,
    Permissions.AUDIT_READ
  ]),
  REVENUE_MANAGER: new Set([
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.RATES_MANAGE,
    Permissions.COMMERCIAL_READ,
    Permissions.COMMERCIAL_MANAGE,
    Permissions.RESERVATION_READ
  ]),
  FINANCE_MANAGER: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.PROPERTY_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.FINANCE_READ,
    Permissions.SETTLEMENT_MANAGE,
    Permissions.AUDIT_READ
  ]),
  QUALITY_AUDITOR: new Set([
    Permissions.PROPERTY_READ,
    Permissions.QUALITY_READ,
    Permissions.QUALITY_MANAGE,
    Permissions.OPERATIONS_READ
  ]),
  CUSTOMER_SUPPORT: new Set([
    Permissions.PROPERTY_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE
  ]),
  CONTENT_MANAGER: new Set([Permissions.PROPERTY_READ, Permissions.PROPERTY_MANAGE]),
  ANALYST: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.RATES_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.OPERATIONS_READ,
    Permissions.QUALITY_READ,
    Permissions.FINANCE_READ
  ])
};

const organizationRolePermissions: Record<OrganizationRole, ReadonlySet<Permission>> = {
  OWNER: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.ORGANIZATION_MANAGE,
    Permissions.MEMBERSHIP_MANAGE,
    Permissions.PROPERTY_READ,
    Permissions.PROPERTY_MANAGE,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.RATES_MANAGE,
    Permissions.COMMERCIAL_READ,
    Permissions.COMMERCIAL_MANAGE,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE,
    Permissions.QUALITY_READ,
    Permissions.FINANCE_READ,
    Permissions.AUDIT_READ
  ]),
  ADMIN: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.MEMBERSHIP_MANAGE,
    Permissions.PROPERTY_READ,
    Permissions.PROPERTY_MANAGE,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.RATES_MANAGE,
    Permissions.COMMERCIAL_READ,
    Permissions.COMMERCIAL_MANAGE,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE,
    Permissions.QUALITY_READ,
    Permissions.FINANCE_READ
  ]),
  FINANCE: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.PROPERTY_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.FINANCE_READ
  ]),
  VIEWER: new Set([
    Permissions.ORGANIZATION_READ,
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.RATES_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ
  ])
};

const propertyRolePermissions: Record<PropertyRole, ReadonlySet<Permission>> = {
  MANAGER: new Set([
    Permissions.PROPERTY_READ,
    Permissions.PROPERTY_MANAGE,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.RATES_MANAGE,
    Permissions.COMMERCIAL_READ,
    Permissions.COMMERCIAL_MANAGE,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE,
    Permissions.QUALITY_READ
  ]),
  FRONT_DESK: new Set([
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.RATES_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.RESERVATION_MANAGE,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE
  ]),
  REVENUE_MANAGER: new Set([
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.INVENTORY_MANAGE,
    Permissions.RATES_READ,
    Permissions.RATES_MANAGE,
    Permissions.COMMERCIAL_READ,
    Permissions.COMMERCIAL_MANAGE,
    Permissions.RESERVATION_READ
  ]),
  HOUSEKEEPING: new Set([
    Permissions.PROPERTY_READ,
    Permissions.RESERVATION_READ,
    Permissions.OPERATIONS_READ,
    Permissions.OPERATIONS_MANAGE
  ]),
  FINANCE: new Set([
    Permissions.PROPERTY_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ,
    Permissions.FINANCE_READ
  ]),
  VIEWER: new Set([
    Permissions.PROPERTY_READ,
    Permissions.INVENTORY_READ,
    Permissions.RATES_READ,
    Permissions.COMMERCIAL_READ,
    Permissions.RESERVATION_READ
  ])
};

export function permissionsForPlatformRole(role: PlatformRole): ReadonlySet<Permission> {
  return platformRolePermissions[role];
}

export function permissionsForOrganizationRole(role: OrganizationRole): ReadonlySet<Permission> {
  return organizationRolePermissions[role];
}

export function permissionsForPropertyRole(role: PropertyRole): ReadonlySet<Permission> {
  return propertyRolePermissions[role];
}

export function organizationRoleCoversAllProperties(role: OrganizationRole): boolean {
  return role === OrganizationRoles.OWNER || role === OrganizationRoles.ADMIN;
}
