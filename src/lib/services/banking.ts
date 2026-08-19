// Bank feed import, duplicate detection and reconciliation maths.

import { db, tables } from "@/db";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { AccountingError, accountBalance } from "@/lib/engine/journal";
import { writeAudit } from "@/lib/audit";

export function txnFingerprint(date: Date, amountCents: number, description: string): string {
  const normalised = description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const day = date.toISOString().slice(0, 10);
  return createHash("sha256").update(`${day}|${amountCents}|${normalised}`).digest("hex").slice(0, 24);
}

export interface BankRowInput {
  date: Date;
  description: string;
  amountCents: number; // signed
  reference?: string;
  balanceCents?: number;
}

/** Parse a bank CSV (Date, Description, Amount [, Reference, Balance] — or Debit/Credit columns). */
export function parseBankCSV(text: string): BankRowInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new AccountingError("CSV has no data rows", "EMPTY_CSV");
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const dateCol = col("date");
  const descCol = col("description", "details", "narrative", "transaction");
  const amountCol = col("amount");
  const debitCol = col("debit", "money out", "paid out");
  const creditCol = col("credit", "money in", "paid in");
  const refCol = col("reference", "ref");
  const balCol = col("balance");

  if (dateCol === -1 || descCol === -1 || (amountCol === -1 && (debitCol === -1 || creditCol === -1))) {
    throw new AccountingError(
      "Could not recognise the CSV columns — need Date, Description and Amount (or Debit/Credit)",
      "BAD_CSV"
    );
  }

  const rows: BankRowInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 2) continue;
    const date = parseCsvDate(cells[dateCol]?.trim());
    if (!date) continue;
    let amountCents: number;
    if (amountCol !== -1 && cells[amountCol]?.trim()) {
      amountCents = parseCsvAmount(cells[amountCol]);
    } else {
      const debit = debitCol !== -1 && cells[debitCol]?.trim() ? Math.abs(parseCsvAmount(cells[debitCol])) : 0;
      const credit = creditCol !== -1 && cells[creditCol]?.trim() ? Math.abs(parseCsvAmount(cells[creditCol])) : 0;
      amountCents = credit - debit;
    }
    rows.push({
      date,
      description: (cells[descCol] ?? "").trim(),
      amountCents,
      reference: refCol !== -1 ? cells[refCol]?.trim() || undefined : undefined,
      balanceCents: balCol !== -1 && cells[balCol]?.trim() ? parseCsvAmount(cells[balCol]) : undefined,
    });
  }
  if (rows.length === 0) throw new AccountingError("No parsable rows found in CSV", "EMPTY_CSV");
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsvDate(raw?: string): Date | null {
  if (!raw) return null;
  // ISO
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Irish dd/mm/yyyy
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function parseCsvAmount(raw: string): number {
  const cleaned = raw.replace(/[€£$,\s"]/g, "");
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) throw new AccountingError(`Bad amount in CSV: "${raw}"`, "BAD_CSV");
  return Math.round(value * 100);
}

/** Import rows into a bank account with duplicate detection by fingerprint. */
export function importBankTransactions(opts: {
  companyId: string;
  bankAccountId: string;
  rows: BankRowInput[];
  filename?: string;
  userId?: string;
}): { imported: number; duplicates: number; batchId: string } {
  const bank = db
    .select()
    .from(tables.bankAccounts)
    .where(and(eq(tables.bankAccounts.id, opts.bankAccountId), eq(tables.bankAccounts.companyId, opts.companyId)))
    .get();
  if (!bank) throw new AccountingError("Bank account not found", "NOT_FOUND");

  return db.transaction(() => {
    const batch = db
      .insert(tables.importBatches)
      .values({
        companyId: opts.companyId,
        bankAccountId: opts.bankAccountId,
        filename: opts.filename,
        importedById: opts.userId,
        rowCount: opts.rows.length,
      })
      .returning({ id: tables.importBatches.id })
      .get();

    let imported = 0;
    let duplicates = 0;
    // count existing occurrences of each fingerprint so a same-day same-amount pair imports correctly (e.g. two coffees)
    for (const row of opts.rows) {
      const fp = txnFingerprint(row.date, row.amountCents, row.description);
      const existing = db
        .select({ n: sql<number>`count(*)` })
        .from(tables.bankTransactions)
        .where(and(eq(tables.bankTransactions.bankAccountId, opts.bankAccountId), eq(tables.bankTransactions.fingerprint, fp)))
        .get();
      const priorSameInBatch = opts.rows
        .slice(0, opts.rows.indexOf(row))
        .filter((r) => txnFingerprint(r.date, r.amountCents, r.description) === fp).length;
      if ((existing?.n ?? 0) > priorSameInBatch) {
        duplicates++;
        continue;
      }
      db.insert(tables.bankTransactions)
        .values({
          bankAccountId: opts.bankAccountId,
          importBatchId: batch.id,
          date: row.date,
          description: row.description,
          reference: row.reference,
          amountCents: row.amountCents,
          balanceCents: row.balanceCents,
          fingerprint: fp,
        })
        .run();
      imported++;
    }

    db.update(tables.importBatches).set({ duplicateCount: duplicates }).where(eq(tables.importBatches.id, batch.id)).run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bank.imported",
      entityType: "import_batch", entityId: batch.id,
      after: { imported, duplicates, filename: opts.filename },
    });

    return { imported, duplicates, batchId: batch.id };
  });
}

