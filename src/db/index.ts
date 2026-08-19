import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

// Singleton across Next.js hot reloads
const globalForDb = globalThis as unknown as {
  __lucaDb?: BetterSQLite3Database<typeof schema>;
  __lucaSqlite?: Database.Database;
};

function createDb() {
  const dbPath = process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "luca.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  globalForDb.__lucaSqlite = sqlite;
  return drizzle(sqlite, { schema });
}

export const db = globalForDb.__lucaDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__lucaDb = db;

export * as tables from "./schema";
export type DB = typeof db;
