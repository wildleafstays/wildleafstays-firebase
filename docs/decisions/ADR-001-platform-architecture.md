# ADR-001: Modular Monolith on Google Cloud

Status: **Accepted**

## Context

Wildleaf requires strong transactional behavior across inventory, reservations, payments and finance, but does not yet have the scale or engineering organization that justifies a microservice estate.

## Decision

Build V2 as a TypeScript modular monolith deployed in containers on Cloud Run, with strict domain modules and explicit interfaces/events.

## Consequences

Positive:

- simpler transactions and deployments;
- lower operational overhead;
- easier end-to-end testing;
- domain boundaries preserved for future extraction.

Trade-off:

- independent module scaling is limited initially;
- architecture discipline is required to prevent a monolith from becoming tightly coupled.

## Revisit when

A domain has demonstrably different scaling, compliance, reliability or team-ownership needs.
