// Data-grounded answers to accounting questions + reconciliation explanations
// + the accounting health score. Everything here is computed from the ledger —
// the copilot phrases it, but never invents a number.

import { db, tables } from "@/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { profitAndLoss } from "@/lib/engine/reports";
import { bankReconciliationStatus } from "@/lib/services/banking";
import { detectAnomalies } from "./anomalies";
import { fmtEUR } from "@/lib/money";

export interface Evidence {
  label: string;
  href: string;
}
export interface Insight {
  answer: string;
  details: string[];
  evidence: Evidence[];
}

// ── Reconciliation explanation ────────────────────────────────────────────

export function explainReconciliation(companyId: string, bankAccountId: string): Insight {
  const status = bankReconciliationStatus(companyId, bankAccountId);
  const { differenceCents, unmatched, unmatchedTotalCents, bankAccount } = status;

  if (differenceCents === 0 && unmatched.length === 0) {
    return {
      answer: `${bankAccount.name} is fully reconciled — the statement balance and your ledger agree at ${fmtEUR(status.statementBalanceCents)}.`,
      details: [],
      evidence: [],
    };
  }

  const details: string[] = [];
  const evidence: Evidence[] = [];

  if (unmatched.length > 0) {
    details.push(
      `${unmatched.length} bank transaction${unmatched.length === 1 ? " has" : "s have"} not been explained yet, totalling ${fmtEUR(unmatchedTotalCents)}.`
    );
    for (const u of unmatched.slice(0, 8)) {
      details.push(`• ${u.date.toISOString().slice(0, 10)} — “${u.description}” ${fmtEUR(u.amountCents)}`);
      evidence.push({ label: `${u.description} (${fmtEUR(u.amountCents)})`, href: `/banking/${bankAccountId}?txn=${u.id}` });
    }
    if (unmatched.length > 8) details.push(`…and ${unmatched.length - 8} more.`);
  }

  let answer: string;
  if (differenceCents === unmatchedTotalCents && unmatched.length > 0) {
    answer = `${bankAccount.name} is ${fmtEUR(Math.abs(differenceCents))} out because ${unmatched.length} transaction${unmatched.length === 1 ? "" : "s"} from the bank feed ${unmatched.length === 1 ? "hasn't" : "haven't"} been matched to your books yet. Explaining ${unmatched.length === 1 ? "it" : "them"} will bring the reconciliation to zero.`;
  } else if (unmatched.length > 0) {
    const residual = differenceCents - unmatchedTotalCents;
    answer = `${bankAccount.name} is ${fmtEUR(Math.abs(differenceCents))} out. Unmatched feed transactions explain ${fmtEUR(unmatchedTotalCents)} of that; the remaining ${fmtEUR(residual)} suggests something was posted to the ledger that never appeared in the bank feed (a manual payment entry, a missing statement period, or an opening-balance difference).`;
    details.push(
      `Residual ${fmtEUR(residual)}: check for ledger postings to this bank account with no matching feed line — often a duplicate manual payment or an import gap.`
    );
  } else {
    answer = `${bankAccount.name} is ${fmtEUR(Math.abs(differenceCents))} out even though every feed transaction is matched. That points to ledger entries with no bank-feed counterpart — most often a manually recorded payment that duplicated a feed transaction, or an incorrect opening balance.`;
  }

  return { answer, details, evidence };
}

// ── "Why is my profit down?" and friends ─────────────────────────────────

