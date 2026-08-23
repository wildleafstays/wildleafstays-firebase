# Wildleaf Platform Architecture Foundation

Status: **Approved direction for V2 design**  
Audience: Engineering, product, operations, finance, revenue management, property partners  
Scope: Wildleaf customer marketplace, partner portal, Wildleaf control center, hospitality operations, inventory, reservations, payments, settlements and analytics

## Goal

Wildleaf is being designed as a hospitality operating platform capable of supporting independent hotels, resorts, villas, cottages, homestays and mixed-mode properties at national scale. The target is not a cosmetic upgrade of the current prototype. The target is a platform whose architecture remains valid as Wildleaf grows from a handful of properties to hundreds or thousands.

The V2 architecture combines four operating ideas:

- marketplace-grade identity, permissions and trust controls;
- managed-stay quality and property onboarding standards;
- hotel-grade inventory, rate, reservation and distribution controls;
- centralized guest operations, financial settlement and auditability.

## Non-negotiable principles

1. **One source of truth per business fact.** Inventory truth, reservation truth, payment truth and financial truth must not be independently maintained by multiple systems.
2. **No critical business logic in clients.** Web and mobile clients request actions; backend domain services decide whether they are valid.
3. **No patch architecture.** Every new capability must belong to the target domain model and migration plan.
4. **Multi-tenancy from day one.** Every owner, staff member and property must have explicit scope and permissions.
5. **Auditability by default.** Critical mutations record who, what, when, where, source, reason and before/after state.
6. **Idempotency for externally repeatable actions.** Payments, webhooks, booking confirmation, refunds, settlements and bulk updates must be safe to retry.
7. **Transactional inventory.** Availability is not a UI calculation; it is protected by database transactions and deterministic allocation rules.
8. **Financial immutability.** Financial entries are append-only. Corrections are compensating entries, not silent overwrites.
9. **Separate operational state from analytics.** Operational tables optimize correctness; analytics receives derived data.
10. **Staging before production.** All releases, migrations and integration changes are verified in an isolated environment.

## Document map

- `SYSTEM_ARCHITECTURE.md` — platform topology and service boundaries
- `DOMAIN_MODEL.md` — business domains and ownership of data
- `DATA_ARCHITECTURE.md` — PostgreSQL operational model, read models and analytics
- `SECURITY_MODEL.md` — identity, authorization and tenant isolation
- `INVENTORY_ARCHITECTURE.md` — physical inventory, room/villa coexistence and holds
- `RESERVATION_ARCHITECTURE.md` — booking state machine and lifecycle
- `FINANCIAL_ARCHITECTURE.md` — payments, ledger, commissions, taxes and settlements
- `QUALITY_AND_OPERATIONS.md` — managed hospitality workflows and service standards
- `DISTRIBUTION_AND_REVENUE.md` — OTA/channel distribution and revenue management
- `MIGRATION_STRATEGY.md` — path from the current Firebase prototype to V2
- `DEVELOPMENT_STANDARDS.md` — coding, testing, observability and release discipline
- `ROADMAP.md` — phased build sequence and acceptance criteria

Architecture Decision Records are in `docs/decisions/`.
