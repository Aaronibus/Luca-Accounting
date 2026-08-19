// The core posting engine. Every accounting effect in Lúca flows through postJournal.
// Invariants enforced here — nowhere else needs to re-check them:
//   1. A journal has ≥ 2 lines; every line has exactly one positive side (integer cents).
//   2. Total debits === total credits.
//   3. The journal date is not inside a locked period.
//   4. Every account belongs to the company and is not archived.
//   5. Posted journals are immutable — corrections are reversal journals.

import { db, tables } from "@/db";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import { JournalSource } from "@/lib/types";
import { writeAudit } from "@/lib/audit";

export interface JournalLineInput {
  accountId: string;
  debitCents?: number;
  creditCents?: number;
  description?: string;
  contactId?: string;
  vatRateId?: string;
}

export interface PostJournalInput {
  companyId: string;
  date: Date;
  description: string;
  sourceType: JournalSource;
  sourceId?: string;
  lines: JournalLineInput[];
  userId?: string;
  /** Set when this journal reverses another. */
  reversesId?: string;
  /** Skip the period-lock check (only the VAT finalisation engine may use this, posting ON the lock boundary). */
  allowLockedPeriod?: boolean;
}

export class AccountingError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "AccountingError";
  }
}

function assertInteger(n: number, label: string) {
  if (!Number.isInteger(n) || n < 0) {
    throw new AccountingError(`${label} must be a non-negative integer (cents), got ${n}`, "INVALID_AMOUNT");
  }
}

export function validateLines(lines: JournalLineInput[]) {
  if (lines.length < 2) {
    throw new AccountingError("A journal needs at least two lines", "TOO_FEW_LINES");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const d = line.debitCents ?? 0;
    const c = line.creditCents ?? 0;
    assertInteger(d, "debit");
    assertInteger(c, "credit");
    if ((d === 0) === (c === 0)) {
      throw new AccountingError(
        `Each journal line must have exactly one of debit or credit (got debit=${d}, credit=${c})`,
        "INVALID_LINE"
      );
    }
    totalDebit += d;
    totalCredit += c;
  }
  if (totalDebit !== totalCredit) {
    throw new AccountingError(
      `Journal does not balance: debits ${totalDebit} ≠ credits ${totalCredit}`,
      "UNBALANCED"
    );
  }
  return { totalDebit, totalCredit };
}

export function isDateLocked(companyId: string, date: Date): boolean {
  const lock = db
    .select({ m: max(tables.periodLocks.lockedThrough) })
    .from(tables.periodLocks)
    .where(eq(tables.periodLocks.companyId, companyId))
    .get();
  if (!lock?.m) return false;
  return date.getTime() <= new Date(lock.m).getTime();
}

export function nextSequence(companyId: string, key: string, prefix = ""): { value: number; formatted: string } {
  // Atomic within the caller's transaction (better-sqlite3 is synchronous + single-writer)
  const existing = db
    .select()
    .from(tables.numberSequences)
    .where(and(eq(tables.numberSequences.companyId, companyId), eq(tables.numberSequences.key, key)))
    .get();
  let value: number;
  let pfx = prefix;
  if (existing) {
    value = existing.nextValue;
    pfx = existing.prefix || prefix;
    db.update(tables.numberSequences)
      .set({ nextValue: value + 1 })
      .where(eq(tables.numberSequences.id, existing.id))
      .run();
  } else {
    value = 1;
    db.insert(tables.numberSequences)
      .values({ companyId, key, prefix, nextValue: 2 })
      .run();
  }
  return { value, formatted: `${pfx}${String(value).padStart(4, "0")}` };
}

