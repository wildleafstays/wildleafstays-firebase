# ADR-005: Explicit Reservation State Machine

Status: **Accepted**

## Context

Ad-hoc status updates make cancellation, payment, amendments and channel synchronization unsafe.

## Decision

Reservation state changes occur only through named domain commands and validated transitions. Status history is append-only.

Core states begin with `HELD`, `PAYMENT_PENDING`, `CONFIRMED`, `CHECKED_IN`, `CHECKED_OUT`, `CANCELLED`, `EXPIRED`, `NO_SHOW`.

## Consequences

- invalid transitions are centrally rejected;
- integrations and UIs share one lifecycle;
- amendments/cancellations become explicit workflows rather than document edits.
