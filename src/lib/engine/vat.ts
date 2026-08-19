// Irish VAT engine — VAT3-style return preparation from the VAT control account.
// Every euro in the return traces to journal lines on the VAT control account,
// classified by the source of the journal that put them there.
//
// Boxes (VAT3): T1 VAT on sales · T2 VAT on purchases · T3 payable · T4 repayable
//               E1/E2 intra-EU goods · ES1/ES2 intra-EU services · PA1 postponed accounting
// Filing: bi-monthly by default; due the 23rd of the month after the period ends (ROS).

import { db, tables } from "@/db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { AccountingError, postJournal, systemAccount } from "./journal";
import { writeAudit } from "@/lib/audit";

const SALES_SOURCES = ["INVOICE", "CREDIT_NOTE"];
const PURCHASE_SOURCES = ["BILL", "SUPPLIER_CREDIT", "EXPENSE"];

export interface VatException {
  severity: "WARNING" | "REVIEW";
  code: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

export interface VatComputation {
  t1Cents: number;
  t2Cents: number;
  t3Cents: number;
  t4Cents: number;
  salesDetail: Array<{ journalId: string; journalNumber: number; date: Date; description: string; vatCents: number; sourceType: string; sourceId: string | null }>;
  purchaseDetail: Array<{ journalId: string; journalNumber: number; date: Date; description: string; vatCents: number; sourceType: string; sourceId: string | null }>;
  exceptions: VatException[];
}

/** Compute VAT3 boxes for a period from the VAT control account. */
export function computeVatReturn(companyId: string, periodStart: Date, periodEnd: Date): VatComputation {
  const company = db.select().from(tables.companies).where(eq(tables.companies.id, companyId)).get();
  if (!company) throw new AccountingError("Company not found", "NOT_FOUND");

  const vatControl = systemAccount(companyId, "VAT_CONTROL");

  const lines = db
    .select({
      journalId: tables.journals.id,
      journalNumber: tables.journals.journalNumber,
      date: tables.journals.date,
      description: tables.journals.description,
      sourceType: tables.journals.sourceType,
      sourceId: tables.journals.sourceId,
      debitCents: tables.journalLines.debitCents,
      creditCents: tables.journalLines.creditCents,
    })
    .from(tables.journalLines)
    .innerJoin(tables.journals, eq(tables.journalLines.journalId, tables.journals.id))
    .where(
      and(
        eq(tables.journals.companyId, companyId),
        eq(tables.journalLines.accountId, vatControl.id),
        inArray(tables.journals.status, ["POSTED", "REVERSED"]),
        gte(tables.journals.date, periodStart),
        lte(tables.journals.date, periodEnd)
      )
    )
    .all();

  const exceptions: VatException[] = [];
  let t1 = 0; // VAT on sales (credits to control, net of credit-note debits)
  let t2 = 0; // VAT on purchases (debits to control, net of supplier-credit credits)
  const salesDetail: VatComputation["salesDetail"] = [];
  const purchaseDetail: VatComputation["purchaseDetail"] = [];

  for (const l of lines) {
    const net = l.creditCents - l.debitCents; // + = output VAT direction
    const base = { journalId: l.journalId, journalNumber: l.journalNumber, date: new Date(l.date), description: l.description, sourceType: l.sourceType, sourceId: l.sourceId };

    if (SALES_SOURCES.includes(l.sourceType)) {
      t1 += net;
      salesDetail.push({ ...base, vatCents: net });
    } else if (PURCHASE_SOURCES.includes(l.sourceType)) {
      t2 += -net;
      purchaseDetail.push({ ...base, vatCents: -net });
    } else if (l.sourceType === "BANK") {
      // direct bank categorisation: money-in VAT is output, money-out VAT is input
      if (net > 0) {
        t1 += net;
        salesDetail.push({ ...base, vatCents: net });
      } else {
        t2 += -net;
        purchaseDetail.push({ ...base, vatCents: -net });
      }
    } else if (l.sourceType === "REVERSAL") {
      // Follow the direction of the reversal: it simply cancels whichever side it hits
      if (net > 0) { t1 += net; salesDetail.push({ ...base, vatCents: net }); }
      else { t2 += -net; purchaseDetail.push({ ...base, vatCents: -net }); }
    } else if (l.sourceType === "VAT_RETURN") {
      // period-close transfer journals are excluded from box maths
      continue;
    } else {
      // MANUAL / OPENING_BALANCE etc. — include by side but flag for review
      if (net > 0) { t1 += net; salesDetail.push({ ...base, vatCents: net }); }
      else { t2 += -net; purchaseDetail.push({ ...base, vatCents: -net }); }
      exceptions.push({
        severity: "REVIEW",
        code: "MANUAL_VAT_POSTING",
        message: `Journal #${l.journalNumber} (${l.sourceType.toLowerCase()}) posts directly to VAT control — confirm which box it belongs in.`,
        entityType: "journal",
        entityId: l.journalId,
      });
    }
  }

  if (company.vatBasis === "CASH") {
    exceptions.push({
      severity: "REVIEW",
      code: "CASH_BASIS",
      message:
        "This company is configured for the cash-receipts basis. Figures below are computed on the invoice basis — review before filing.",
    });
  }

  // Exception checks against the period
  runExceptionChecks(companyId, periodStart, periodEnd, exceptions);

  const netVat = t1 - t2;
  return {
    t1Cents: t1,
    t2Cents: t2,
    t3Cents: netVat > 0 ? netVat : 0,
    t4Cents: netVat < 0 ? -netVat : 0,
    salesDetail,
    purchaseDetail,
    exceptions,
  };
}

function runExceptionChecks(companyId: string, periodStart: Date, periodEnd: Date, out: VatException[]) {
  // 1. Draft invoices/bills dated inside the period — VAT would be missing from the return
  const draftInvoices = db
    .select({ id: tables.invoices.id, number: tables.invoices.number })
    .from(tables.invoices)
    .where(
      and(
        eq(tables.invoices.companyId, companyId),
        inArray(tables.invoices.status, ["DRAFT", "AWAITING_APPROVAL"]),
        gte(tables.invoices.date, periodStart),
        lte(tables.invoices.date, periodEnd)
      )
    )
    .all();
  for (const inv of draftInvoices) {
    out.push({
      severity: "WARNING",
      code: "DRAFT_INVOICE_IN_PERIOD",
      message: `Invoice ${inv.number} is still draft and dated inside this VAT period — its VAT is not in the return.`,
      entityType: "invoice",
      entityId: inv.id,
    });
  }
  const draftBills = db
    .select({ id: tables.bills.id, number: tables.bills.number })
    .from(tables.bills)
    .where(
      and(
        eq(tables.bills.companyId, companyId),
        inArray(tables.bills.status, ["DRAFT", "AWAITING_APPROVAL"]),
        gte(tables.bills.date, periodStart),
        lte(tables.bills.date, periodEnd)
      )
    )
    .all();
  for (const bill of draftBills) {
    out.push({
      severity: "WARNING",
      code: "DRAFT_BILL_IN_PERIOD",
      message: `Bill ${bill.number} is still draft and dated inside this VAT period — its input VAT is unclaimed.`,
      entityType: "bill",
      entityId: bill.id,
    });
  }

  // 2. Unexplained bank transactions in the period
  const unreconciled = db
    .select({ id: tables.bankTransactions.id })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(
      and(
        eq(tables.bankAccounts.companyId, companyId),
        eq(tables.bankTransactions.status, "UNRECONCILED"),
        gte(tables.bankTransactions.date, periodStart),
        lte(tables.bankTransactions.date, periodEnd)
      )
    )
    .all();
  if (unreconciled.length > 0) {
    out.push({
      severity: "WARNING",
      code: "UNRECONCILED_IN_PERIOD",
      message: `${unreconciled.length} bank transaction${unreconciled.length === 1 ? " is" : "s are"} still unexplained inside this period — VAT on them may be missing.`,
    });
  }
}

/** Standard Irish taxable periods for a year given the company's period length (default bi-monthly Jan/Feb…). */
export function vatPeriodsForYear(year: number, periodMonths: number): Array<{ start: Date; end: Date; due: Date; label: string }> {
  const periods: Array<{ start: Date; end: Date; due: Date; label: string }> = [];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let m = 0; m < 12; m += periodMonths) {
    const start = new Date(Date.UTC(year, m, 1));
    const end = new Date(Date.UTC(year, m + periodMonths, 0, 23, 59, 59, 999));
    const due = new Date(Date.UTC(year, m + periodMonths, 23)); // ROS filing: 23rd of following month
    periods.push({
      start,
      end,
      due,
      label: `${monthNames[m]}–${monthNames[Math.min(m + periodMonths - 1, 11)]} ${year}`,
    });
  }
  return periods;
}

