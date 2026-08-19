// The copilot — context-aware Q&A and command execution over real accounting data.
// Questions are answered by deterministic analysis functions (insights.ts);
// commands run the same engine paths as manual actions and report what changed.
// When an LLM is configured it may rephrase the grounded answer — the numbers
// always come from the ledger.

import { db, tables } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import {
  explainProfitChange,
  explainVatChange,
  explainReconciliation,
  biggestExpenseIncreases,
  healthScore,
  Insight,
} from "./insights";
import { detectAnomalies } from "./anomalies";
import { generateBankSuggestions } from "./categorise";
import { acceptAllConfident } from "./suggestions";
import { prepareVatReturn, vatPeriodsForYear } from "@/lib/engine/vat";
import { agedDebtors, profitAndLoss } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";
import { getLlm, llmConfigured } from "./llm";

export interface CopilotContext {
  page?: string; // route the user is on, e.g. /banking/xyz, /vat, /reports/pnl
  entityId?: string;
}

export interface CopilotResult {
  answer: string;
  details: string[];
  evidence: Array<{ label: string; href: string }>;
  actionsTaken?: string[];
}

function currentMonth(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59)),
  };
}

function parsePeriod(q: string): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (/last month/i.test(q)) {
    return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0, 23, 59, 59)) };
  }
  if (/this quarter|quarter/i.test(q)) {
    const qStart = Math.floor(m / 3) * 3;
    return { from: new Date(Date.UTC(y, qStart, 1)), to: new Date(Date.UTC(y, qStart + 3, 0, 23, 59, 59)) };
  }
  if (/this year|year to date|ytd/i.test(q)) {
    return { from: new Date(Date.UTC(y, 0, 1)), to: now };
  }
  return currentMonth();
}

