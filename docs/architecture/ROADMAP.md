# Wildleaf V2 Roadmap

The roadmap is sequenced by architectural dependency, not visual appeal.

## Phase 0 — Architecture Foundation

Deliverables:

- architecture documents and ADRs;
- target repo structure;
- stack decision;
- environment strategy;
- legacy migration strategy.

Exit criteria: engineering foundation approved before V2 production code begins.

## Phase 1 — Platform Core

Build:

- V2 backend scaffold;
- PostgreSQL migrations;
- users/organizations/memberships;
- permission engine;
- property access grants;
- audit events;
- request IDs/idempotency infrastructure;
- staging environment baseline.

Exit criteria: authenticated partner and Wildleaf users can be authorized against tenant/property scope in automated tests.

## Phase 2 — Property Onboarding and Catalog

Build:

- organization profile;
- property application workflow;
- property/building/floor/room type/physical unit model;
- documents/media;
- Wildleaf approval workflow;
- quality checklist foundation;
- sale mode (`ROOMS_ONLY`, `FULL_PROPERTY_ONLY`, `BOTH`).

Exit criteria: owner can submit a property; Wildleaf can approve; no property goes live outside lifecycle rules.

## Phase 3 — Rate and Inventory Engine

Build:

- rate plans;
- date-level rates;
- restrictions;
- inventory buckets;
- blocks;
- holds;
- room/full-property shared allocation;
- concurrency tests.

Exit criteria: automated stress/concurrency tests prove no double allocation under supported booking scenarios.

## Phase 4 — Reservation Engine

Build:

- quote engine;
- reservation state machine;
- reservation items/nights;
- guest allocation;
- amendments;
- cancellations;
- booking source attribution;
- status history.

Exit criteria: complete non-payment reservation lifecycle works through APIs and tests.

## Phase 5 — Payments, Refunds and Ledger

Build:

- Razorpay order adapter;
- webhook processing;
- payment idempotency;
- booking confirmation orchestration;
- refund lifecycle;
- ledger/journal foundation;
- commercial snapshots.

Exit criteria: duplicate/out-of-order callbacks cannot create duplicate confirmation or financial entries.

## Phase 6 — Partner Portal

Build owner/property staff workflows:

- dashboard;
- property content;
- inventory/rates calendar;
- reservations;
- arrivals/departures;
- operational tasks;
- statements preview;
- team/user management.

## Phase 7 — Wildleaf Control Center

Build:

- cross-property dashboard;
- onboarding approvals;
- quality audits;
- booking support;
- revenue controls;
- override tools;
- audit explorer;
- finance/settlement workflows.

## Phase 8 — Guest Marketplace V2

Build:

- destination/search architecture;
- property pages;
- room/full-property selection;
- proper checkout;
- guest account/self-service;
- confirmation/cancellation UX;
- SEO/performance foundations.

## Phase 9 — Distribution and Revenue Management

Build:

- channel mapping framework;
- first OTA/channel integration;
- outbound rates/inventory;
- inbound bookings/cancellations;
- sync observability;
- revenue recommendation engine;
- portfolio revenue dashboard.

## Phase 10 — Finance and Settlements

Build:

- contract terms;
- owner payable;
- statement generation;
- settlement batches;
- approvals;
- reconciliation;
- tax/reporting exports.

## Phase 11 — Hospitality Operations and Quality

Build:

- housekeeping/room status;
- maintenance work orders;
- guest service cases;
- SLA/escalation;
- recurring quality audits;
- staff/training records;
- complaint and resolution workflows.

## Phase 12 — Migration and Cutover

- migrate legacy data;
- full staging rehearsal;
- reconciliation;
- production freeze;
- final delta import;
- V2 go-live;
- legacy read-only retention;
- post-cutover monitoring.

## Phase 13 — Scale and Optimization

Only after real load evidence:

- dedicated search service if needed;
- analytics warehouse/BI expansion;
- service extraction for distribution/notifications if justified;
- advanced dynamic pricing;
- experimentation/personalization;
- mobile apps.
