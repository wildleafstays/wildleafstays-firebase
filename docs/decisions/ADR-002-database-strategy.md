# ADR-002: PostgreSQL as Transactional System of Record

Status: **Accepted**

## Context

The current prototype uses Firestore for properties, inventory, bookings and payments. V2 requires complex transactions, relational integrity, financial ledgering, scoped access models, settlement and reporting.

## Decision

Use managed PostgreSQL as the authoritative operational database for V2 transactional domains. Firestore may remain for legacy operation or selected non-authoritative use cases during transition.

## Consequences

- relational constraints and SQL transactions become first-class;
- inventory row locking and financial journal integrity are practical;
- a deliberate migration from Firestore is required;
- database operations/migrations require disciplined CI and backups.

## Rejected alternative

Evolving the current Firestore documents into the permanent transactional model was rejected because it would optimize for migration convenience rather than long-term correctness and maintainability.
