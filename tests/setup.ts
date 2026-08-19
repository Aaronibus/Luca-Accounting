import fs from "fs";
import path from "path";

const testDb = path.join("/tmp", `luca-test-${process.pid}.db`);
for (const suffix of ["", "-wal", "-shm"]) {
  try { fs.unlinkSync(testDb + suffix); } catch {}
}
process.env.DATABASE_URL = testDb;

// Import after env is set so the singleton opens the test database
const { db } = await import("../src/db");
const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
