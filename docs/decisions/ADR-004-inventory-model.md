# ADR-004: Shared Transactional Inventory with Holds

Status: **Accepted**

## Context

Wildleaf must sell individual rooms and full properties against the same physical stock. The current prototype creates a payment-pending booking before inventory is actually reserved, allowing payment/inventory races.

## Decision

Use date-level inventory buckets protected by PostgreSQL transactions, plus explicit temporary holds and allocation records. Full-property products allocate the same underlying room-type buckets.

## Consequences

- no duplicate room/villa inventory;
- payment checkout operates against a real temporary reservation;
- hold expiry/release must be implemented reliably;
- concurrency tests are mandatory.
