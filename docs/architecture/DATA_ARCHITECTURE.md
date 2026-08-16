# Data Architecture

## 1. Source-of-truth strategy

Wildleaf V2 uses PostgreSQL as the system of record for transactional hospitality data. Object storage holds binary assets. Analytics receives derived data.

The current Firestore model is treated as legacy data to migrate, not as the long-term canonical schema.

## 2. Core schema families

A representative schema is grouped by domain. Names are illustrative; migrations will define exact names and constraints.

### Identity / tenancy

- `users`
- `organizations`
- `organization_memberships`
- `platform_staff_roles`
- `property_access_grants`

### Property / onboarding

- `property_applications`
- `properties`
- `buildings`
- `floors`
- `room_types`
- `physical_units`
- `property_sale_products`
- `property_media`
- `property_documents`
- `quality_assessments`
- `quality_assessment_items`

### Rates / inventory

- `rate_plans`
- `rate_calendar`
- `inventory_buckets`
- `inventory_holds`
- `inventory_hold_items`
- `inventory_blocks`
- `inventory_events`

### Reservations

- `quotes`
- `reservations`
- `reservation_items`
- `reservation_guests`
- `reservation_nights`
- `reservation_status_history`
- `cancellation_records`

### Payments / finance

- `payment_orders`
- `payment_transactions`
- `refunds`
- `ledger_accounts`
- `journal_entries`
- `journal_lines`
- `settlement_batches`
- `settlement_lines`
- `reconciliation_records`

### Distribution / operations

- `channel_accounts`
- `channel_mappings`
- `channel_sync_jobs`
- `operational_tasks`
- `service_cases`
- `maintenance_work_orders`

### Audit / outbox

- `audit_events`
- `outbox_events`
- `webhook_events`
- `idempotency_keys`

## 3. Identifiers

Use opaque globally unique IDs. Business-facing confirmation codes are separate from primary keys.

Rules:

- database primary keys are never meaningful slugs;
- property public slug is a unique indexed field, not the primary key;
- external provider IDs have unique constraints scoped to provider/account;
- idempotency keys are scoped by operation + tenant + actor where appropriate.

## 4. Money

Never store operational money using binary floating-point.

Preferred approach:

- integer minor units for amounts where currency exponent is known, or PostgreSQL `numeric` with explicit precision;
- ISO currency code on monetary aggregate boundaries;
- explicit tax/discount/fee line items;
- immutable booking price snapshots.

Rounding is performed by a single pricing policy module. UI formatting never determines payable amounts.

## 5. Dates and time

Hospitality has both stay dates and timestamps.

- stay nights use local property calendar dates (`date`);
- events use timezone-aware timestamps (`timestamptz`);
- properties store IANA timezone identifiers;
- check-in/check-out local times are property configuration;
- no business rule relies on server-local timezone.

## 6. Concurrency

Inventory mutations run in explicit PostgreSQL transactions. Inventory rows are locked in deterministic order to reduce deadlocks.

A hold transaction conceptually performs:

1. normalize requested nights/products;
2. select all required inventory buckets `FOR UPDATE` in stable order;
3. compute sellable capacity using current booked/held/blocked values;
4. reject atomically if any night is insufficient;
5. create hold + hold items;
6. update snapshot counters or allocation rows;
7. commit.

Confirmation converts the same hold to confirmed allocations inside one transaction.

## 7. Event history and outbox

When a transaction must trigger asynchronous work, the business state and an `outbox_events` row are committed in the same database transaction. A worker publishes/processes the event afterward.

This prevents the classic failure where a booking is committed but the notification/event is lost between database commit and message publishing.

## 8. Read models

Not every screen should execute complex joins against write models. We may maintain read-optimized views/materialized tables for:

- property search cards;
- partner dashboard summary;
- today's arrivals/departures;
- occupancy and revenue summary;
- settlement statement previews.

Read models are disposable/derivable and never become the authority for inventory or finance.

## 9. Search

Initial search can use PostgreSQL indexes, normalized destination entities and geospatial support. Dedicated search infrastructure is introduced only when justified by scale/feature requirements.

The search model should support:

- canonical destination hierarchy;
- locality/landmark aliases;
- latitude/longitude;
- property attributes;
- price bands;
- amenity filters;
- guest capacity;
- property type;
- ranking signals.

Final availability and quote still revalidate against the transactional core.

## 10. Analytics

Analytics facts are generated from immutable events/transactional data and copied to an analytical store. Target facts include:

- room nights available/sold;
- occupancy;
- ADR;
- RevPAR;
- booking lead time;
- cancellation rate;
- channel mix;
- conversion;
- gross booking value;
- net revenue;
- owner payable;
- settlement aging;
- support and quality metrics.

## 11. Schema migration discipline

All schema changes are version-controlled migrations.

Rules:

- no manual production schema edits;
- backward-compatible expand/migrate/contract changes for live systems;
- migrations are tested on staging snapshots;
- destructive operations require backup and rollback plan;
- application and migration deployment order is documented.