export async function askCopilot(opts: {
  companyId: string;
  userId: string;
  question: string;
  context?: CopilotContext;
}): Promise<CopilotResult> {
  const q = opts.question.toLowerCase();
  const { companyId, userId } = opts;

  // ── Commands ──
  if (/categorise|categorize|explain (this|the) week|suggest.*(transaction|categor)/i.test(q) && /categori|transaction/i.test(q)) {
    const { created } = generateBankSuggestions(companyId);
    const pending = countPending(companyId);
    return {
      answer:
        created > 0
          ? `I've analysed your unexplained bank transactions and prepared ${created} new suggestion${created === 1 ? "" : "s"} (${pending} now waiting in total). Each one shows my reasoning and evidence — nothing is posted until you approve it.`
          : pending > 0
            ? `No new suggestions — but ${pending} ${pending === 1 ? "is" : "are"} already waiting for your review.`
            : "Everything explainable has been explained — there are no unmatched transactions I can categorise right now.",
      details: [],
      evidence: [{ label: "Review suggestions", href: "/inbox" }],
      actionsTaken: created > 0 ? [`Generated ${created} categorisation suggestions`] : [],
    };
  }

  if (/reconcile everything|reconcile all|auto.?reconcile/i.test(q)) {
    generateBankSuggestions(companyId);
    const result = acceptAllConfident({ companyId, userId, threshold: 92 });
    const details = result.applied.slice(0, 8).map((a) => `✓ ${a.explanation}`);
    if (result.skipped.length > 0) {
      details.push(`Left for your review (${result.skipped.length}):`);
      details.push(...result.skipped.slice(0, 5).map((s) => `• ${s.explanation} — ${s.reason}`));
    }
    return {
      answer: `I applied ${result.applied.length} high-confidence match${result.applied.length === 1 ? "" : "es"} (≥92% confidence, rules and exact document matches only) and left ${result.skipped.length} for your judgement. Every change is in the audit trail and reversible.`,
      details,
      evidence: [{ label: "See what changed", href: "/inbox?tab=history" }],
      actionsTaken: result.applied.map((a) => a.explanation),
    };
  }

  if (/prepare.*(vat|return)|vat.*prepare/i.test(q)) {
    const company = db.select().from(tables.companies).where(eq(tables.companies.id, companyId)).get()!;
    const now = new Date();
    const periods = vatPeriodsForYear(now.getUTCFullYear(), company.vatPeriodMonths).filter((p) => p.end < now);
    const latest = periods[periods.length - 1];
    if (!latest) return { answer: "No completed VAT period yet this year.", details: [], evidence: [] };
    const prepared = prepareVatReturn({ companyId, periodStart: latest.start, periodEnd: latest.end, userId });
    const details = [
      `T1 (VAT on sales): ${fmtEUR(prepared.t1Cents)}`,
      `T2 (VAT on purchases): ${fmtEUR(prepared.t2Cents)}`,
      prepared.t3Cents > 0 ? `T3 (payable): ${fmtEUR(prepared.t3Cents)}` : `T4 (repayable): ${fmtEUR(prepared.t4Cents)}`,
    ];
    if (prepared.exceptions.length > 0) {
      details.push(`⚠ ${prepared.exceptions.length} exception${prepared.exceptions.length === 1 ? "" : "s"} to review before filing:`);
      details.push(...prepared.exceptions.slice(0, 4).map((e) => `• ${e.message}`));
    }
    return {
      answer: `I've prepared the ${latest.label} VAT return as a draft for your review${prepared.exceptions.length ? ` — with ${prepared.exceptions.length} exception${prepared.exceptions.length === 1 ? "" : "s"} you should look at first` : " — no exceptions found"}. It isn't filed or finalised until you approve it.`,
      details,
      evidence: [{ label: `Review ${latest.label} return`, href: `/vat` }],
      actionsTaken: [`Prepared draft VAT return ${latest.label}`],
    };
  }

  if (/(find|show|anything).*(wrong|unusual|issue|suspicious|check)|unusual transaction/i.test(q)) {
    const anomalies = detectAnomalies(companyId);
    if (anomalies.length === 0) {
      return { answer: "I ran duplicate, outlier, VAT and recurring-payment checks across your records — nothing looks wrong right now.", details: [], evidence: [] };
    }
    return {
      answer: `I found ${anomalies.length} thing${anomalies.length === 1 ? "" : "s"} worth checking — ${summariseSeverity(anomalies)}.`,
      details: anomalies.slice(0, 6).map((a) => `${a.severity === "critical" ? "⛔" : a.severity === "warning" ? "⚠" : "ℹ"} ${a.title}: ${a.detail}`),
      evidence: anomalies.flatMap((a) => a.evidence).slice(0, 8),
    };
  }

  // ── Questions ──
  if (/profit|earn|income.*(down|up|lower|higher|drop|fall|change)/i.test(q) && /why|what|how|explain/i.test(q)) {
    const { from, to } = parsePeriod(q);
    return await maybeRephrase(explainProfitChange(companyId, from, to), opts.question);
  }
  if (/vat/i.test(q) && /(why|higher|increase|up|change|lower|down)/i.test(q)) {
    const { from, to } = parsePeriod(q);
    return await maybeRephrase(explainVatChange(companyId, from, to), opts.question);
  }
  if (/expense|cost|spend/i.test(q) && /(most|biggest|increase|grew|up)/i.test(q)) {
    const { from, to } = parsePeriod(q);
    return await maybeRephrase(biggestExpenseIncreases(companyId, from, to), opts.question);
  }
  if (/reconcil/i.test(q)) {
    // pick the bank account from context or the first one
    let bankAccountId = opts.context?.page?.match(/\/banking\/([a-z0-9-]+)/i)?.[1];
    if (!bankAccountId) {
      const first = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, companyId)).get();
      bankAccountId = first?.id;
    }
    if (!bankAccountId) return { answer: "There's no bank account set up yet.", details: [], evidence: [] };
    return await maybeRephrase(explainReconciliation(companyId, bankAccountId), opts.question);
  }
  if (/who owes|overdue|debtors|owed/i.test(q)) {
    const aged = agedDebtors(companyId);
    const overdue = aged.filter((a) => a.totalCents - a.currentCents > 0);
    const total = overdue.reduce((s, a) => s + a.totalCents - a.currentCents, 0);
    return {
      answer: overdue.length
        ? `${overdue.length} customer${overdue.length === 1 ? " is" : "s are"} overdue, owing ${fmtEUR(total)} past due in total. ${overdue[0].contactName} is the largest at ${fmtEUR(overdue[0].totalCents - overdue[0].currentCents)}.`
        : "No customer is overdue right now.",
      details: overdue.slice(0, 6).map((a) => `• ${a.contactName}: ${fmtEUR(a.totalCents - a.currentCents)} overdue (${fmtEUR(a.totalCents)} outstanding in total)`),
      evidence: [{ label: "Aged debtors report", href: "/reports/aged-debtors" }],
    };
  }
  if (/health|attention|status|what.*(need|should)/i.test(q)) {
    const health = healthScore(companyId);
    return {
      answer: `Your accounting health score is ${health.score}/100 (grade ${health.grade}).${health.factors.length ? " Here's what's costing you points:" : " Everything looks in order."}`,
      details: health.factors.map((f) => `• ${f.label} (${f.impact}): ${f.detail}`),
      evidence: health.factors.filter((f) => f.href).map((f) => ({ label: f.label, href: f.href! })),
    };
  }

  // Contextual defaults per page
  if (opts.context?.page?.startsWith("/vat")) {
    const { from, to } = parsePeriod(q);
    return await maybeRephrase(explainVatChange(companyId, from, to), opts.question);
  }
  if (opts.context?.page?.startsWith("/banking") && opts.context.page.split("/").length > 2) {
    return await maybeRephrase(explainReconciliation(companyId, opts.context.page.split("/")[2]), opts.question);
  }

  // Fallback: try the LLM with grounded facts; otherwise list capabilities
  if (llmConfigured()) {
    const facts = collectFacts(companyId);
    const llm = getLlm();
    const response = await llm.complete({
      system:
        "You are Lúca's accounting copilot for an Irish business. Answer the user's question using ONLY the JSON facts provided. If the facts cannot answer it, say what data would be needed. Keep it under 120 words, plain English, no invented figures.",
      user: `Facts: ${JSON.stringify(facts)}\n\nQuestion: ${opts.question}`,
    });
    if (response) return { answer: response, details: [], evidence: [{ label: "Dashboard", href: "/dashboard" }] };
  }

  return {
    answer:
      "I can answer questions grounded in your actual accounts — try “Why is my profit down this month?”, “Why has my VAT increased?”, “Which expenses increased the most?”, “Who owes me money?”, “What's preventing reconciliation?” — or ask me to act: “Categorise this week's transactions”, “Reconcile everything you can”, “Prepare the VAT return for my review”, “Find anything that looks wrong.”",
    details: [],
    evidence: [],
  };
}

