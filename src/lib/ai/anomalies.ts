// Anomaly detection — evidence-based checks over the company's real records.
// Each finding explains itself in plain English and links to the records involved.

import { db, tables } from "@/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { fmtEUR } from "@/lib/money";

export interface Anomaly {
  kind: "DUPLICATE" | "UNUSUAL_AMOUNT" | "MISSING_RECURRING" | "UNUSUAL_ACCOUNT" | "VAT_ANOMALY" | "SUSPENSE";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence: Array<{ label: string; href: string }>;
}

export function detectAnomalies(companyId: string, opts?: { lookbackDays?: number }): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const lookback = new Date(Date.now() - (opts?.lookbackDays ?? 400) * 86_400_000);

  duplicateBills(companyId, lookback, anomalies);
  duplicateExpenses(companyId, lookback, anomalies);
  unusualAmounts(companyId, anomalies);
  missingRecurring(companyId, anomalies);
  suspenseBalance(companyId, anomalies);
  vatAnomalies(companyId, anomalies);

  const order = { critical: 0, warning: 1, info: 2 };
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Same supplier + same total within 10 days → possible duplicate bill. */
function duplicateBills(companyId: string, since: Date, out: Anomaly[]) {
  const bills = db
    .select({
      id: tables.bills.id, number: tables.bills.number, date: tables.bills.date,
      totalCents: tables.bills.totalCents, contactId: tables.bills.contactId,
      contactName: tables.contacts.name, supplierRef: tables.bills.supplierRef,
    })
    .from(tables.bills)
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .where(
      and(
        eq(tables.bills.companyId, companyId),
        inArray(tables.bills.status, ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "PAID"]),
        gte(tables.bills.date, since)
      )
    )
    .all();

  const seen = new Set<string>();
  for (let i = 0; i < bills.length; i++) {
    for (let j = i + 1; j < bills.length; j++) {
      const a = bills[i], b = bills[j];
      if (a.contactId !== b.contactId || a.totalCents !== b.totalCents) continue;
      if (Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) > 10 * 86_400_000) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const sameRef = a.supplierRef && a.supplierRef === b.supplierRef;
      out.push({
        kind: "DUPLICATE",
        severity: sameRef ? "critical" : "warning",
        title: `Possible duplicate bill from ${a.contactName}`,
        detail: `${a.number} and ${b.number} are both ${fmtEUR(a.totalCents)} from ${a.contactName} within 10 days${sameRef ? ` and share supplier reference “${a.supplierRef}” — almost certainly the same bill entered twice` : " — check they are genuinely separate bills"}.`,
        evidence: [
          { label: `Bill ${a.number}`, href: `/purchases/bills/${a.id}` },
          { label: `Bill ${b.number}`, href: `/purchases/bills/${b.id}` },
        ],
      });
    }
  }
}

/** Same merchant + same gross within 7 days → possible duplicate expense/receipt. */
function duplicateExpenses(companyId: string, since: Date, out: Anomaly[]) {
  const exps = db
    .select()
    .from(tables.expenses)
    .where(and(eq(tables.expenses.companyId, companyId), inArray(tables.expenses.status, ["DRAFT", "APPROVED"]), gte(tables.expenses.date, since)))
    .all();
  const seen = new Set<string>();
  for (let i = 0; i < exps.length; i++) {
    for (let j = i + 1; j < exps.length; j++) {
      const a = exps[i], b = exps[j];
      if (a.merchant.toLowerCase() !== b.merchant.toLowerCase() || a.grossCents !== b.grossCents) continue;
      if (Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) > 7 * 86_400_000) continue;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: "DUPLICATE",
        severity: "warning",
        title: `Possible duplicate expense — ${a.merchant}`,
        detail: `Two ${fmtEUR(a.grossCents)} expenses from ${a.merchant} within a week of each other. If the same receipt was scanned twice, one should be deleted before approval.`,
        evidence: [
          { label: `Expense ${new Date(a.date).toLocaleDateString("en-IE")}`, href: `/expenses/${a.id}` },
          { label: `Expense ${new Date(b.date).toLocaleDateString("en-IE")}`, href: `/expenses/${b.id}` },
        ],
      });
    }
  }
}

/** Transactions > mean + 2.5σ of their account's historical postings. */
function unusualAmounts(companyId: string, out: Anomaly[]) {
  const rows = db
    .select({
      accountId: tables.journalLines.accountId,
      code: tables.accounts.code,
      name: tables.accounts.name,
      subtype: tables.accounts.subtype,
      journalId: tables.journalLines.journalId,
      amount: sql<number>`max(${tables.journalLines.debitCents}, ${tables.journalLines.creditCents})`,
      description: tables.journals.description,
      date: tables.journals.date,
    })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .innerJoin(tables.accounts, eq(tables.journalLines.accountId, tables.accounts.id))
    .where(
      and(
        eq(tables.journals.companyId, companyId),
        inArray(tables.journals.status, ["POSTED", "REVERSED"]),
        inArray(tables.accounts.subtype, ["OPERATING_EXPENSE", "COST_OF_SALES"])
      )
    )
    .all();

  const byAccount = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byAccount.get(r.accountId) ?? [];
    arr.push(r);
    byAccount.set(r.accountId, arr);
  }

  for (const [, postings] of byAccount) {
    if (postings.length < 6) continue; // not enough history to call anything unusual
    const amounts = postings.map((p) => p.amount);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) continue;
    for (const p of postings) {
      const z = (p.amount - mean) / sd;
      if (z > 2.5 && p.amount > mean * 2 && p.amount - mean > 10000) {
        out.push({
          kind: "UNUSUAL_AMOUNT",
          severity: "warning",
          title: `Unusually large posting to ${p.name}`,
          detail: `“${p.description}” posted ${fmtEUR(p.amount)} to ${p.code} ${p.name} — ${(p.amount / mean).toFixed(1)}× the typical amount for this account (average ${fmtEUR(Math.round(mean))}). Worth confirming it's coded correctly.`,
          evidence: [{ label: `Journal — ${p.description}`, href: `/ledger/journals/${p.journalId}` }],
        });
      }
    }
  }
}

