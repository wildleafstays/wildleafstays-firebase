# Development Standards

## 1. Code quality baseline

- TypeScript strict mode for V2 application code.
- No implicit `any` in business modules.
- Linting and formatting enforced in CI.
- Public APIs have versioned schemas and generated/validated OpenAPI contracts.
- Domain errors are typed and mapped to stable API error codes.

## 2. Module structure

Each domain module follows clear layers:

- domain entities/value objects/policies;
- application commands/queries;
- repository interfaces;
- infrastructure adapters;
- transport/controllers.

Transport code never contains core inventory, pricing or finance rules.

## 3. Database access

- repositories own SQL for their aggregate/module;
- critical transactions are explicit;
- no hidden N+1 loops on high-volume paths;
- foreign keys and unique constraints enforce business identity where applicable;
- optimistic versioning is used where concurrent human edits are expected;
- row locks are used where inventory allocation requires pessimistic concurrency.

## 4. Testing pyramid

### Unit tests

Pricing rules, permission policies, state machines, cancellation calculations and value objects.

### Database integration tests

Real PostgreSQL test database for transaction behavior, constraints and repositories.

### Concurrency tests

Required for inventory/holds/confirmation/amendments.

### Contract tests

Provider adapters/webhooks and public API schemas.

### End-to-end tests

Critical user journeys:

- owner onboarding;
- property approval;
- room search;
- room booking;
- full-property booking;
- payment confirmation;
- cancellation/refund;
- inventory/rate update;
- owner statement;
- Wildleaf override/audit.

## 5. CI gates

A pull request cannot be production-eligible unless required checks pass:

- install/build;
- lint;
- typecheck;
- unit tests;
- integration tests;
- migration validation;
- security/static checks as configured.

## 6. Environments

Minimum environments:

- local;
- automated test;
- staging;
- production.

Staging and production use separate cloud projects/resources and secrets.

## 7. Deployment

- immutable container revisions;
- database migrations run in controlled step;
- health/readiness endpoints;
- release notes/change summary;
- rollback plan for risky changes;
- feature flags for incomplete user-facing capabilities where useful.

## 8. Observability requirements

Every request has a correlation ID. Logs are structured and include:

- service/module;
- request ID;
- actor ID where safe;
- organization/property scope where safe;
- action/error code;
- duration;
- external provider reference where applicable.

Metrics include:

- API error rate/latency;
- hold creation success/conflict rate;
- payment verification failures;
- booking confirmation failures;
- webhook lag;
- channel sync failures;
- notification failures;
- settlement exceptions.

## 9. Security review triggers

Mandatory security review for:

- authentication/authorization changes;
- payment/refund changes;
- settlement/bank changes;
- new external webhook/integration;
- public upload/download changes;
- PII/compliance-document access;
- tenant-scoping changes.

## 10. Definition of done

A feature is not done when the screen works. It is done when:

- domain behavior is specified;
- authorization exists;
- schema/migration exists;
- tests pass;
- auditability is present where required;
- observability exists;
- documentation is updated;
- staging verification is complete.
