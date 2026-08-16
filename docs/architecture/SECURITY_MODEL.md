# Security Model

## 1. Security objective

Wildleaf is a multi-tenant platform. The primary authorization risk is not only unauthenticated access; it is an authenticated user gaining access to another organization's property, booking, guest or financial data.

Tenant isolation is therefore enforced in backend policy code and database access patterns, never only by hiding UI elements.

## 2. Authentication

Firebase Authentication may remain the identity provider initially. Backend APIs verify signed tokens and map the external UID to a Wildleaf `users` record.

Sensitive roles should support or require MFA based on policy, especially:

- platform super admins;
- finance roles;
- settlement/bank-detail editors;
- organization owners.

## 3. Authorization model

Wildleaf uses RBAC plus scope-aware ABAC.

A request is allowed only if:

`actor has permission` **and** `actor scope contains target resource` **and** `resource state permits action`.

Example permissions:

- `property.read`
- `property.edit_content`
- `inventory.read`
- `inventory.write`
- `rates.write`
- `reservation.read`
- `reservation.modify`
- `reservation.cancel`
- `finance.read`
- `settlement.approve`
- `quality.approve`
- `user.manage`

Roles are bundles of permissions; permissions are the enforcement primitive.

## 4. Property scoping

Partner users reach a property through either:

- organization-wide membership with appropriate property scope; or
- explicit `property_access_grants`.

Wildleaf corporate users use platform roles with policy-defined cross-property scope.

Every repository query handling tenant data includes the validated organization/property scope. Controllers do not accept an arbitrary property ID and trust the caller.

## 5. Wildleaf override operations

Wildleaf administrators may need to operate a property without owner approval. This is allowed by explicit platform permissions, not by impersonating the owner.

High-impact actions require:

- reason code / free-text reason where appropriate;
- audit event;
- before/after values;
- actor identity;
- source application;
- optional second approval for defined financial/security actions.

## 6. Public API protection

Public endpoints receive:

- strict schema validation;
- request size limits;
- rate limiting;
- abuse/bot controls where appropriate;
- normalized input lengths and character constraints;
- no direct database identifiers where avoidable;
- safe error responses without internal stack traces.

High-risk actions use idempotency keys and replay protection.

## 7. Payment security

Wildleaf does not store raw card credentials. Hosted/provider checkout is preferred to minimize PCI scope.

Payment verification rules:

- payment order is created server-side from an authoritative reservation amount;
- provider order ID is stored before checkout;
- callback/webhook signature is verified;
- submitted order/payment IDs are cross-checked against stored order state;
- amount and currency must match expected values;
- provider event IDs are unique/idempotent;
- payment state and booking state are separate;
- browser success callbacks are not the only source of confirmation.

## 8. Webhook security

For every provider webhook:

1. capture raw body as required for signature verification;
2. verify signature using Secret Manager value;
3. persist provider event ID and payload hash;
4. reject or ignore duplicates safely;
5. process state transition idempotently;
6. return provider-appropriate response;
7. route repeated processing failures to operations review.

## 9. Secrets

- secrets never enter repository code;
- secrets are stored in Secret Manager;
- environment-specific service identities receive least privilege;
- credentials are rotated;
- no production secret is reused in staging/local.

## 10. Data classification

At minimum classify:

- public property content;
- internal operational data;
- personal guest data;
- identity/compliance documents;
- financial data;
- secrets/security material.

Logs must redact sensitive personal/payment/security fields.

## 11. Audit and tamper resistance

Audit records are append-only at application level. Production permissions prevent ordinary application paths from updating/deleting them. Sensitive audit retention policy is defined separately from transactional row retention.

## 12. Administrative safeguards

- no shared admin credentials;
- no legacy password-hash admin collection in V2;
- individual accounts only;
- privileged action logs;
- access review capability;
- immediate revoke/suspend;
- session/token revocation for security incidents.
