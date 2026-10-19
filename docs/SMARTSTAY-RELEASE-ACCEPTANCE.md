# SmartStay PR #27 — Production release acceptance gate

Status: **NOT RELEASE READY**. This document is a release checklist, not evidence that staging, live payment, or production have been verified.

## Verified automated evidence

- Frontend contract CI: property discovery and booking-mode contracts.
- SmartStay API CI and Platform API CI: database-backed booking and payment integration tests with **simulated gateways**.
- Performance harness CI: local/mock pagination through 200 results, 4-worker bounded processing, insufficient-inventory and HTTP 503 failure cases.
- On commit `ff875165`, all four automated jobs completed successfully. Confirm the **latest commit** is green again before proceeding.

## Required evidence still missing

- [ ] **Realistic staging dataset:** A staging environment with >=200 published, appropriately configured test listings. Document dataset size, sale modes, date/rate/stock coverage and test URL without exposing secrets or guest data.
- [ ] **Actual API latency:** Run `scripts/benchmark-smartstay-staging.mjs` against that staging deployment with explicit `SMARTSTAY_STAGING_HOST`; archive the report showing >=200 scanned, zero errors and p95 <=5000 ms. Test at peak-like contention as well; sequential pages alone do **not** establish throughput under traffic.
- [ ] **Complete browser booking:** In staging, verify hotel and full-property search -> property -> availability -> quote -> hold -> Razorpay **test-mode** order -> webhook/capture -> canonical confirmed reservation; verify guest reference and receipt.
- [ ] **Negative journey:** Failed or interrupted payment, reload during pending status, expired hold, unavailable room, overlapping booking and duplicate checkout must not double-charge or overbook. Confirm reconciliation/refund-required handling where applicable.
- [ ] **Security and privacy:** No private guest/tenant fields leak through public search or status; authorization tests and audit evidence complete.
- [ ] **Release configuration:** Verify GCP identity/access, Cloud SQL migration permissions/backups, Firebase routing, Razorpay secret versions/webhook configuration, rollback ownership and payment-provider connectivity **without printing secrets**.
- [ ] **Change review:** Human review of PR #27, up-to-date green required checks, merge to `main`, and confirm no unrelated changes entered the release.
- [ ] **Protected deployment:** Production workflow from `main` only using confirmed release trigger and required `production` environment approval. Do not bypass gates.
- [ ] **Post-release smoke:** Confirm live search and hotel pages, non-mutating public APIs, monitoring/error rate, hosting byte-verification and booking outcome using a controlled production-safe test. Roll back via existing workflow if validation fails.

## Release decision

**NO-GO** until the staging API benchmark, real browser/payment test-mode walkthrough, release environment review and PR merge are evidenced. CI passing is necessary but not sufficient. Production must remain unchanged until these gates are met.


## Limited public-beta release decision (Razorpay test mode)

The owner has requested a controlled public beta on the **existing** wildleafstays.com domain, not a separate customer-facing site. This is a narrower release than full commercial booking.

Mandatory gates before beta:
- [ ] Verify the actual deployed Razorpay key ID is a **test** key and all three configured provider credentials belong to one test-mode integration. A secret *reference* is not evidence of its value. Do not reveal any secret in logs.
- [ ] Check the customer-facing test-only notice on both search and property/checkout screens. Confirm genuine customers cannot mistake the test checkout for an accepted, paid commercial booking.
- [ ] Perform one real Razorpay test-mode end-to-end booking through the deployed candidate: quote, hold, order, test payment, webhook/callback or provider recovery, booking status and canonical reservation persisted. Record safe identifiers, never card data/secrets.
- [ ] Verify interruption, failure, expiration and duplicate checkout responses on the same isolated test inventory.
- [ ] Review Cloud SQL backup/recovery, release migrations, prior Cloud Run revision, Firebase Hosting rollback method, current live site routing and GitHub production environment requirements.
- [ ] Final human review and green CI, merge to main, then execute the approved production workflow. Keep old and new backup branches intact.
- [ ] Post-cutover verify wildleafstays.com, clear test-only labelling, read-only searches and controlled bookings; watch errors. Never claim Hosting is automatically rolled back by backend traffic restoration.

Scope exclusions until a later commercial launch:
- Real payments and commercially confirmed bookings must remain disabled.
- A validated 200-hotel staging performance report is still required before claiming 200-hotel launch capacity. A limited catalogue public beta may be evaluated separately, but only with bounded load and verified stability.

Code backups: `OLD-CODE-WORKING` (pre-SmartStay main), `NEW-CODE-PRIOR-TO-LAUNCH` (prelaunch feature snapshot). These are **code** backups, not database or Firebase Hosting snapshots.
