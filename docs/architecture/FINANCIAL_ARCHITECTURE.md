# Financial Architecture

## 1. Principle

Wildleaf must distinguish reservation pricing, payment collection, provider clearing, Wildleaf revenue, taxes, owner payable, refunds and settlement. A single `totalAmount` field is not sufficient for commercial operations.

## 2. Payment lifecycle

Payment state is separate from reservation state.

Representative states:

- `CREATED`
- `PENDING`
- `AUTHORIZED`
- `CAPTURED`
- `FAILED`
- `REFUND_PENDING`
- `PARTIALLY_REFUNDED`
- `REFUNDED`
- `DISPUTED`

Provider callbacks are events; they do not blindly set final booking state.

## 3. Payment order integrity

A payment order stores:

- reservation ID;
- expected amount;
- currency;
- provider;
- provider order ID;
- current state;
- expiry;
- idempotency key.

Verification requires all of the following:

- valid provider signature;
- order ID equals stored order ID;
- amount/currency match expected values;
- event/payment ID not previously consumed inconsistently;
- reservation/hold is still in a valid transition state.

## 4. Financial ledger

Wildleaf will use an immutable journal model rather than continually recalculating financial history from mutable booking fields.

Example conceptual accounts:

- payment-provider clearing;
- guest receivable/refundable;
- room revenue clearing;
- property payable;
- Wildleaf commission/management fee revenue;
- GST/tax payable or tax clearing;
- TDS/TCS receivable/payable where applicable;
- refund liability;
- settlement clearing;
- adjustments.

Each journal entry balances debits and credits. Exact statutory accounting mapping will be reviewed with Wildleaf's accountant/tax advisor before production use.

## 5. Booking commercial snapshot

A confirmed reservation stores immutable commercial lines such as:

- nightly accommodation charge;
- meal-plan charge;
- extra-person charge;
- discount;
- coupon/promotion funding source;
- tax component;
- booking/service fee where applicable;
- source commission assumptions.

This snapshot is the basis for later finance events, not the currently displayed rate calendar.

## 6. Wildleaf business models

The ledger must support multiple property contracts without changing the reservation engine. Examples:

- percentage of revenue management fee;
- fixed monthly fee;
- hybrid fixed + percentage;
- merchant-of-record model;
- property-collect model;
- OTA commission pass-through;
- centralized sales fee.

Contract terms are versioned and effective-dated.

## 7. Owner payable

Owner payable is derived from ledgered booking economics and contract terms, not manually typed.

A statement can explain:

- gross booking value;
- discounts;
- taxes;
- cancellations/refunds;
- channel commission;
- payment gateway charges where contractually applicable;
- Wildleaf fee;
- withholding/tax adjustments;
- previous adjustments;
- net payable;
- settlement status.

## 8. Settlement

Settlement batches are created for an organization/property over a defined period. A batch has review/approval/payment/reconciliation states.

Suggested lifecycle:

`DRAFT -> CALCULATED -> REVIEWED -> APPROVED -> PAID -> RECONCILED`

Corrections after payment use adjustment entries in a later batch; paid history is never rewritten.

## 9. Refunds

Refund creation is a financial command linked to a cancellation/amendment/service resolution. It records:

- policy basis;
- refundable amount;
- provider refund ID;
- initiated/processed timestamps;
- status;
- actor;
- journal entries.

Duplicate provider callbacks are idempotent.

## 10. Reconciliation

Wildleaf requires tools to reconcile:

- Razorpay/provider captured payments;
- refunds;
- bank settlements;
- OTA statements;
- owner settlement payments.

Unmatched items become reconciliation exceptions rather than silent accounting drift.
