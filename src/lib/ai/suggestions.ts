// Suggestion lifecycle: Suggested → Accepted (posts via the engine) / Rejected.
// Accepting is the ONLY path from AI proposal to ledger effect, and it runs
// through the same posting engine as manual entry — full audit trail included.

import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { AccountingError } from "@/lib/engine/journal";
import {
  categoriseBankTransaction,
  matchBankTransactionToDocuments,
  matchTransfer,
} from "@/lib/engine/posting";
import { writeAudit } from "@/lib/audit";
import type { Proposal } from "./categorise";

export function acceptSuggestion(opts: { companyId: string; suggestionId: string; userId: string }) {
  const s = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.id, opts.suggestionId), eq(tables.suggestions.companyId, opts.companyId)))
    .get();
  if (!s) throw new AccountingError("Suggestion not found", "NOT_FOUND");
  if (s.status !== "SUGGESTED") throw new AccountingError(`Suggestion already ${s.status.toLowerCase()}`, "BAD_STATUS");

  const payload = JSON.parse(s.payload) as Proposal;

  return db.transaction(() => {
    let result: { journalId?: string } = {};
    if (payload.action === "CATEGORISE" && s.bankTransactionId) {
      result = categoriseBankTransaction({
        companyId: opts.companyId,
        bankTransactionId: s.bankTransactionId,
        accountId: payload.accountId,
        vatRateId: payload.vatRateId,
        vatCents: payload.vatCents,
        contactId: payload.contactId,
        userId: opts.userId,
      });
    } else if (payload.action === "MATCH" && s.bankTransactionId) {
      const r = matchBankTransactionToDocuments({
        companyId: opts.companyId,
        bankTransactionId: s.bankTransactionId,
        allocations: payload.allocations.map((a) => ({ invoiceId: a.invoiceId, billId: a.billId, amountCents: a.amountCents })),
        contactId: payload.contactId,
        userId: opts.userId,
      });
      result = { journalId: r.journalId };
    } else if (payload.action === "TRANSFER") {
      result = matchTransfer({
        companyId: opts.companyId,
        outTransactionId: payload.outTransactionId,
        inTransactionId: payload.inTransactionId,
        userId: opts.userId,
      });
    } else {
      throw new AccountingError("This suggestion type cannot be applied automatically", "UNSUPPORTED");
    }

    db.update(tables.suggestions)
      .set({ status: "ACCEPTED", actedById: opts.userId, actedAt: new Date() })
      .where(eq(tables.suggestions.id, s.id))
      .run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "suggestion.accepted",
      entityType: "suggestion", entityId: s.id,
      after: { kind: s.kind, journalId: result.journalId, explanation: s.explanation },
    });

    return result;
  });
}

export function rejectSuggestion(opts: { companyId: string; suggestionId: string; userId: string }) {
  const s = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.id, opts.suggestionId), eq(tables.suggestions.companyId, opts.companyId)))
    .get();
  if (!s) throw new AccountingError("Suggestion not found", "NOT_FOUND");
  if (s.status !== "SUGGESTED") throw new AccountingError(`Suggestion already ${s.status.toLowerCase()}`, "BAD_STATUS");
  db.update(tables.suggestions)
    .set({ status: "REJECTED", actedById: opts.userId, actedAt: new Date() })
    .where(eq(tables.suggestions.id, s.id))
    .run();
  writeAudit({
    companyId: opts.companyId, userId: opts.userId, action: "suggestion.rejected",
    entityType: "suggestion", entityId: s.id,
  });
}

/**
 * "Reconcile everything you can" — auto-accept only high-confidence suggestions
 * (≥ threshold) of safe kinds. Returns a report of what was done and skipped.
 */
export function acceptAllConfident(opts: { companyId: string; userId: string; threshold?: number }) {
  const threshold = opts.threshold ?? 90;
  const candidates = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, opts.companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .all();

  const applied: Array<{ id: string; explanation: string }> = [];
  const skipped: Array<{ id: string; explanation: string; reason: string }> = [];

  for (const s of candidates) {
    if (s.confidence < threshold) {
      skipped.push({ id: s.id, explanation: s.explanation, reason: `Confidence ${s.confidence}% below ${threshold}% — needs your review` });
      continue;
    }
    if (!["CATEGORISATION", "MATCH", "TRANSFER"].includes(s.kind)) {
      skipped.push({ id: s.id, explanation: s.explanation, reason: "This kind always needs review" });
      continue;
    }
    try {
      acceptSuggestion({ companyId: opts.companyId, suggestionId: s.id, userId: opts.userId });
      applied.push({ id: s.id, explanation: s.explanation });
    } catch (e) {
      skipped.push({ id: s.id, explanation: s.explanation, reason: e instanceof Error ? e.message : "Failed to apply" });
    }
  }

  writeAudit({
    companyId: opts.companyId, userId: opts.userId, action: "ai.bulk_reconcile",
    entityType: "company", entityId: opts.companyId,
    after: { applied: applied.length, skipped: skipped.length, threshold },
  });

  return { applied, skipped };
}
