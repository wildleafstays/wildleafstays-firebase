export const Permissions = {
  PLATFORM_MANAGE: "platform.manage",
  ORGANIZATION_READ: "organization.read",
  ORGANIZATION_MANAGE: "organization.manage",
  MEMBERSHIP_MANAGE: "membership.manage",
  PROPERTY_READ: "property.read",
  PROPERTY_MANAGE: "property.manage",
  PROPERTY_APPROVE: "property.approve",
  INVENTORY_READ: "inventory.read",
  INVENTORY_MANAGE: "inventory.manage",
  RATES_READ: "rates.read",
  RATES_MANAGE: "rates.manage",
  COMMERCIAL_READ: "commercial.read",
  COMMERCIAL_MANAGE: "commercial.manage",
  RESERVATION_READ: "reservation.read",
  RESERVATION_MANAGE: "reservation.manage",
  OPERATIONS_READ: "operations.read",
  OPERATIONS_MANAGE: "operations.manage",
  QUALITY_READ: "quality.read",
  QUALITY_MANAGE: "quality.manage",
  FINANCE_READ: "finance.read",
  SETTLEMENT_MANAGE: "settlement.manage",
  AUDIT_READ: "audit.read"
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];
export const ALL_PERMISSIONS = new Set<Permission>(Object.values(Permissions));
