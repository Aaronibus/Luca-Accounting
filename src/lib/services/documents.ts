// Draft document creation (invoices, bills, expenses) with VAT line maths.
// Drafts have no ledger effect — approval posts them via the engine.

import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { AccountingError, nextSequence } from "@/lib/engine/journal";
import { vatOnNet } from "@/lib/money";
import { writeAudit } from "@/lib/audit";

export interface DocLineInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  accountId: string;
  vatRateId: string;
}

function computeLines(companyId: string, lines: DocLineInput[]) {
  if (lines.length === 0) throw new AccountingError("At least one line is required", "NO_LINES");
  const rates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, companyId)).all();
  const rateMap = new Map(rates.map((r) => [r.id, r]));
  const computed = lines.map((l, i) => {
    const rate = rateMap.get(l.vatRateId);
    if (!rate) throw new AccountingError(`Unknown VAT rate on line ${i + 1}`, "BAD_VAT_RATE");
    if (!Number.isFinite(l.quantity) || l.quantity <= 0) throw new AccountingError(`Invalid quantity on line ${i + 1}`, "INVALID_AMOUNT");
    if (!Number.isInteger(l.unitPriceCents)) throw new AccountingError(`Invalid unit price on line ${i + 1}`, "INVALID_AMOUNT");
    const netCents = Math.round(l.quantity * l.unitPriceCents);
    const vatCents = rate.category === "EXEMPT" || rate.category === "OUTSIDE_SCOPE" ? 0 : vatOnNet(netCents, rate.rateBps);
    return { ...l, netCents, vatCents, sortOrder: i };
  });
  const subtotalCents = computed.reduce((a, l) => a + l.netCents, 0);
  const vatCents = computed.reduce((a, l) => a + l.vatCents, 0);
  return { computed, subtotalCents, vatCents, totalCents: subtotalCents + vatCents };
}

export function createInvoice(opts: {
  companyId: string;
  contactId: string;
  kind?: "INVOICE" | "CREDIT_NOTE";
  date: Date;
  dueDate?: Date;
  reference?: string;
  notes?: string;
  lines: DocLineInput[];
  userId?: string;
}) {
  const contact = db
    .select()
    .from(tables.contacts)
    .where(and(eq(tables.contacts.id, opts.contactId), eq(tables.contacts.companyId, opts.companyId)))
    .get();
  if (!contact) throw new AccountingError("Customer not found", "NOT_FOUND");

  const { computed, subtotalCents, vatCents, totalCents } = computeLines(opts.companyId, opts.lines);
  const kind = opts.kind ?? "INVOICE";
  const dueDate = opts.dueDate ?? new Date(opts.date.getTime() + contact.paymentTermsDays * 86_400_000);

  return db.transaction(() => {
    const { formatted: number } = nextSequence(opts.companyId, kind === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE");
    const invoice = db
      .insert(tables.invoices)
      .values({
        companyId: opts.companyId,
        contactId: opts.contactId,
        kind,
        number,
        reference: opts.reference,
        date: opts.date,
        dueDate,
        status: "DRAFT",
        subtotalCents,
        vatCents,
        totalCents,
        notes: opts.notes,
        createdById: opts.userId,
      })
      .returning({ id: tables.invoices.id })
      .get();

    db.insert(tables.invoiceLines)
      .values(computed.map((l) => ({ invoiceId: invoice.id, ...pickLine(l) })))
      .run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "invoice.created",
      entityType: "invoice", entityId: invoice.id, after: { number, totalCents },
    });
    return { invoiceId: invoice.id, number, totalCents };
  });
}

