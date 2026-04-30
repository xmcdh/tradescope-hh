# Durable Storage Setup

TradeScope can run with `local-json` storage for development, but local files do **not** provide authoritative proof for paper trading or live-readiness.

## Why Durable Storage Is Required

Local JSON storage can help with:
- local UI development
- debugging signal and paper-trade flows
- checking whether approval filters behave correctly

Local JSON storage cannot prove:
- authoritative 28-day paper trading duration
- durable paper trade history across restarts/redeploys
- reliable live-readiness evidence on serverless platforms

For any live-readiness claim, `database` storage mode is required.

## Supported Storage Modes

### `STORAGE_MODE=local-json`
- intended for development only
- writes to `data/*.json` with `/tmp` fallback if needed
- always treated as `LOCAL_ONLY`

### `STORAGE_MODE=database`
- intended for authoritative paper-trading proof
- requires a real database connection
- current implementation is provider-neutral and assumes a Postgres-compatible connection string

## Environment Variable Handling

TradeScope reads storage env vars from `process.env`.

- Local dev and local scripts such as `npm run db:check`:
  - `npm run db:check` will read `.env.local` first, then `.env`, if those files exist
  - shell exports still work and can override file-based values
  - `.env.example` is only a placeholder reference and must never contain real secrets
- Vercel / serverless runtime:
  - set the same env vars in Vercel Project Settings
  - API routes and proof pages read storage status server-side

Supported variables:

```bash
STORAGE_MODE=database
DATABASE_PROVIDER=postgres
DATABASE_SSL=require
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DB_NAME
```

Local fallback example:

```bash
STORAGE_MODE=local-json
```

Notes:
- `DATABASE_PROVIDER` defaults to `postgres`
- `DATABASE_SSL=require` is the safe default for Neon and Supabase
- use `DATABASE_SSL=disable` only when your local/Postgres environment explicitly does not require SSL

## Database Schema

The expected schema is in:

`database/schema.sql`

Run migrations manually. TradeScope does **not** run migrations automatically.

## How To Verify Storage Status

In the app:
- `/proof` shows:
  - Durable Storage: Configured / Not Configured
  - Current Proof Authority: Authoritative / Local Only
- `/paper-trading` shows:
  - storage mode
  - whether paper results are authoritative
  - durable tracking start date when available

Operational rule:
- if the app says `Current Proof Authority: Local Only`, paper results are not sufficient for live-readiness

## How To Confirm Paper Trading Is Authoritative

All of the following must be true:

1. `STORAGE_MODE=database`
2. `DATABASE_URL` is configured
3. `/proof` shows `Durable Storage: Configured`
4. `/proof` shows `Current Proof Authority: Authoritative`
5. `/paper-trading` shows durable tracking start date
6. live gate still passes all non-storage proof requirements

## Authoritative Tracking Start Rule

Authoritative paper tracking starts only after all of the following are true:

1. the database schema exists
2. `npm run db:check` passes
3. `/proof` shows `Current Proof Authority: Authoritative`

Before that point, paper history is local-only and cannot count toward the 28-day live-readiness gate.

## Current Limitation

The database adapter is implemented as a provider-neutral interface and Postgres-style integration point. It does not provision infrastructure or credentials for you. You must supply the database and run the schema manually.

## Neon Operational Checklist

1. Create a Neon project and database.
2. Copy the Postgres connection string from Neon.
3. Run the schema manually:

```bash
psql "$DATABASE_URL" -f database/schema.sql
```

4. Set local env vars:

```bash
export STORAGE_MODE=database
export DATABASE_PROVIDER=postgres
export DATABASE_SSL=require
export DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DB_NAME
```

5. Set the same env vars in Vercel Project Settings.
6. Run the database check locally:

```bash
npm run db:check
```

7. Deploy to Vercel.
8. Open `/proof`.
9. Confirm:
   - `Durable Storage: Configured`
   - `Storage Mode: database`
   - `Provider: postgres`
   - `Can Connect: yes`
   - `Current Proof Authority: Authoritative`
10. Only then start the 28-day approved-only paper-trading clock.

## Supabase Operational Checklist

1. Create a Supabase project.
2. Open the SQL Editor.
3. Paste and run `database/schema.sql`.
4. Copy the Postgres connection string from Supabase.
5. Set local env vars:

```bash
export STORAGE_MODE=database
export DATABASE_PROVIDER=postgres
export DATABASE_SSL=require
export DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DB_NAME
```

6. Set the same env vars in Vercel Project Settings.
7. Run:

```bash
npm run db:check
```

8. Deploy.
9. Open `/proof` and verify:
   - `Storage Mode: database`
   - `Provider: postgres`
   - `Can Connect: yes`
   - `Current Proof Authority: Authoritative`
10. Only then begin durable paper tracking.

## Next Operational Checklist

- [ ] Choose database provider: Neon or Supabase Postgres
- [ ] Create database
- [ ] Run `database/schema.sql` manually
- [ ] Set `STORAGE_MODE=database`
- [ ] Set `DATABASE_URL`
- [ ] Deploy to Vercel
- [ ] Run `npm run db:check` locally
- [ ] Open `/proof`
- [ ] Confirm `Durable Storage: Configured`
- [ ] Confirm `Current Proof Authority: Authoritative`
- [ ] Start 28-day approved-only paper trading
- [ ] Compare paper vs backtest after 28 days
- [ ] Keep live execution stubbed until all gates pass
