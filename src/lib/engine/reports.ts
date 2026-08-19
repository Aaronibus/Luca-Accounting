// Financial reporting — every figure is computed from posted journal lines,
// and every figure can be drilled back to the journals that produced it.
// REVERSED journals remain in the ledger; their reversal cancels them.

import { db, tables } from "@/db";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { AccountSubtype, AccountType, NORMAL_SIDE } from "@/lib/types";

const LEDGER_STATUSES = ["POSTED", "REVERSED"];

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey: string | null;
  /** net debit (positive) or credit (negative) in cents */
  netCents: number;
}

/** Net movement per account over a window (or all time / as-of). */
export function accountBalances(companyId: string, opts?: { from?: Date; to?: Date }): AccountBalanceRow[] {
  const conditions = [
    eq(tables.journals.companyId, companyId),
    inArray(tables.journals.status, LEDGER_STATUSES),
  ];
  if (opts?.from) conditions.push(gte(tables.journals.date, opts.from));
  if (opts?.to) conditions.push(lte(tables.journals.date, opts.to));

  const rows = db
    .select({
      accountId: tables.accounts.id,
      code: tables.accounts.code,
      name: tables.accounts.name,
      type: tables.accounts.type,
      subtype: tables.accounts.subtype,
      systemKey: tables.accounts.systemKey,
      netCents: sql<number>`coalesce(sum(${tables.journalLines.debitCents} - ${tables.journalLines.creditCents}), 0)`,
    })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .innerJoin(tables.accounts, eq(tables.journalLines.accountId, tables.accounts.id))
    .where(and(...conditions))
    .groupBy(tables.accounts.id)
    .orderBy(asc(tables.accounts.code))
    .all();

  return rows as AccountBalanceRow[];
}

// ───────────────────────── Trial balance ─────────────────────────

export interface TrialBalanceRow extends AccountBalanceRow {
  debitCents: number;
  creditCents: number;
}

export function trialBalance(companyId: string, asOf?: Date): { rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number } {
  const balances = accountBalances(companyId, { to: asOf });
  const rows: TrialBalanceRow[] = balances
    .filter((b) => b.netCents !== 0)
    .map((b) => ({
      ...b,
      debitCents: b.netCents > 0 ? b.netCents : 0,
      creditCents: b.netCents < 0 ? -b.netCents : 0,
    }));
  return {
    rows,
    totalDebit: rows.reduce((a, r) => a + r.debitCents, 0),
    totalCredit: rows.reduce((a, r) => a + r.creditCents, 0),
  };
}

// ───────────────────────── Profit & loss ─────────────────────────

export interface PnlSection {
  label: string;
  rows: Array<{ accountId: string; code: string; name: string; amountCents: number }>;
  totalCents: number;
}

export interface PnlReport {
  from: Date;
  to: Date;
  revenue: PnlSection;
  costOfSales: PnlSection;
  grossProfitCents: number;
  operatingExpenses: PnlSection;
  otherIncome: PnlSection;
  financeCosts: PnlSection;
  netProfitCents: number;
}

export function profitAndLoss(companyId: string, from: Date, to: Date): PnlReport {
  const balances = accountBalances(companyId, { from, to });

  const section = (filter: (b: AccountBalanceRow) => boolean, flip: boolean, label: string): PnlSection => {
    const rows = balances
      .filter(filter)
      .map((b) => ({
        accountId: b.accountId,
        code: b.code,
        name: b.name,
        // income accounts have credit balances → flip sign so revenue is positive
        amountCents: flip ? -b.netCents : b.netCents,
      }))
      .filter((r) => r.amountCents !== 0);
    return { label, rows, totalCents: rows.reduce((a, r) => a + r.amountCents, 0) };
  };

  const revenue = section((b) => b.subtype === "REVENUE", true, "Revenue");
  const otherIncome = section((b) => b.subtype === "OTHER_INCOME", true, "Other income");
  const costOfSales = section((b) => b.subtype === "COST_OF_SALES", false, "Cost of sales");
  const operatingExpenses = section(
    (b) => b.type === "EXPENSE" && (b.subtype === "OPERATING_EXPENSE" || b.subtype === "DEPRECIATION"),
    false,
    "Operating expenses"
  );
  const financeCosts = section((b) => b.subtype === "FINANCE_COST", false, "Finance costs");

  const grossProfitCents = revenue.totalCents - costOfSales.totalCents;
  const netProfitCents =
    grossProfitCents + otherIncome.totalCents - operatingExpenses.totalCents - financeCosts.totalCents;

  return { from, to, revenue, costOfSales, grossProfitCents, operatingExpenses, otherIncome, financeCosts, netProfitCents };
}

