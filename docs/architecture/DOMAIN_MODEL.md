# Domain Model

## 1. Identity and tenancy

### User

Represents a human identity linked to the authentication provider. A user may be:

- guest;
- property owner;
- organization employee;
- property staff member;
- Wildleaf employee;
- any combination where policy permits.

Identity is separate from authorization.

### Organization

Represents the legal/commercial partner entity that owns or operates one or more properties. Examples include an individual proprietor, partnership, company or hotel group.

Key concepts:

- legal name and trading name;
- tax and billing profile;
- bank/settlement profile;
- contractual relationship with Wildleaf;
- lifecycle status.

### Organization Membership

Links a user to an organization with a role and status. Organization roles do not automatically imply access to every property unless the role or explicit grant says so.

### Property Access Grant

Provides property-scoped access to a user or membership. This supports cases such as a GM managing only two hotels inside a 20-property organization.

### Wildleaf Staff Role

Corporate permissions are separate from partner permissions. Example roles:

- platform super admin;
- operations admin;
- revenue manager;
- finance manager;
- quality auditor;
- customer support;
- content manager;
- read-only analyst.

## 2. Property domain

### Property

The commercial stay entity listed on Wildleaf. It includes:

- ownership organization;
- commercial model;
- property type;
- lifecycle status;
- address/geolocation;
- facilities/amenities;
- policies;
- tax profile;
- sale mode.

Sale mode is explicit:

- `ROOMS_ONLY`
- `FULL_PROPERTY_ONLY`
- `BOTH`

### Building / Wing / Floor

Optional structural hierarchy used where operationally useful. A small villa may omit building/wing but still use floors.

### Room Type

A sellable category such as Deluxe Room, Valley View Room or Cottage Suite. It carries occupancy rules, bedding, attributes and default rate configuration.

### Physical Unit

A real room/hut/cottage/unit. Physical units are important for maintenance, housekeeping, floor/view/accessibility and later room assignment.

A hotel can sell by room type while assigning a physical unit later.

### Full Property Product

Not a second property and not duplicate inventory. It is a sale product that requires exclusive availability of all designated inventory within the physical property for each stay night.

## 3. Onboarding domain

### Property Application

Captures submission progress before a property is live.

Lifecycle:

`DRAFT -> SUBMITTED -> UNDER_REVIEW -> CHANGES_REQUIRED -> APPROVED -> LIVE`

Additional terminal/exception states:

`REJECTED`, `SUSPENDED`, `ARCHIVED`.

### Compliance Document

Versioned metadata for ownership/authorization, identity, tax, bank and property compliance documents. Actual files live in object storage.

### Quality Assessment

A structured checklist with mandatory, scored and advisory criteria. Assessments are versioned and auditable.

## 4. Rate and inventory domain

### Rate Plan

Examples:

- EP — room only;
- CP — room + breakfast;
- MAP — breakfast plus one main meal;
- AP — all major meals;
- custom package plans.

A rate plan includes meal inclusions, cancellation policy linkage, occupancy pricing rules and distribution eligibility.

### Rate Calendar

A date-level sell rate and restrictions record for a room type + rate plan. It can be produced by base pricing, seasonal rules, revenue management or an explicit override.

### Inventory Bucket

Authoritative date-level inventory state for a property/room type. Conceptual components:

- physical/base capacity;
- maintenance/out-of-order blocks;
- owner/Wildleaf blocks;
- confirmed allocations;
- temporary holds;
- overbooking limit where explicitly allowed;
- stop-sell/restriction state.

### Inventory Hold

A temporary allocation with expiration. Holds are created atomically and converted to confirmed allocation on reservation confirmation.

## 5. Reservation domain

### Quote

A short-lived priced offer derived from authoritative rates, restrictions, occupancy and taxes. Quotes are immutable snapshots and expire.

### Reservation

The canonical booking record regardless of source. Important fields include:

- source/channel;
- property;
- arrival/departure;
- guest party;
- lifecycle state;
- commercial totals;
- policy snapshots;
- attribution and timestamps.

### Reservation Item

Represents a booked product allocation, for example two Deluxe Rooms under CP or a Full Property product.

### Stay Night Allocation

The date-level allocation linking reservation items to inventory buckets. This prevents reconstruction ambiguity later.

### Guest

A reusable guest profile. Reservation guest snapshots remain immutable enough to preserve historical billing/communication context.

## 6. Payment and finance domain

### Payment Order

Wildleaf's record of a payment intent/order linked to a reservation and amount/currency.

### Payment Transaction

Provider event such as authorization, capture, failure or refund. Provider IDs are unique and idempotently processed.

### Ledger Account

Represents monetary buckets such as cash/payment-provider clearing, guest receivable, property payable, Wildleaf commission revenue, tax payable and refunds.

### Journal Entry

Immutable balanced financial posting generated from business events.

### Settlement Batch

Groups payable amounts to a property/organization over a defined period. Settlement is reconciled against banking/payment-provider evidence.

## 7. Operations domain

### Operational Task

Structured tasks such as room readiness, guest request, housekeeping, maintenance or arrival preparation.

### Service Case

Guest/owner issue with SLA, priority, assignment, status and resolution outcome.

### Maintenance Block

Operational reason for removing a physical unit or capacity from saleable inventory.

## 8. Audit domain

### Audit Event

Append-only record containing:

- actor user/system;
- actor role/context;
- organization/property scope;
- action;
- entity type/id;
- before/after representation or changed fields;
- reason;
- source application;
- correlation/request ID;
- timestamp;
- security context where appropriate.

Audit events are not a substitute for domain history tables when domain history is itself required.

## 9. Domain ownership rule

A table belongs to exactly one domain module for writes. Other modules may read through repositories/read models, but direct cross-domain writes are prohibited. This prevents the platform from becoming a collection of controllers mutating each other's data.
