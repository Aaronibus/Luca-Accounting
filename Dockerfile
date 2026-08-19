# Lúca — production container
# Works on Railway, Render, Fly.io, or any Docker host.
# The SQLite database lives in /app/data — mount a volume there to persist it.

FROM node:22-slim AS base
WORKDIR /app

# Build native deps (better-sqlite3) if a prebuilt binary is unavailable
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Dev dependencies are needed at runtime for drizzle-kit (schema push) and tsx (seeding)
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx next build

ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/luca.db
EXPOSE 3000

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

CMD ["/app/docker-entrypoint.sh"]
