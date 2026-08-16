# ADR-003: Organization + Property-Scoped Multi-Tenancy

Status: **Accepted**

## Context

A Wildleaf partner may own multiple properties and may delegate staff to some but not all properties. Wildleaf corporate staff need cross-property access under separate roles.

## Decision

Model tenancy as:

`User -> Organization Membership -> Property Scope/Grant -> Permissions`

Platform staff authorization is separate from partner membership.

## Consequences

- no single `isOwner` flag;
- access checks require permission and resource scope;
- users can have multiple organizations/roles;
- Wildleaf overrides remain attributable to the Wildleaf actor rather than impersonating an owner.
