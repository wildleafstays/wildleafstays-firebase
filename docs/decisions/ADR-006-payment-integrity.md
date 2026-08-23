# ADR-006: Server-Verified, Idempotent Payment Orchestration

Status: **Accepted**

## Context

Browser callbacks may be retried/spoofed, webhooks may duplicate or arrive out of order, and payment success does not by itself guarantee that a reservation may be confirmed.

## Decision

Payment orders are created server-side from authoritative reservation amounts. Provider callbacks/webhooks are signature-verified, reconciled to the stored order, amount/currency checked, persisted idempotently and then passed to reservation confirmation orchestration.

## Consequences

- reservation and payment states remain separate;
- duplicate events cannot duplicate financial/booking effects;
- reconciliation tooling becomes part of the platform.
