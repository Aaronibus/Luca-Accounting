import { db, tables } from "@/db";

export function writeAudit(entry: {
  companyId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}) {
  db.insert(tables.auditLogs)
    .values({
      companyId: entry.companyId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before !== undefined ? JSON.stringify(entry.before) : undefined,
      after: entry.after !== undefined ? JSON.stringify(entry.after) : undefined,
      note: entry.note,
    })
    .run();
}