export function explainProfitChange(companyId: string, from: Date, to: Date): Insight {
  // compare with the immediately preceding period of equal length
  const len = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - len);

  const cur = profitAndLoss(companyId, from, to);
  const prev = profitAndLoss(companyId, prevFrom, prevTo);

  const profitDelta = cur.netProfitCents - prev.netProfitCents;
  const revDelta = cur.revenue.totalCents - prev.revenue.totalCents;
  const cosDelta = cur.costOfSales.totalCents - prev.costOfSales.totalCents;
  const opexDelta = cur.operatingExpenses.totalCents - prev.operatingExpenses.totalCents;

  // biggest expense-account movements
  const prevByAccount = new Map(prev.operatingExpenses.rows.concat(prev.costOfSales.rows).map((r) => [r.accountId, r]));
  const movements = cur.operatingExpenses.rows
    .concat(cur.costOfSales.rows)
    .map((r) => ({ ...r, deltaCents: r.amountCents - (prevByAccount.get(r.accountId)?.amountCents ?? 0) }))
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));

  const direction = profitDelta >= 0 ? "up" : "down";
  const details: string[] = [];
  const evidence: Evidence[] = [];

  details.push(`Revenue ${revDelta >= 0 ? "rose" : "fell"} ${fmtEUR(Math.abs(revDelta))} (${fmtEUR(prev.revenue.totalCents)} → ${fmtEUR(cur.revenue.totalCents)}).`);
  if (cosDelta !== 0) details.push(`Cost of sales ${cosDelta >= 0 ? "increased" : "decreased"} ${fmtEUR(Math.abs(cosDelta))}.`);
  if (opexDelta !== 0) details.push(`Operating expenses ${opexDelta >= 0 ? "increased" : "decreased"} ${fmtEUR(Math.abs(opexDelta))}.`);

  for (const m of movements.slice(0, 4)) {
    if (m.deltaCents === 0) continue;
    details.push(`• ${m.name}: ${m.deltaCents > 0 ? "+" : "−"}${fmtEUR(Math.abs(m.deltaCents))} vs the prior period.`);
    evidence.push({ label: `${m.code} ${m.name} activity`, href: `/ledger/accounts/${m.accountId}` });
  }

  const drivers: string[] = [];
  if (Math.abs(revDelta) > Math.abs(opexDelta) && Math.abs(revDelta) > Math.abs(cosDelta)) {
    drivers.push(revDelta >= 0 ? "higher sales" : "lower sales");
  }
  if (Math.abs(opexDelta) >= Math.abs(revDelta) * 0.5 && opexDelta !== 0) {
    const sameDirection = movements.find((m) => Math.sign(m.deltaCents) === Math.sign(opexDelta));
    drivers.push(`${opexDelta > 0 ? "higher" : "lower"} operating costs${sameDirection ? ` (notably ${sameDirection.name.toLowerCase()})` : ""}`);
  }
  if (Math.abs(cosDelta) >= Math.abs(revDelta) * 0.5 && cosDelta !== 0) {
    drivers.push(`${cosDelta > 0 ? "higher" : "lower"} cost of sales`);
  }

  return {
    answer: `Net profit is ${direction} ${fmtEUR(Math.abs(profitDelta))} versus the previous period (${fmtEUR(prev.netProfitCents)} → ${fmtEUR(cur.netProfitCents)})${drivers.length ? `, driven mainly by ${drivers.join(" and ")}` : ""}.`,
    details,
    evidence,
  };
}

export function explainVatChange(companyId: string, from: Date, to: Date): Insight {
  const len = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - len);

  const box = (f: Date, t: Date) => {
    const vatControl = db
      .select()
      .from(tables.accounts)
      .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, "VAT_CONTROL")))
      .get();
    if (!vatControl) return { output: 0, input: 0 };
    const rows = db
      .select({
        sourceType: tables.journals.sourceType,
        credit: sql<number>`coalesce(sum(${tables.journalLines.creditCents}), 0)`,
        debit: sql<number>`coalesce(sum(${tables.journalLines.debitCents}), 0)`,
      })
      .from(tables.journalLines)
      .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
      .where(
        and(
          eq(tables.journals.companyId, companyId),
          eq(tables.journalLines.accountId, vatControl.id),
          inArray(tables.journals.status, ["POSTED", "REVERSED"]),
          gte(tables.journals.date, f),
          lte(tables.journals.date, t),
          sql`${tables.journals.sourceType} != 'VAT_RETURN'`
        )
      )
      .groupBy(tables.journals.sourceType)
      .all();
    let output = 0, input = 0;
    for (const r of rows) {
      output += r.credit;
      input += r.debit;
    }
    return { output, input };
  };

  const cur = box(from, to);
  const prev = box(prevFrom, prevTo);
  const curNet = cur.output - cur.input;
  const prevNet = prev.output - prev.input;
  const delta = curNet - prevNet;

  const details = [
    `VAT on sales: ${fmtEUR(prev.output)} → ${fmtEUR(cur.output)} (${cur.output - prev.output >= 0 ? "+" : "−"}${fmtEUR(Math.abs(cur.output - prev.output))}).`,
    `VAT reclaimed on purchases: ${fmtEUR(prev.input)} → ${fmtEUR(cur.input)} (${cur.input - prev.input >= 0 ? "+" : "−"}${fmtEUR(Math.abs(cur.input - prev.input))}).`,
  ];

  let cause: string;
  if (Math.abs(cur.output - prev.output) >= Math.abs(cur.input - prev.input)) {
    cause = cur.output > prev.output
      ? "you invoiced more at VAT-carrying rates this period"
      : "you invoiced less at VAT-carrying rates this period";
  } else {
    cause = cur.input < prev.input
      ? "you reclaimed less input VAT on purchases"
      : "you reclaimed more input VAT on purchases";
  }

  return {
    answer: `Your net VAT position moved from ${fmtEUR(prevNet)} to ${fmtEUR(curNet)} (${delta >= 0 ? "+" : "−"}${fmtEUR(Math.abs(delta))}) — mostly because ${cause}.`,
    details,
    evidence: [{ label: "VAT control account activity", href: `/vat` }],
  };
}

