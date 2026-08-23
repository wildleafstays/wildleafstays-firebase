# Inventory Architecture

## 1. Objective

Inventory must support hotels, resorts, villas and mixed-mode properties without duplicate physical stock. The same physical capacity may be sold by room type and, when configured, as an entire property.

The fundamental rule is:

> A room booking and a full-property booking compete for the same physical inventory.

## 2. Inventory levels

### Physical capacity

Derived from active sellable physical units mapped to a room type, adjusted by operational configuration.

### Inventory bucket

One bucket per property + room type + stay date. It represents the sellable capacity context for that night.

Conceptual fields:

- capacity;
- held quantity;
- confirmed quantity;
- blocked quantity;
- overbooking limit;
- stop-sell flag;
- version/update metadata.

A bucket is a transaction coordination point, not the sole historical record.

### Inventory event/history

Append-only record explaining why inventory changed: booking confirmed, hold created, hold expired, maintenance block, owner block, manual adjustment, channel import, cancellation, etc.

## 3. Sellable calculation

Conceptually:

`sellable = capacity + overbooking_limit - confirmed - active_holds - blocks`

Additional rate/restriction rules may make inventory unavailable even when physical capacity exists.

No client computes this authoritatively.

## 4. Room booking transaction

For a requested set of room types and nights:

1. resolve all required inventory buckets;
2. lock them in deterministic `(date, room_type_id)` order;
3. validate property/rate plan/restrictions;
4. validate requested occupancy;
5. verify sellable quantity for every bucket;
6. create a hold and hold allocations;
7. record inventory events;
8. commit atomically.

If any requested night fails, nothing is allocated.

## 5. Full-property booking

A full-property product declares which room types/capacity it exclusively consumes.

Hold creation:

1. resolve all designated room-type buckets for every stay night;
2. lock all buckets in deterministic order;
3. verify no conflicting confirmed/held/blocked state beyond policy;
4. allocate the full-property hold across those buckets;
5. create one reservation product item but many nightly inventory allocations;
6. commit atomically.

This ensures that one room booking blocks full-property sale and a full-property hold blocks room sale.

## 6. Temporary holds

A booking hold has:

- status (`ACTIVE`, `CONVERTED`, `EXPIRED`, `RELEASED`);
- `expires_at`;
- reservation/quote linkage;
- hold items per room type/night;
- idempotency key;
- actor/source.

The guest checkout timer is presentation only. Authoritative expiry comes from the server timestamp.

Hold release is idempotent. A scheduled task expires the hold; a periodic sweeper exists as a safety net.

## 7. Maintenance and operational blocks

Physical units can be placed out of order for a date range. The inventory service converts that into capacity reduction/blocks while preserving reason and unit reference.

Examples:

- maintenance;
- renovation;
- owner use;
- staff use;
- regulatory closure;
- Wildleaf quality suspension.

Blocks never silently masquerade as confirmed bookings.

## 8. Manual inventory override

World-class systems still need controlled overrides. Wildleaf will support them, but not by editing `availableRooms` directly.

An override creates an explicit block/adjustment with:

- scope;
- date range;
- quantity;
- reason;
- actor;
- source;
- expiry if temporary.

The sellable value is then recomputed/maintained through the inventory service.

## 9. Channel inventory

External channels must not own independent inventory truth. They receive allocations/rates from Wildleaf or report reservations that Wildleaf imports into the canonical reservation engine.

Channel sync state includes:

- last pushed inventory;
- last acknowledged version;
- provider reservation IDs;
- sync lag;
- error/retry state.

Overbooking from asynchronous OTA updates is treated as an operational exception with reconciliation tooling, not hidden by mutating counts.

## 10. Concurrency tests required

Before production cutover, automated tests must prove at least:

- two simultaneous guests cannot acquire the last room;
- room hold and full-property hold cannot both succeed for overlapping stock;
- repeated hold request with same idempotency key creates one hold;
- payment confirmation and hold expiry racing cannot both consume/release incorrectly;
- cancellation is idempotent;
- maintenance block cannot reduce capacity below already committed stock without explicit exception handling;
- bulk rate/inventory updates do not bypass locks or tenant scope.