/** Create or refresh a draft VAT return for a period. */
export function prepareVatReturn(opts: { companyId: string; periodStart: Date; periodEnd: Date; userId?: string }) {
  const calc = computeVatReturn(opts.companyId, opts.periodStart, opts.periodEnd);
  const due = new Date(Date.UTC(opts.periodEnd.getUTCFullYear(), opts.periodEnd.getUTCMonth() + 1, 23));

  const existing = db
    .select()
    .from(tables.vatReturns)
    .where(
      and(
        eq(tables.vatReturns.companyId, opts.companyId),
        eq(tables.vatReturns.periodStart, opts.periodStart),
        eq(tables.vatReturns.periodEnd, opts.periodEnd)
      )
    )
    .get();

  if (existing?.status === "FINALISED") {
    throw new AccountingError("This VAT return is finalised and cannot be recalculated", "FINALISED");
  }

  const values = {
    t1Cents: calc.t1Cents,
    t2Cents: calc.t2Cents,
    t3Cents: calc.t3Cents,
    t4Cents: calc.t4Cents,
    exceptions: JSON.stringify(calc.exceptions),
    dueDate: due,
  };

  let id: string;
  if (existing) {
    db.update(tables.vatReturns).set(values).where(eq(tables.vatReturns.id, existing.id)).run();
    id = existing.id;
  } else {
    const row = db
      .insert(tables.vatReturns)
      .values({ companyId: opts.companyId, periodStart: opts.periodStart, periodEnd: opts.periodEnd, status: "DRAFT", ...values })
      .returning({ id: tables.vatReturns.id })
      .get();
    id = row.id;
  }

  writeAudit({
    companyId: opts.companyId, userId: opts.userId, action: "vatreturn.prepared",
    entityType: "vat_return", entityId: id,
    after: { t1: calc.t1Cents, t2: calc.t2Cents, t3: calc.t3Cents, t4: calc.t4Cents },
  });

  return { id, ...calc, dueDate: due };
}