// ───────────────────────── Balance sheet ─────────────────────────

export interface BalanceSheetSection {
  label: string;
  rows: Array<{ accountId: string; code: string; name: string; amountCents: number }>;
  totalCents: number;
}

export interface BalanceSheetReport {
  asOf: Date;
  fixedAssets: BalanceSheetSection;
  currentAssets: BalanceSheetSection;
  currentLiabilities: BalanceSheetSection;
  longTermLiabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  netAssetsCents: number;
  totalEquityCents: number;
  /** cumulative P&L folded into equity */
  retainedEarningsComputedCents: number;
  balances: boolean;
}

export function balanceSheet(companyId: string, asOf: Date): BalanceSheetReport {
  const balances = accountBalances(companyId, { to: asOf });

  const pick = (filter: (b: AccountBalanceRow) => boolean, flip: boolean, label: string): BalanceSheetSection => {
    const rows = balances
      .filter(filter)
      .map((b) => ({ accountId: b.accountId, code: b.code, name: b.name, amountCents: flip ? -b.netCents : b.netCents }))
      .filter((r) => r.amountCents !== 0);
    return { label, rows, totalCents: rows.reduce((a, r) => a + r.amountCents, 0) };
  };

  const fixedAssets = pick((b) => b.subtype === "FIXED_ASSET", false, "Fixed assets");
  const currentAssets = pick(
    (b) => b.type === "ASSET" && b.subtype !== "FIXED_ASSET",
    false,
    "Current assets"
  );
  const currentLiabilities = pick(
    (b) => b.type === "LIABILITY" && b.subtype !== "LONG_TERM_LIABILITY",
    true,
    "Current liabilities"
  );
  const longTermLiabilities = pick((b) => b.subtype === "LONG_TERM_LIABILITY", true, "Long-term liabilities");
  const equity = pick((b) => b.type === "EQUITY", true, "Equity");

  // Cumulative earnings to date (income − expenses), credited to equity
  const retainedEarningsComputedCents = balances
    .filter((b) => b.type === "INCOME" || b.type === "EXPENSE")
    .reduce((a, b) => a - b.netCents, 0);

  const netAssetsCents =
    fixedAssets.totalCents + currentAssets.totalCents - currentLiabilities.totalCents - longTermLiabilities.totalCents;
  const totalEquityCents = equity.totalCents + retainedEarningsComputedCents;

  return {
    asOf,
    fixedAssets,
    currentAssets,
    currentLiabilities,
    longTermLiabilities,
    equity,
    netAssetsCents,
    totalEquityCents,
    retainedEarningsComputedCents,
    balances: netAssetsCents === totalEquityCents,
  };
}

// ───────────────────────── Aged debtors / creditors ─────────────────────────

export interface AgedRow {
  contactId: string;
  contactName: string;
  currentCents: number;
  days1to30Cents: number;
  days31to60Cents: number;
  days61to90Cents: number;
  days90plusCents: number;
  totalCents: number;
  items: Array<{ id: string; number: string; date: Date; dueDate: Date; outstandingCents: number; daysOverdue: number }>;
}