export function createBill(opts: {
  companyId: string;
  contactId: string;
  kind?: "BILL" | "SUPPLIER_CREDIT";
  date: Date;
  dueDate?: Date;
  supplierRef?: string;
  notes?: string;
  origin?: "MANUAL" | "DOCUMENT_EXTRACTION";
  lines: DocLineInput[];
  userId?: string;
}) {
  const contact = db
    .select()
    .from(tables.contacts)
    .where(and(eq(tables.contacts.id, opts.contactId), eq(tables.contacts.companyId, opts.companyId)))
    .get();
  if (!contact) throw new AccountingError("Supplier not found", "NOT_FOUND");

  const { computed, subtotalCents, vatCents, totalCents } = computeLines(opts.companyId, opts.lines);
  const kind = opts.kind ?? "BILL";
  const dueDate = opts.dueDate ?? new Date(opts.date.getTime() + contact.paymentTermsDays * 86_400_000);

  return db.transaction(() => {
    const { formatted: number } = nextSequence(opts.companyId, "BILL");
    const bill = db
      .insert(tables.bills)
      .values({
        companyId: opts.companyId,
        contactId: opts.contactId,
        kind,
        number,
        supplierRef: opts.supplierRef,
        date: opts.date,
        dueDate,
        status: "DRAFT",
        subtotalCents,
        vatCents,
        totalCents,
        notes: opts.notes,
        origin: opts.origin ?? "MANUAL",
        createdById: opts.userId,
      })
      .returning({ id: tables.bills.id })
      .get();

    db.insert(tables.billLines)
      .values(computed.map((l) => ({ billId: bill.id, ...pickLine(l) })))
      .run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bill.created",
      entityType: "bill", entityId: bill.id, after: { number, totalCents, origin: opts.origin ?? "MANUAL" },
    });
    return { billId: bill.id, number, totalCents };
  });
}

export function createExpense(opts: {
  companyId: string;
  merchant: string;
  description?: string;
  date: Date;
  accountId: string;
  vatRateId: string;
  grossCents: number;
  vatCents?: number; // if omitted, derived from the rate (VAT-inclusive gross)
  paidVia?: "BANK" | "PERSONAL" | "CASH";
  bankAccountId?: string;
  contactId?: string;
  origin?: "MANUAL" | "RECEIPT_SCAN";
  userId?: string;
}) {
  const rate = db
    .select()
    .from(tables.vatRates)
    .where(and(eq(tables.vatRates.id, opts.vatRateId), eq(tables.vatRates.companyId, opts.companyId)))
    .get();
  if (!rate) throw new AccountingError("Unknown VAT rate", "BAD_VAT_RATE");
  if (!Number.isInteger(opts.grossCents) || opts.grossCents <= 0) {
    throw new AccountingError("Gross amount must be a positive integer (cents)", "INVALID_AMOUNT");
  }

  let vatCents: number;
  if (opts.vatCents !== undefined) {
    if (!Number.isInteger(opts.vatCents) || opts.vatCents < 0 || opts.vatCents > opts.grossCents) {
      throw new AccountingError("Invalid VAT amount", "INVALID_AMOUNT");
    }
    vatCents = opts.vatCents;
  } else if (rate.category === "EXEMPT" || rate.category === "OUTSIDE_SCOPE" || rate.rateBps === 0) {
    vatCents = 0;
  } else {
    const rawNet = (opts.grossCents * 10000) / (10000 + rate.rateBps);
    const netCents = Math.round(rawNet);
    vatCents = opts.grossCents - netCents;
  }
  const netCents = opts.grossCents - vatCents;

  return db.transaction(() => {
    const expense = db
      .insert(tables.expenses)
      .values({
        companyId: opts.companyId,
        contactId: opts.contactId,
        merchant: opts.merchant,
        description: opts.description,
        date: opts.date,
        accountId: opts.accountId,
        vatRateId: opts.vatRateId,
        netCents,
        vatCents,
        grossCents: opts.grossCents,
        paidVia: opts.paidVia ?? "BANK",
        bankAccountId: opts.bankAccountId,
        status: "DRAFT",
        origin: opts.origin ?? "MANUAL",
        submittedById: opts.userId,
      })
      .returning({ id: tables.expenses.id })
      .get();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "expense.created",
      entityType: "expense", entityId: expense.id,
      after: { merchant: opts.merchant, grossCents: opts.grossCents },
    });
    return { expenseId: expense.id, netCents, vatCents };
  });
}

function pickLine(l: DocLineInput & { netCents: number; vatCents: number; sortOrder: number }) {
  return {
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    accountId: l.accountId,
    vatRateId: l.vatRateId,
    netCents: l.netCents,
    vatCents: l.vatCents,
    sortOrder: l.sortOrder,
  };
}
