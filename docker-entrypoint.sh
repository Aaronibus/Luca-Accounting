#!/bin/sh
# Boot sequence for containerised Lúca.
#   1. Ensure the data directory exists (mounted volume in production).
#   2. Apply the database schema. This is additive and safe to re-run: on first
#      boot it creates every table, on later boots it applies new columns.
#   3. Optionally seed the demo company — only once, and only if SEED_DEMO=true.
#      Real deployments start empty: users sign up and create their own companies.
#   4. Start Next.js.

set -e

DATA_DIR="$(dirname "${DATABASE_URL:-/app/data/luca.db}")"
mkdir -p "$DATA_DIR"

echo "[luca] applying database schema…"
if npx drizzle-kit push --force; then
  echo "[luca] schema is up to date"
else
  echo "[luca] ---------------------------------------------------------------"
  echo "[luca] SCHEMA PUSH FAILED."
  echo "[luca] This usually means the existing database predates a change that"
  echo "[luca] adds a required column. If this volume holds no real accounting"
  echo "[luca] data, delete the volume (or the .db file) and redeploy to"
  echo "[luca] recreate it. If it holds real data, write a migration first."
  echo "[luca] ---------------------------------------------------------------"
fi

if [ "$SEED_DEMO" = "true" ] && [ ! -f "$DATA_DIR/.seeded" ]; then
  echo "[luca] seeding demo company (SEED_DEMO=true)…"
  npx tsx src/db/seed.ts && touch "$DATA_DIR/.seeded"
fi

echo "[luca] starting server on port ${PORT:-3000}"
exec npx next start -p "${PORT:-3000}"