export function biggestExpenseIncreases(companyId: string, from: Date, to: Date): Insight {
  const len = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - len);
  const cur = profitAndLoss(companyId, from, to);
  const prev = profitAndLoss(companyId, prevFrom, prevTo);
  const prevMap = new Map(prev.operatingExpenses.rows.concat(prev.costOfSales.rows).map((r) => [r.accountId, r.amountCents]));
  const moves = cur.operatingExpenses.rows
    .concat(cur.costOfSales.rows)
    .map((r) => ({ ...r, delta: r.amountCents - (prevMap.get(r.accountId) ?? 0) }))
    .filter((r) => r.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  return {
    answer: moves.length
      ? `The largest expense increases versus the prior period: ${moves.map((m) => `${m.name} (+${fmtEUR(m.delta)})`).join(", ")}.`
      : "No expense category increased versus the prior period.",
    details: moves.map((m) => `• ${m.name}: ${fmtEUR((prevMap.get(m.accountId) ?? 0))} → ${fmtEUR(m.amountCents)}`),
    evidence: moves.map((m) => ({ label: `${m.code} ${m.name}`, href: `/ledger/accounts/${m.accountId}` })),
  };
}

// ── Health score ─────────────────────────────────────────────────────────

export interface HealthReport {
  score: number; // 0-100
  grade: "A" | "B" | "C" | "D";
  factors: Array<{ label: string; impact: number; detail: string; href?: string }>;
}

export function healthScore(companyId: string): HealthReport {
  const factors: HealthReport["factors"] = [];
  let score = 100;

  // Unreconciled bank transactions
  const unrec = db
    .select({ n: sql<number>`count(*)`, oldest: sql<number>`min(${tables.bankTransactions.date})` })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(and(eq(tables.bankAccounts.companyId, companyId), eq(tables.bankTransactions.status, "UNRECONCILED")))
    .get();
  if (unrec && unrec.n > 0) {
    const penalty = Math.min(25, unrec.n * 2);
    score -= penalty;
    const ageDays = unrec.oldest ? Math.round((Date.now() - unrec.oldest) / 86_400_000) : 0;
    factors.push({
      label: `${unrec.n} unexplained bank transaction${unrec.n === 1 ? "" : "s"}`,
      impact: -penalty,
      detail: `Oldest is ${ageDays} days old. Unexplained transactions distort your P&L and VAT.`,
      href: "/banking",
    });
  }

  // Overdue invoices
  const overdue = db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${tables.invoices.totalCents} - ${tables.invoices.paidCents}), 0)` })
    .from(tables.invoices)
    .where(
      and(
        eq(tables.invoices.companyId, companyId),
        inArray(tables.invoices.status, ["APPROVED", "SENT"]),
        sql`${tables.invoices.dueDate} < ${Date.now()}`,
        sql`${tables.invoices.totalCents} > ${tables.invoices.paidCents}`
      )
    )
    .get();
  if (overdue && overdue.n > 0) {
    const penalty = Math.min(20, overdue.n * 3);
    score -= penalty;
    factors.push({
      label: `${overdue.n} overdue invoice${overdue.n === 1 ? "" : "s"} (${fmtEUR(overdue.total)})`,
      impact: -penalty,
      detail: "Chasing these improves cash flow — payment reminders can help.",
      href: "/sales/invoices?filter=overdue",
    });
  }

  // Draft documents ageing
  const drafts = db
    .select({ n: sql<number>`count(*)` })
    .from(tables.invoices)
    .where(and(eq(tables.invoices.companyId, companyId), eq(tables.invoices.status, "DRAFT")))
    .get();
  const draftBills = db
    .select({ n: sql<number>`count(*)` })
    .from(tables.bills)
    .where(and(eq(tables.bills.companyId, companyId), inArray(tables.bills.status, ["DRAFT", "AWAITING_APPROVAL"])))
    .get();
  const draftCount = (drafts?.n ?? 0) + (draftBills?.n ?? 0);
  if (draftCount > 0) {
    const penalty = Math.min(10, draftCount);
    score -= penalty;
    factors.push({
      label: `${draftCount} draft document${draftCount === 1 ? "" : "s"} awaiting approval`,
      impact: -penalty,
      detail: "Draft invoices and bills are not in your accounts or VAT return until approved.",
      href: "/inbox",
    });
  }

  // Anomalies
  const anomalies = detectAnomalies(companyId);
  const critical = anomalies.filter((a) => a.severity === "critical").length;
  const warning = anomalies.filter((a) => a.severity === "warning").length;
  if (critical + warning > 0) {
    const penalty = Math.min(20, critical * 8 + warning * 3);
    score -= penalty;
    factors.push({
      label: `${critical + warning} issue${critical + warning === 1 ? "" : "s"} flagged by anomaly checks`,
      impact: -penalty,
      detail: anomalies[0]?.title ?? "",
      href: "/inbox",
    });
  }

  // VAT deadline proximity with unfiled return
  const openReturn = db
    .select()
    .from(tables.vatReturns)
    .where(and(eq(tables.vatReturns.companyId, companyId), inArray(tables.vatReturns.status, ["DRAFT", "REVIEW"])))
    .all()
    .filter((r) => new Date(r.dueDate).getTime() - Date.now() < 21 * 86_400_000);
  if (openReturn.length > 0) {
    score -= 10;
    const r = openReturn[0];
    factors.push({
      label: "VAT return due soon",
      impact: -10,
      detail: `The return due ${new Date(r.dueDate).toLocaleDateString("en-IE")} has not been finalised.`,
      href: "/vat",
    });
  }

  score = Math.max(0, Math.round(score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  return { score, grade, factors };
}