function ageBuckets(items: Array<{ contactId: string; contactName: string; id: string; number: string; date: Date; dueDate: Date; outstandingCents: number }>, asOf: Date): AgedRow[] {
  const byContact = new Map<string, AgedRow>();
  for (const item of items) {
    let row = byContact.get(item.contactId);
    if (!row) {
      row = {
        contactId: item.contactId, contactName: item.contactName,
        currentCents: 0, days1to30Cents: 0, days31to60Cents: 0, days61to90Cents: 0, days90plusCents: 0,
        totalCents: 0, items: [],
      };
      byContact.set(item.contactId, row);
    }
    const daysOverdue = Math.floor((asOf.getTime() - item.dueDate.getTime()) / 86_400_000);
    const amt = item.outstandingCents;
    if (daysOverdue <= 0) row.currentCents += amt;
    else if (daysOverdue <= 30) row.days1to30Cents += amt;
    else if (daysOverdue <= 60) row.days31to60Cents += amt;
    else if (daysOverdue <= 90) row.days61to90Cents += amt;
    else row.days90plusCents += amt;
    row.totalCents += amt;
    row.items.push({ id: item.id, number: item.number, date: item.date, dueDate: item.dueDate, outstandingCents: amt, daysOverdue: Math.max(0, daysOverdue) });
  }
  return [...byContact.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export function agedDebtors(companyId: string, asOf = new Date()): AgedRow[] {
  const rows = db
    .select({
      id: tables.invoices.id,
      number: tables.invoices.number,
      date: tables.invoices.date,
      dueDate: tables.invoices.dueDate,
      totalCents: tables.invoices.totalCents,
      paidCents: tables.invoices.paidCents,
      kind: tables.invoices.kind,
      contactId: tables.invoices.contactId,
      contactName: tables.contacts.name,
    })
    .from(tables.invoices)
    .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
    .where(
      and(
        eq(tables.invoices.companyId, companyId),
        inArray(tables.invoices.status, ["APPROVED", "SENT"]),
        lte(tables.invoices.date, asOf)
      )
    )
    .all();

  return ageBuckets(
    rows
      .filter((r) => r.totalCents - r.paidCents !== 0)
      .map((r) => ({
        contactId: r.contactId,
        contactName: r.contactName,
        id: r.id,
        number: r.number,
        date: new Date(r.date),
        dueDate: new Date(r.dueDate),
        outstandingCents: (r.kind === "CREDIT_NOTE" ? -1 : 1) * (r.totalCents - r.paidCents),
      })),
    asOf
  );
}

export function agedCreditors(companyId: string, asOf = new Date()): AgedRow[] {
  const rows = db
    .select({
      id: tables.bills.id,
      number: tables.bills.number,
      date: tables.bills.date,
      dueDate: tables.bills.dueDate,
      totalCents: tables.bills.totalCents,
      paidCents: tables.bills.paidCents,
      kind: tables.bills.kind,
      contactId: tables.bills.contactId,
      contactName: tables.contacts.name,
    })
    .from(tables.bills)
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .where(
      and(
        eq(tables.bills.companyId, companyId),
        eq(tables.bills.status, "APPROVED"),
        lte(tables.bills.date, asOf)
      )
    )
    .all();

  return ageBuckets(
    rows
      .filter((r) => r.totalCents - r.paidCents !== 0)
      .map((r) => ({
        contactId: r.contactId,
        contactName: r.contactName,
        id: r.id,
        number: r.number,
        date: new Date(r.date),
        dueDate: new Date(r.dueDate),
        outstandingCents: (r.kind === "SUPPLIER_CREDIT" ? -1 : 1) * (r.totalCents - r.paidCents),
      })),
    asOf
  );
}

// ───────────────────────── Account activity (drill-down) ─────────────────────────

export interface ActivityLine {
  journalId: string;
  journalNumber: number;
  date: Date;
  description: string;
  lineDescription: string | null;
  sourceType: string;
  sourceId: string | null;
  debitCents: number;
  creditCents: number;
  runningCents: number;
  journalStatus: string;
}

export function accountActivity(companyId: string, accountId: string, opts?: { from?: Date; to?: Date }): {
  openingCents: number;
  lines: ActivityLine[];
  closingCents: number;
} {
  // Opening balance = everything before `from`
  let openingCents = 0;
  if (opts?.from) {
    const row = db
      .select({ bal: sql<number>`coalesce(sum(${tables.journalLines.debitCents} - ${tables.journalLines.creditCents}), 0)` })
      .from(tables.journalLines)
      .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
      .where(
        and(
          eq(tables.journals.companyId, companyId),
          eq(tables.journalLines.accountId, accountId),
          inArray(tables.journals.status, LEDGER_STATUSES),
          sql`${tables.journals.date} < ${opts.from.getTime()}`
        )
      )
      .get();
    openingCents = row?.bal ?? 0;
  }

  const conditions = [
    eq(tables.journals.companyId, companyId),
    eq(tables.journalLines.accountId, accountId),
    inArray(tables.journals.status, LEDGER_STATUSES),
  ];
  if (opts?.from) conditions.push(gte(tables.journals.date, opts.from));
  if (opts?.to) conditions.push(lte(tables.journals.date, opts.to));

  const raw = db
    .select({
      journalId: tables.journals.id,
      journalNumber: tables.journals.journalNumber,
      date: tables.journals.date,
      description: tables.journals.description,
      lineDescription: tables.journalLines.description,
      sourceType: tables.journals.sourceType,
      sourceId: tables.journals.sourceId,
      debitCents: tables.journalLines.debitCents,
      creditCents: tables.journalLines.creditCents,
      journalStatus: tables.journals.status,
    })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .where(and(...conditions))
    .orderBy(asc(tables.journals.date), asc(tables.journals.journalNumber))
    .all();

  let running = openingCents;
  const lines: ActivityLine[] = raw.map((r) => {
    running += r.debitCents - r.creditCents;
    return { ...r, date: new Date(r.date), runningCents: running };
  });

  return { openingCents, lines, closingCents: running };
}

/** Present the signed net balance the way a user expects for that account type (positive = normal). */
export function presentedBalance(type: AccountType, netCents: number): number {
  return NORMAL_SIDE[type] === "DEBIT" ? netCents : -netCents;
}
