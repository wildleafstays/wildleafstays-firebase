# ADR-007: Append-Only Audit Events for Critical Mutations

Status: **Accepted**

## Context

Owners, property staff and Wildleaf corporate users can act on the same property. Disputes require reliable attribution and before/after context.

## Decision

Critical mutations append an audit event with actor, role/context, resource scope, action, before/after change data, reason/source, correlation ID and timestamp.

## Consequences

- operational conflicts are explainable;
- Wildleaf overrides remain transparent;
- audit data requires retention, access controls and PII redaction rules.