function countPending(companyId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .get();
  return row?.n ?? 0;
}

function summariseSeverity(anomalies: Array<{ severity: string }>): string {
  const c = anomalies.filter((a) => a.severity === "critical").length;
  const w = anomalies.filter((a) => a.severity === "warning").length;
  const i = anomalies.filter((a) => a.severity === "info").length;
  const parts = [];
  if (c) parts.push(`${c} critical`);
  if (w) parts.push(`${w} warning${w === 1 ? "" : "s"}`);
  if (i) parts.push(`${i} informational`);
  return parts.join(", ");
}

async function maybeRephrase(insight: Insight, question: string): Promise<CopilotResult> {
  if (!llmConfigured()) return insight;
  const llm = getLlm();
  const response = await llm.complete({
    system:
      "Rephrase this grounded accounting analysis as a direct answer to the user's question. Keep EVERY figure exactly as given — do not compute, round or invent numbers. Under 100 words.",
    user: `Question: ${question}\n\nAnalysis: ${insight.answer}\n${insight.details.join("\n")}`,
  });
  return response ? { ...insight, answer: response } : insight;
}

function collectFacts(companyId: string) {
  const now = new Date();
  const { from, to } = { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
  const pnl = profitAndLossSafe(companyId, from, to);
  const health = healthScore(companyId);
  const aged = agedDebtors(companyId).slice(0, 5);
  return { monthToDate: pnl, health: { score: health.score, factors: health.factors.map((f) => f.label) }, topDebtors: aged.map((a) => ({ name: a.contactName, cents: a.totalCents })) };
}

function profitAndLossSafe(companyId: string, from: Date, to: Date) {
  try {
    const p = profitAndLoss(companyId, from, to);
    return { revenueCents: p.revenue.totalCents, expensesCents: p.operatingExpenses.totalCents + p.costOfSales.totalCents, netProfitCents: p.netProfitCents };
  } catch {
    return null;
  }
}
