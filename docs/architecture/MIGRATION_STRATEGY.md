# Migration Strategy from Current Firebase Prototype

## 1. Objective

Preserve the working system while building V2 cleanly. We will not progressively mutate the legacy Firestore model into the final PostgreSQL model field-by-field.

## 2. Legacy baseline

The current working Firebase implementation remains a recoverable baseline. Production-critical changes to legacy code are limited to security/continuity fixes if absolutely necessary while V2 is under construction.

## 3. Parallel build

V2 is introduced in new top-level application/package locations after architecture approval. Legacy folders remain available until cutover.

Target repository direction:

```text
apps/
  api/
  guest-web/
  partner-web/
  admin-web/
packages/
  domain/
  contracts/
  database/
  config/
  observability/
  testing/
infra/
  ...
legacy/ or existing Firebase folders (during transition)
docs/
```

Exact restructuring will be done in a dedicated migration commit, not mixed with functional changes.

## 4. Data migration phases

### Phase A — inventory current data

Create a migration inventory for current Firestore collections and fields, including:

- properties;
- room categories;
- daily inventory;
- bookings;
- payments;
- admin users;
- homepage/content;
- any legacy `hotels` records.

Classify fields as:

- migrate directly;
- transform;
- derive;
- archive only;
- discard with explicit approval.

### Phase B — V2 import tooling

Build repeatable import scripts that:

- are idempotent;
- write migration IDs/source references;
- validate counts/totals;
- produce error reports;
- never silently skip malformed business records.

### Phase C — rehearsal

Run full migrations against staging from production export/sanitized snapshot. Reconcile:

- property count;
- active room inventory;
- future bookings;
- booking totals;
- payment references;
- guest records;
- future availability.

### Phase D — cutover

Preferred cutover for an early-stage system:

1. announce maintenance/freeze window;
2. stop new writes to legacy booking engine;
3. export final delta;
4. run final V2 import;
5. run automated reconciliation;
6. enable V2 traffic;
7. retain legacy read-only for rollback/reference.

Avoid long-term dual-write unless scale/business continuity demands it because dual-write dramatically increases correctness risk.

## 5. Rollback

Before cutover:

- database backup exists;
- legacy deployment remains deployable;
- DNS/routing change is reversible;
- migration reports identify exact imported records;
- V2 write period and rollback consequences are documented.

Once V2 accepts real writes for a meaningful period, rollback requires controlled reverse migration or operational reconciliation; it is not merely a DNS flip.

## 6. Legacy security

The migration project does not justify leaving known dangerous legacy endpoints exposed. If production continues to use legacy booking/payment APIs during V2 build, high-risk security gaps may receive minimal isolated hardening. Such work is explicitly tagged as legacy containment, not V2 architecture.
