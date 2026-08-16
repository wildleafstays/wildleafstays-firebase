# ADR-008: Versioned APIs and Idempotent Commands

Status: **Accepted**

## Context

Mobile networks, payment providers, browsers and integration clients retry requests. Duplicate mutations must not create duplicate bookings, refunds or settlement effects.

## Decision

Use versioned APIs and command-specific idempotency keys for operations where replay is plausible or costly. Persist idempotency outcome with request fingerprint and response/operation reference.

## Consequences

- safe retry behavior becomes testable;
- conflicting reuse of the same key with a different payload is rejected;
- APIs need stable error codes and request schemas.
