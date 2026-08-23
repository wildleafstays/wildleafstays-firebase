# Wildleaf Platform API

This directory is the permanent V2 transactional backend. It is intentionally isolated from the legacy Firebase Functions application while V2 is built and tested.

## Technology baseline

- Node.js 22 LTS runtime
- TypeScript strict mode
- Fastify 5
- PostgreSQL 18 locally; Cloud SQL PostgreSQL in staging/production
- Kysely for typed SQL and migrations
- Firebase Authentication as the initial identity provider
- OpenAPI generated from route schemas

## Local setup

1. Install Docker Desktop and Node.js 22.
2. Copy `.env.example` to `.env`.

   Set `FIREBASE_STORAGE_BUCKET` to the exact Firebase Storage bucket when
   testing Phase 7B uploads. If it is omitted, the API remains operational but
   managed property uploads return `503 SERVICE_UNAVAILABLE`.

3. Start PostgreSQL:

```powershell
docker compose up -d postgres
```

4. Install development dependencies (including optional native test-runner bindings):

```powershell
npm install --include=optional
```

Production containers omit development and optional dependencies. CI installs the development toolchain, then separately enforces `npm audit --omit=dev --omit=optional` against the production dependency surface.

5. Run migrations:

```powershell
npm run migrate
```

6. Format the newly installed workspace once:

```powershell
npm run format
```

7. Run the complete quality gate, including PostgreSQL integration tests and a production build:

```powershell
npm run check:full
```

8. Start the API:

```powershell
npm run dev
```

Local endpoints:

- `GET /health/live`
- `GET /health/ready`
- `GET /openapi.json` (non-production)
- `GET /v1/session` (requires a Firebase ID token)
- `POST /v1/partner/organizations` (authenticated + `Idempotency-Key`)
- `POST /v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/uploads/images`
  (authenticated multipart file + `Idempotency-Key` + `X-Content-SHA256`)
- `POST /v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/uploads/documents`
  (authenticated private PDF upload + digest verification)

## Architectural rules

- No legacy Firestore collection is imported as a V2 domain model.
- No client writes directly to PostgreSQL.
- Tenant/property authorization is evaluated server-side.
- Audit records are append-only.
- Database schema changes are migrations only.
- Critical domain writes will use explicit SQL transactions.
- Browsers never select storage keys. Property assets are streamed through the
  API into immutable server-selected keys; legal documents remain private and
  are exposed to reviewers only through short-lived read URLs.