/** Post a balanced journal. Returns the created journal id + number. */
export function postJournal(input: PostJournalInput): { journalId: string; journalNumber: number } {
  validateLines(input.lines);

  if (!input.allowLockedPeriod && isDateLocked(input.companyId, input.date)) {
    throw new AccountingError(
      `Cannot post to ${input.date.toISOString().slice(0, 10)} — that period is locked`,
      "PERIOD_LOCKED"
    );
  }

  // Verify all accounts belong to this company and are active
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const found = db
    .select({ id: tables.accounts.id, archived: tables.accounts.archived })
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, input.companyId), inArray(tables.accounts.id, accountIds)))
    .all();
  if (found.length !== accountIds.length) {
    throw new AccountingError("Journal references an account that does not exist in this company", "BAD_ACCOUNT");
  }
  const archivedAccount = found.find((a) => a.archived);
  if (archivedAccount) {
    throw new AccountingError("Journal references an archived account", "ARCHIVED_ACCOUNT");
  }

  return db.transaction(() => {
    const { value: journalNumber } = nextSequence(input.companyId, "JOURNAL");
    const inserted = db
      .insert(tables.journals)
      .values({
        companyId: input.companyId,
        journalNumber,
        date: input.date,
        description: input.description,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: "POSTED",
        postedById: input.userId,
        postedAt: new Date(),
        reversesId: input.reversesId,
      })
      .returning({ id: tables.journals.id })
      .get();

    db.insert(tables.journalLines)
      .values(
        input.lines.map((l) => ({
          journalId: inserted.id,
          accountId: l.accountId,
          description: l.description,
          debitCents: l.debitCents ?? 0,
          creditCents: l.creditCents ?? 0,
          contactId: l.contactId,
          vatRateId: l.vatRateId,
        }))
      )
      .run();

    writeAudit({
      companyId: input.companyId,
      userId: input.userId,
      action: "journal.posted",
      entityType: "journal",
      entityId: inserted.id,
      after: { journalNumber, date: input.date, description: input.description, sourceType: input.sourceType },
    });

    return { journalId: inserted.id, journalNumber };
  });
}

/** Reverse a posted journal by creating an equal-and-opposite journal. The original is marked REVERSED but never mutated. */
export function reverseJournal(opts: {
  companyId: string;
  journalId: string;
  userId?: string;
  date?: Date;
  reason?: string;
}): { journalId: string; journalNumber: number } {
  const journal = db
    .select()
    .from(tables.journals)
    .where(and(eq(tables.journals.id, opts.journalId), eq(tables.journals.companyId, opts.companyId)))
    .get();
  if (!journal) throw new AccountingError("Journal not found", "NOT_FOUND");
  if (journal.status === "REVERSED") throw new AccountingError("Journal is already reversed", "ALREADY_REVERSED");
  if (journal.status !== "POSTED") throw new AccountingError("Only posted journals can be reversed", "NOT_POSTED");

  const lines = db.select().from(tables.journalLines).where(eq(tables.journalLines.journalId, journal.id)).all();

  return db.transaction(() => {
    const result = postJournal({
      companyId: opts.companyId,
      date: opts.date ?? new Date(),
      description: `Reversal of #${journal.journalNumber}${opts.reason ? ` — ${opts.reason}` : ""}`,
      sourceType: "REVERSAL",
      sourceId: journal.id,
      userId: opts.userId,
      reversesId: journal.id,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debitCents: l.creditCents,
        creditCents: l.debitCents,
        description: l.description ?? undefined,
        contactId: l.contactId ?? undefined,
        vatRateId: l.vatRateId ?? undefined,
      })),
    });

    db.update(tables.journals).set({ status: "REVERSED" }).where(eq(tables.journals.id, journal.id)).run();

    writeAudit({
      companyId: opts.companyId,
      userId: opts.userId,
      action: "journal.reversed",
      entityType: "journal",
      entityId: journal.id,
      note: opts.reason,
      after: { reversedBy: result.journalId },
    });

    return result;
  });
}

/** Balance of one account as of a date (inclusive). Positive = net debit. */
export function accountBalance(companyId: string, accountId: string, asOf?: Date): number {
  const row = db
    .select({
      bal: sql<number>`coalesce(sum(${tables.journalLines.debitCents} - ${tables.journalLines.creditCents}), 0)`,
    })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .where(
      and(
        eq(tables.journals.companyId, companyId),
        eq(tables.journalLines.accountId, accountId),
        // REVERSED journals stay in the ledger — their reversal journal cancels them.
        inArray(tables.journals.status, ["POSTED", "REVERSED"]),
        ...(asOf ? [sql`${tables.journals.date} <= ${asOf.getTime()}`] : [])
      )
    )
    .get();
  return row?.bal ?? 0;
}

/** Find a system account (VAT control, AR, AP…) for a company. Throws if missing. */
export function systemAccount(companyId: string, systemKey: string) {
  const acct = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, systemKey)))
    .get();
  if (!acct) throw new AccountingError(`System account ${systemKey} is missing for this company`, "MISSING_SYSTEM_ACCOUNT");
  return acct;
}