/**
 * Finalise a VAT return: moves the period's net VAT from VAT control to "VAT payable
 * to Revenue" and locks the period so nothing can be back-posted into a filed return.
 */
export function finaliseVatReturn(opts: { companyId: string; vatReturnId: string; userId: string }) {
  const ret = db
    .select()
    .from(tables.vatReturns)
    .where(and(eq(tables.vatReturns.id, opts.vatReturnId), eq(tables.vatReturns.companyId, opts.companyId)))
    .get();
  if (!ret) throw new AccountingError("VAT return not found", "NOT_FOUND");
  if (ret.status === "FINALISED") throw new AccountingError("Already finalised", "FINALISED");

  // Recompute at the moment of finalisation so the stored boxes are guaranteed current
  const calc = computeVatReturn(opts.companyId, new Date(ret.periodStart), new Date(ret.periodEnd));
  const netVat = calc.t1Cents - calc.t2Cents;

  const vatControl = systemAccount(opts.companyId, "VAT_CONTROL");
  const vatPayable = systemAccount(opts.companyId, "VAT_PAYABLE");

  return db.transaction(() => {
    let journalId: string | undefined;
    if (netVat !== 0) {
      const result = postJournal({
        companyId: opts.companyId,
        date: new Date(ret.periodEnd),
        description: `VAT return ${fmtPeriod(new Date(ret.periodStart), new Date(ret.periodEnd))} — transfer to VAT payable`,
        sourceType: "VAT_RETURN",
        sourceId: ret.id,
        userId: opts.userId,
        allowLockedPeriod: true,
        lines:
          netVat > 0
            ? [
                { accountId: vatControl.id, debitCents: netVat, description: "Close VAT control for period" },
                { accountId: vatPayable.id, creditCents: netVat, description: "VAT payable to Revenue" },
              ]
            : [
                { accountId: vatPayable.id, debitCents: -netVat, description: "VAT repayable by Revenue" },
                { accountId: vatControl.id, creditCents: -netVat, description: "Close VAT control for period" },
              ],
      });
      journalId = result.journalId;
    }

    db.update(tables.vatReturns)
      .set({
        status: "FINALISED",
        t1Cents: calc.t1Cents,
        t2Cents: calc.t2Cents,
        t3Cents: calc.t3Cents,
        t4Cents: calc.t4Cents,
        exceptions: JSON.stringify(calc.exceptions),
        journalId,
        finalisedById: opts.userId,
        finalisedAt: new Date(),
      })
      .where(eq(tables.vatReturns.id, ret.id))
      .run();

    // Lock the period
    db.insert(tables.periodLocks)
      .values({
        companyId: opts.companyId,
        lockedThrough: new Date(ret.periodEnd),
        reason: `VAT return finalised for ${fmtPeriod(new Date(ret.periodStart), new Date(ret.periodEnd))}`,
        createdById: opts.userId,
      })
      .run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "vatreturn.finalised",
      entityType: "vat_return", entityId: ret.id,
      after: { t1: calc.t1Cents, t2: calc.t2Cents, t3: calc.t3Cents, t4: calc.t4Cents, journalId },
    });

    return { journalId, ...calc };
  });
}

export function fmtPeriod(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", year: "numeric", timeZone: "UTC" };
  const s = start.toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" });
  const e = end.toLocaleDateString("en-IE", opts);
  return `${s}–${e}`;
}