/** Regular monthly outgoings that skipped the most recent month. */
function missingRecurring(companyId: string, out: Anomaly[]) {
  const txns = db
    .select({
      description: tables.bankTransactions.description,
      date: tables.bankTransactions.date,
      amountCents: tables.bankTransactions.amountCents,
    })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(and(eq(tables.bankAccounts.companyId, companyId), sql`${tables.bankTransactions.amountCents} < 0`))
    .all();

  // group by normalised narrative
  const groups = new Map<string, Array<{ date: Date; amountCents: number }>>();
  for (const t of txns) {
    const key = t.description.toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (key.length < 5) continue;
    const arr = groups.get(key) ?? [];
    arr.push({ date: new Date(t.date), amountCents: t.amountCents });
    groups.set(key, arr);
  }

  const now = Date.now();
  for (const [key, items] of groups) {
    if (items.length < 3) continue;
    items.sort((a, b) => a.date.getTime() - b.date.getTime());
    // check monthly cadence: median gap 25–35 days
    const gaps: number[] = [];
    for (let i = 1; i < items.length; i++) gaps.push((items[i].date.getTime() - items[i - 1].date.getTime()) / 86_400_000);
    const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (median < 25 || median > 35) continue;
    const last = items[items.length - 1];
    const daysSince = (now - last.date.getTime()) / 86_400_000;
    if (daysSince > 40 && daysSince < 100) {
      out.push({
        kind: "MISSING_RECURRING",
        severity: "info",
        title: `Recurring payment “${key.trim()}” may be missing`,
        detail: `This roughly-monthly payment (typically ${fmtEUR(Math.abs(last.amountCents))}) last appeared ${Math.round(daysSince)} days ago. If it should have recurred, the bank feed may be incomplete — or the direct debit failed.`,
        evidence: [],
      });
    }
  }
}

/** Suspense account should be zero. */
function suspenseBalance(companyId: string, out: Anomaly[]) {
  const suspense = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, "SUSPENSE")))
    .get();
  if (!suspense) return;
  const bal = db
    .select({ b: sql<number>`coalesce(sum(${tables.journalLines.debitCents} - ${tables.journalLines.creditCents}), 0)` })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .where(and(eq(tables.journals.companyId, companyId), eq(tables.journalLines.accountId, suspense.id), inArray(tables.journals.status, ["POSTED", "REVERSED"])))
    .get();
  if (bal && bal.b !== 0) {
    out.push({
      kind: "SUSPENSE",
      severity: "critical",
      title: `Suspense account holds ${fmtEUR(Math.abs(bal.b))}`,
      detail: `The suspense account should always return to zero — it currently carries ${fmtEUR(bal.b)}. These are postings nobody has explained yet, and they will distort your accounts until reallocated.`,
      evidence: [{ label: "Suspense account activity", href: `/ledger/accounts/${suspense.id}` }],
    });
  }
}

/** VAT sense checks: standard-rated postings claiming no VAT and vice versa. */
function vatAnomalies(companyId: string, out: Anomaly[]) {
  // Approved bills where a line's VAT is 0 but the account default is standard-rated
  const rows = db
    .select({
      billId: tables.bills.id,
      number: tables.bills.number,
      contactName: tables.contacts.name,
      lineDesc: tables.billLines.description,
      netCents: tables.billLines.netCents,
      vatCents: tables.billLines.vatCents,
      rateCategory: tables.vatRates.category,
      accountId: tables.billLines.accountId,
    })
    .from(tables.billLines)
    .innerJoin(tables.bills, eq(tables.billLines.billId, tables.bills.id))
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .innerJoin(tables.vatRates, eq(tables.billLines.vatRateId, tables.vatRates.id))
    .where(and(eq(tables.bills.companyId, companyId), inArray(tables.bills.status, ["APPROVED", "PAID"])))
    .all();

  for (const r of rows) {
    const acct = db.select().from(tables.accounts).where(eq(tables.accounts.id, r.accountId)).get();
    if (!acct?.defaultVatRateId) continue;
    const defaultRate = db.select().from(tables.vatRates).where(eq(tables.vatRates.id, acct.defaultVatRateId)).get();
    if (!defaultRate) continue;
    if (defaultRate.category === "STANDARD" && (r.rateCategory === "ZERO" || r.rateCategory === "EXEMPT") && r.netCents > 20000) {
      out.push({
        kind: "VAT_ANOMALY",
        severity: "info",
        title: `No VAT claimed on “${r.lineDesc}” (${r.number})`,
        detail: `${fmtEUR(r.netCents)} was posted to ${acct.name} — an account that usually carries 23% VAT — but no input VAT was claimed. If ${r.contactName} charged VAT, you may be leaving ${fmtEUR(Math.round(r.netCents * 0.23))} unreclaimed.`,
        evidence: [{ label: `Bill ${r.number}`, href: `/purchases/bills/${r.billId}` }],
      });
    }
  }
}