/** Statement balance per the feed vs the GL balance of the linked account. */
export function bankReconciliationStatus(companyId: string, bankAccountId: string, asOf?: Date) {
  const bank = db
    .select()
    .from(tables.bankAccounts)
    .where(and(eq(tables.bankAccounts.id, bankAccountId), eq(tables.bankAccounts.companyId, companyId)))
    .get();
  if (!bank) throw new AccountingError("Bank account not found", "NOT_FOUND");

  const conditions = [eq(tables.bankTransactions.bankAccountId, bankAccountId)];
  if (asOf) conditions.push(lte(tables.bankTransactions.date, asOf));

  // Statement balance = opening + all feed transactions (excluding EXCLUDED)
  const feed = db
    .select({ total: sql<number>`coalesce(sum(${tables.bankTransactions.amountCents}), 0)` })
    .from(tables.bankTransactions)
    .where(and(...conditions, sql`${tables.bankTransactions.status} != 'EXCLUDED'`))
    .get();
  const statementBalanceCents = bank.openingBalanceCents + (feed?.total ?? 0);

  const ledgerBalanceCents = accountBalance(companyId, bank.accountId, asOf);

  const unmatched = db
    .select({
      id: tables.bankTransactions.id,
      date: tables.bankTransactions.date,
      description: tables.bankTransactions.description,
      amountCents: tables.bankTransactions.amountCents,
    })
    .from(tables.bankTransactions)
    .where(and(...conditions, eq(tables.bankTransactions.status, "UNRECONCILED")))
    .orderBy(asc(tables.bankTransactions.date))
    .all();

  const unmatchedTotal = unmatched.reduce((a, t) => a + t.amountCents, 0);

  return {
    bankAccount: bank,
    statementBalanceCents,
    ledgerBalanceCents,
    differenceCents: statementBalanceCents - ledgerBalanceCents,
    unmatched: unmatched.map((u) => ({ ...u, date: new Date(u.date) })),
    unmatchedTotalCents: unmatchedTotal,
  };
}

/** Mark matched transactions as reconciled (bulk). */
export function reconcileTransactions(opts: { companyId: string; transactionIds: string[]; userId?: string }) {
  if (opts.transactionIds.length === 0) return { reconciled: 0 };
  const owned = db
    .select({ id: tables.bankTransactions.id, status: tables.bankTransactions.status })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(and(eq(tables.bankAccounts.companyId, opts.companyId), inArray(tables.bankTransactions.id, opts.transactionIds)))
    .all();
  const eligible = owned.filter((t) => t.status === "MATCHED").map((t) => t.id);
  if (eligible.length > 0) {
    db.update(tables.bankTransactions)
      .set({ status: "RECONCILED", reconciledAt: new Date(), reconciledById: opts.userId })
      .where(inArray(tables.bankTransactions.id, eligible))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bank.reconciled",
      entityType: "bank_transaction", entityId: eligible.join(","),
      after: { count: eligible.length },
    });
  }
  return { reconciled: eligible.length };
}
