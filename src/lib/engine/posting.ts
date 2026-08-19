// Document posting — turns business documents (invoices, bills, expenses, bank
// categorisations, transfers) into balanced journals via postJournal.
// The journal is the single source of truth; document tables carry workflow state.

import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { AccountingError, postJournal, reverseJournal, systemAccount, JournalLineInput } from "./journal";
import { writeAudit } from "@/lib/audit";
import { sumCents } from "@/lib/money";

// ───────────────────────── Invoices (sales) ─────────────────────────

/** Approve + post an invoice or credit note. DR debtors / CR income / CR VAT (mirrored for credit notes). */
export function approveInvoice(opts: { companyId: string; invoiceId: string; userId?: string }) {
  const invoice = db
    .select()
    .from(tables.invoices)
    .where(and(eq(tables.invoices.id, opts.invoiceId), eq(tables.invoices.companyId, opts.companyId)))
    .get();
  if (!invoice) throw new AccountingError("Invoice not found", "NOT_FOUND");
  if (invoice.status !== "DRAFT" && invoice.status !== "AWAITING_APPROVAL") {
    throw new AccountingError(`Invoice is ${invoice.status}, cannot approve`, "BAD_STATUS");
  }
  const lines = db.select().from(tables.invoiceLines).where(eq(tables.invoiceLines.invoiceId, invoice.id)).all();
  if (lines.length === 0) throw new AccountingError("Invoice has no lines", "NO_LINES");

  // Integrity: header totals must equal line sums
  const net = sumCents(lines.map((l) => l.netCents));
  const vat = sumCents(lines.map((l) => l.vatCents));
  if (net !== invoice.subtotalCents || vat !== invoice.vatCents || net + vat !== invoice.totalCents) {
    throw new AccountingError("Invoice totals do not match line totals", "TOTALS_MISMATCH");
  }

  const ar = systemAccount(opts.companyId, "ACCOUNTS_RECEIVABLE");
  const vatControl = systemAccount(opts.companyId, "VAT_CONTROL");
  const isCredit = invoice.kind === "CREDIT_NOTE";

  const journalLines: JournalLineInput[] = [];
  // Debtors control
  journalLines.push({
    accountId: ar.id,
    ...(isCredit ? { creditCents: invoice.totalCents } : { debitCents: invoice.totalCents }),
    description: `${isCredit ? "Credit note" : "Invoice"} ${invoice.number}`,
    contactId: invoice.contactId,
  });
  // Income per line (keeps account-level analysis + VAT rate on the line)
  for (const l of lines) {
    if (l.netCents !== 0) {
      journalLines.push({
        accountId: l.accountId,
        ...(isCredit ? { debitCents: l.netCents } : { creditCents: l.netCents }),
        description: l.description,
        contactId: invoice.contactId,
        vatRateId: l.vatRateId,
      });
    }
  }
  if (vat !== 0) {
    journalLines.push({
      accountId: vatControl.id,
      ...(isCredit ? { debitCents: vat } : { creditCents: vat }),
      description: `VAT on ${invoice.number}`,
      contactId: invoice.contactId,
    });
  }

  return db.transaction(() => {
    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: new Date(invoice.date),
      description: `${isCredit ? "Credit note" : "Invoice"} ${invoice.number} — ${contactName(invoice.contactId)}`,
      sourceType: isCredit ? "CREDIT_NOTE" : "INVOICE",
      sourceId: invoice.id,
      userId: opts.userId,
      lines: journalLines,
    });
    db.update(tables.invoices)
      .set({ status: "APPROVED", journalId, updatedAt: new Date() })
      .where(eq(tables.invoices.id, invoice.id))
      .run();
    writeAudit({
      companyId: opts.companyId,
      userId: opts.userId,
      action: "invoice.approved",
      entityType: "invoice",
      entityId: invoice.id,
      after: { number: invoice.number, totalCents: invoice.totalCents, journalId },
    });
    return { journalId };
  });
}

/** Void an approved invoice by reversing its journal. */
export function voidInvoice(opts: { companyId: string; invoiceId: string; userId?: string; reason?: string }) {
  const invoice = db
    .select()
    .from(tables.invoices)
    .where(and(eq(tables.invoices.id, opts.invoiceId), eq(tables.invoices.companyId, opts.companyId)))
    .get();
  if (!invoice) throw new AccountingError("Invoice not found", "NOT_FOUND");
  if (invoice.paidCents > 0) throw new AccountingError("Cannot void an invoice with payments applied — remove payments first", "HAS_PAYMENTS");

  return db.transaction(() => {
    let voidJournalId: string | undefined;
    if (invoice.journalId) {
      const r = reverseJournal({
        companyId: opts.companyId,
        journalId: invoice.journalId,
        userId: opts.userId,
        reason: opts.reason ?? `Void ${invoice.number}`,
      });
      voidJournalId = r.journalId;
    }
    db.update(tables.invoices)
      .set({ status: "VOID", voidJournalId, updatedAt: new Date() })
      .where(eq(tables.invoices.id, invoice.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "invoice.voided",
      entityType: "invoice", entityId: invoice.id, note: opts.reason,
    });
    return { voidJournalId };
  });
}

// ───────────────────────── Bills (purchases) ─────────────────────────

/** Approve + post a bill or supplier credit. DR expense + DR VAT input / CR creditors. */
export function approveBill(opts: { companyId: string; billId: string; userId?: string }) {
  const bill = db
    .select()
    .from(tables.bills)
    .where(and(eq(tables.bills.id, opts.billId), eq(tables.bills.companyId, opts.companyId)))
    .get();
  if (!bill) throw new AccountingError("Bill not found", "NOT_FOUND");
  if (bill.status !== "DRAFT" && bill.status !== "AWAITING_APPROVAL") {
    throw new AccountingError(`Bill is ${bill.status}, cannot approve`, "BAD_STATUS");
  }
  const lines = db.select().from(tables.billLines).where(eq(tables.billLines.billId, bill.id)).all();
  if (lines.length === 0) throw new AccountingError("Bill has no lines", "NO_LINES");

  const net = sumCents(lines.map((l) => l.netCents));
  const vat = sumCents(lines.map((l) => l.vatCents));
  if (net !== bill.subtotalCents || vat !== bill.vatCents || net + vat !== bill.totalCents) {
    throw new AccountingError("Bill totals do not match line totals", "TOTALS_MISMATCH");
  }

  const ap = systemAccount(opts.companyId, "ACCOUNTS_PAYABLE");
  const vatControl = systemAccount(opts.companyId, "VAT_CONTROL");
  const isCredit = bill.kind === "SUPPLIER_CREDIT";

  const journalLines: JournalLineInput[] = [];
  journalLines.push({
    accountId: ap.id,
    ...(isCredit ? { debitCents: bill.totalCents } : { creditCents: bill.totalCents }),
    description: `${isCredit ? "Supplier credit" : "Bill"} ${bill.number}`,
    contactId: bill.contactId,
  });
  for (const l of lines) {
    if (l.netCents !== 0) {
      journalLines.push({
        accountId: l.accountId,
        ...(isCredit ? { creditCents: l.netCents } : { debitCents: l.netCents }),
        description: l.description,
        contactId: bill.contactId,
        vatRateId: l.vatRateId,
      });
    }
  }
  if (vat !== 0) {
    journalLines.push({
      accountId: vatControl.id,
      ...(isCredit ? { creditCents: vat } : { debitCents: vat }),
      description: `VAT on ${bill.number}`,
      contactId: bill.contactId,
    });
  }

  return db.transaction(() => {
    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: new Date(bill.date),
      description: `${isCredit ? "Supplier credit" : "Bill"} ${bill.number} — ${contactName(bill.contactId)}`,
      sourceType: isCredit ? "SUPPLIER_CREDIT" : "BILL",
      sourceId: bill.id,
      userId: opts.userId,
      lines: journalLines,
    });
    db.update(tables.bills)
      .set({ status: "APPROVED", journalId, updatedAt: new Date() })
      .where(eq(tables.bills.id, bill.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bill.approved",
      entityType: "bill", entityId: bill.id,
      after: { number: bill.number, totalCents: bill.totalCents, journalId },
    });
    return { journalId };
  });
}

export function voidBill(opts: { companyId: string; billId: string; userId?: string; reason?: string }) {
  const bill = db
    .select()
    .from(tables.bills)
    .where(and(eq(tables.bills.id, opts.billId), eq(tables.bills.companyId, opts.companyId)))
    .get();
  if (!bill) throw new AccountingError("Bill not found", "NOT_FOUND");
  if (bill.paidCents > 0) throw new AccountingError("Cannot void a bill with payments applied", "HAS_PAYMENTS");

  return db.transaction(() => {
    let voidJournalId: string | undefined;
    if (bill.journalId) {
      const r = reverseJournal({
        companyId: opts.companyId, journalId: bill.journalId, userId: opts.userId,
        reason: opts.reason ?? `Void ${bill.number}`,
      });
      voidJournalId = r.journalId;
    }
    db.update(tables.bills)
      .set({ status: "VOID", voidJournalId, updatedAt: new Date() })
      .where(eq(tables.bills.id, bill.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bill.voided",
      entityType: "bill", entityId: bill.id, note: opts.reason,
    });
    return { voidJournalId };
  });
}

// ───────────────────────── Payments ─────────────────────────

/**
 * Record a payment received (against invoices) or made (against bills).
 * RECEIVE: DR bank / CR debtors.  SPEND: DR creditors / CR bank.
 * Allocations update the documents' paid amounts and status.
 */
export function createPayment(opts: {
  companyId: string;
  direction: "RECEIVE" | "SPEND";
  bankAccountId: string;
  contactId?: string;
  date: Date;
  amountCents: number;
  reference?: string;
  allocations: Array<{ invoiceId?: string; billId?: string; amountCents: number }>;
  userId?: string;
}): { paymentId: string; journalId: string } {
  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) {
    throw new AccountingError("Payment amount must be a positive integer (cents)", "INVALID_AMOUNT");
  }
  const allocated = sumCents(opts.allocations.map((a) => a.amountCents));
  if (allocated !== opts.amountCents) {
    throw new AccountingError(
      `Allocations (${allocated}) must equal the payment amount (${opts.amountCents})`,
      "ALLOCATION_MISMATCH"
    );
  }

  const bankAccount = db
    .select()
    .from(tables.bankAccounts)
    .where(and(eq(tables.bankAccounts.id, opts.bankAccountId), eq(tables.bankAccounts.companyId, opts.companyId)))
    .get();
  if (!bankAccount) throw new AccountingError("Bank account not found", "NOT_FOUND");

  return db.transaction(() => {
    // Validate + apply allocations
    for (const alloc of opts.allocations) {
      if (alloc.amountCents <= 0) throw new AccountingError("Allocation must be positive", "INVALID_AMOUNT");
      if (opts.direction === "RECEIVE") {
        if (!alloc.invoiceId) throw new AccountingError("RECEIVE allocations must reference invoices", "BAD_ALLOCATION");
        const inv = db
          .select()
          .from(tables.invoices)
          .where(and(eq(tables.invoices.id, alloc.invoiceId), eq(tables.invoices.companyId, opts.companyId)))
          .get();
        if (!inv) throw new AccountingError("Allocated invoice not found", "NOT_FOUND");
        if (inv.status !== "APPROVED" && inv.status !== "SENT") {
          throw new AccountingError(`Invoice ${inv.number} is ${inv.status} — cannot take payment`, "BAD_STATUS");
        }
        const remaining = inv.totalCents - inv.paidCents;
        if (alloc.amountCents > remaining) {
          throw new AccountingError(
            `Allocation exceeds amount due on ${inv.number} (due ${remaining}, allocating ${alloc.amountCents})`,
            "OVER_ALLOCATION"
          );
        }
        const newPaid = inv.paidCents + alloc.amountCents;
        db.update(tables.invoices)
          .set({ paidCents: newPaid, status: newPaid === inv.totalCents ? "PAID" : inv.status, updatedAt: new Date() })
          .where(eq(tables.invoices.id, inv.id))
          .run();
      } else {
        if (!alloc.billId) throw new AccountingError("SPEND allocations must reference bills", "BAD_ALLOCATION");
        const bill = db
          .select()
          .from(tables.bills)
          .where(and(eq(tables.bills.id, alloc.billId), eq(tables.bills.companyId, opts.companyId)))
          .get();
        if (!bill) throw new AccountingError("Allocated bill not found", "NOT_FOUND");
        if (bill.status !== "APPROVED") {
          throw new AccountingError(`Bill ${bill.number} is ${bill.status} — cannot pay`, "BAD_STATUS");
        }
        const remaining = bill.totalCents - bill.paidCents;
        if (alloc.amountCents > remaining) {
          throw new AccountingError(`Allocation exceeds amount due on ${bill.number}`, "OVER_ALLOCATION");
        }
        const newPaid = bill.paidCents + alloc.amountCents;
        db.update(tables.bills)
          .set({ paidCents: newPaid, status: newPaid === bill.totalCents ? "PAID" : bill.status, updatedAt: new Date() })
          .where(eq(tables.bills.id, bill.id))
          .run();
      }
    }

    const controlKey = opts.direction === "RECEIVE" ? "ACCOUNTS_RECEIVABLE" : "ACCOUNTS_PAYABLE";
    const control = systemAccount(opts.companyId, controlKey);

    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: opts.date,
      description:
        opts.direction === "RECEIVE"
          ? `Payment received${opts.contactId ? ` — ${contactName(opts.contactId)}` : ""}`
          : `Payment made${opts.contactId ? ` — ${contactName(opts.contactId)}` : ""}`,
      sourceType: "PAYMENT",
      userId: opts.userId,
      lines:
        opts.direction === "RECEIVE"
          ? [
              { accountId: bankAccount.accountId, debitCents: opts.amountCents, description: opts.reference, contactId: opts.contactId },
              { accountId: control.id, creditCents: opts.amountCents, description: opts.reference, contactId: opts.contactId },
            ]
          : [
              { accountId: control.id, debitCents: opts.amountCents, description: opts.reference, contactId: opts.contactId },
              { accountId: bankAccount.accountId, creditCents: opts.amountCents, description: opts.reference, contactId: opts.contactId },
            ],
    });

    const payment = db
      .insert(tables.payments)
      .values({
        companyId: opts.companyId,
        contactId: opts.contactId,
        direction: opts.direction,
        date: opts.date,
        amountCents: opts.amountCents,
        reference: opts.reference,
        bankAccountId: opts.bankAccountId,
        journalId,
        status: "POSTED",
      })
      .returning({ id: tables.payments.id })
      .get();

    for (const alloc of opts.allocations) {
      db.insert(tables.paymentAllocations)
        .values({ paymentId: payment.id, invoiceId: alloc.invoiceId, billId: alloc.billId, amountCents: alloc.amountCents })
        .run();
    }

    // link journal to payment source
    db.update(tables.journals).set({ sourceId: payment.id }).where(eq(tables.journals.id, journalId)).run();

    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "payment.created",
      entityType: "payment", entityId: payment.id,
      after: { direction: opts.direction, amountCents: opts.amountCents, allocations: opts.allocations },
    });

    return { paymentId: payment.id, journalId };
  });
}

// ───────────────────────── Expenses ─────────────────────────

/** Approve + post an expense. DR expense + DR VAT / CR bank (or directors' loan when paid personally). */
export function approveExpense(opts: { companyId: string; expenseId: string; userId?: string }) {
  const exp = db
    .select()
    .from(tables.expenses)
    .where(and(eq(tables.expenses.id, opts.expenseId), eq(tables.expenses.companyId, opts.companyId)))
    .get();
  if (!exp) throw new AccountingError("Expense not found", "NOT_FOUND");
  if (exp.status !== "DRAFT") throw new AccountingError(`Expense is ${exp.status}`, "BAD_STATUS");
  if (exp.netCents + exp.vatCents !== exp.grossCents) {
    throw new AccountingError("Expense net + VAT must equal gross", "TOTALS_MISMATCH");
  }

  const vatControl = systemAccount(opts.companyId, "VAT_CONTROL");

  let creditAccountId: string;
  if (exp.paidVia === "PERSONAL") {
    creditAccountId = systemAccount(opts.companyId, "DIRECTORS_LOAN").id;
  } else {
    if (!exp.bankAccountId) throw new AccountingError("Bank-paid expense needs a bank account", "MISSING_BANK");
    const bank = db
      .select()
      .from(tables.bankAccounts)
      .where(and(eq(tables.bankAccounts.id, exp.bankAccountId), eq(tables.bankAccounts.companyId, opts.companyId)))
      .get();
    if (!bank) throw new AccountingError("Bank account not found", "NOT_FOUND");
    creditAccountId = bank.accountId;
  }

  const lines: JournalLineInput[] = [
    { accountId: exp.accountId, debitCents: exp.netCents, description: exp.description ?? exp.merchant, contactId: exp.contactId ?? undefined, vatRateId: exp.vatRateId },
  ];
  if (exp.vatCents > 0) {
    lines.push({ accountId: vatControl.id, debitCents: exp.vatCents, description: `VAT — ${exp.merchant}`, contactId: exp.contactId ?? undefined, vatRateId: undefined as unknown as string });
  }
  lines.push({ accountId: creditAccountId, creditCents: exp.grossCents, description: exp.merchant, contactId: exp.contactId ?? undefined } as never);

  return db.transaction(() => {
    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: new Date(exp.date),
      description: `Expense — ${exp.merchant}`,
      sourceType: "EXPENSE",
      sourceId: exp.id,
      userId: opts.userId,
      lines,
    });
    db.update(tables.expenses)
      .set({ status: "APPROVED", journalId, updatedAt: new Date() })
      .where(eq(tables.expenses.id, exp.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "expense.approved",
      entityType: "expense", entityId: exp.id,
      after: { merchant: exp.merchant, grossCents: exp.grossCents, journalId },
    });
    return { journalId };
  });
}

// ───────────────────────── Bank categorisation & transfers ─────────────────────────

/**
 * Explain a bank transaction directly to a nominal account ("spend money"/"receive money").
 * OUT: DR expense + DR VAT / CR bank.  IN: DR bank / CR income + CR VAT.
 */
export function categoriseBankTransaction(opts: {
  companyId: string;
  bankTransactionId: string;
  accountId: string;
  vatRateId?: string;
  vatCents?: number;
  contactId?: string;
  description?: string;
  userId?: string;
}): { journalId: string } {
  const txn = getCompanyBankTxn(opts.companyId, opts.bankTransactionId);
  if (txn.status !== "UNRECONCILED") throw new AccountingError(`Transaction is ${txn.status}`, "BAD_STATUS");

  const bankAccount = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.id, txn.bankAccountId)).get()!;
  const gross = Math.abs(txn.amountCents);
  const vat = opts.vatCents ?? 0;
  if (!Number.isInteger(vat) || vat < 0 || vat > gross) throw new AccountingError("Invalid VAT amount", "INVALID_AMOUNT");
  const net = gross - vat;
  const vatControl = vat > 0 ? systemAccount(opts.companyId, "VAT_CONTROL") : null;
  const isOut = txn.amountCents < 0;
  const desc = opts.description ?? txn.description;

  const lines: JournalLineInput[] = [];
  if (isOut) {
    lines.push({ accountId: opts.accountId, debitCents: net, description: desc, contactId: opts.contactId, vatRateId: opts.vatRateId });
    if (vatControl) lines.push({ accountId: vatControl.id, debitCents: vat, description: `VAT — ${desc}` });
    lines.push({ accountId: bankAccount.accountId, creditCents: gross, description: desc, contactId: opts.contactId });
  } else {
    lines.push({ accountId: bankAccount.accountId, debitCents: gross, description: desc, contactId: opts.contactId });
    lines.push({ accountId: opts.accountId, creditCents: net, description: desc, contactId: opts.contactId, vatRateId: opts.vatRateId });
    if (vatControl) lines.push({ accountId: vatControl.id, creditCents: vat, description: `VAT — ${desc}` });
  }

  return db.transaction(() => {
    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: new Date(txn.date),
      description: desc,
      sourceType: "BANK",
      sourceId: txn.id,
      userId: opts.userId,
      lines,
    });
    db.update(tables.bankTransactions)
      .set({ status: "MATCHED", matchType: "DIRECT", journalId, contactId: opts.contactId })
      .where(eq(tables.bankTransactions.id, txn.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bank.categorised",
      entityType: "bank_transaction", entityId: txn.id,
      after: { accountId: opts.accountId, vatCents: vat, journalId },
    });
    return { journalId };
  });
}

/** Match a bank transaction to an existing payment's journal (no new posting — just linkage). */
export function matchBankTransactionToPayment(opts: {
  companyId: string;
  bankTransactionId: string;
  paymentId: string;
  userId?: string;
}) {
  const txn = getCompanyBankTxn(opts.companyId, opts.bankTransactionId);
  if (txn.status !== "UNRECONCILED") throw new AccountingError(`Transaction is ${txn.status}`, "BAD_STATUS");
  const payment = db
    .select()
    .from(tables.payments)
    .where(and(eq(tables.payments.id, opts.paymentId), eq(tables.payments.companyId, opts.companyId)))
    .get();
  if (!payment) throw new AccountingError("Payment not found", "NOT_FOUND");
  const expected = payment.direction === "RECEIVE" ? payment.amountCents : -payment.amountCents;
  if (expected !== txn.amountCents) {
    throw new AccountingError(
      `Amounts differ: bank ${txn.amountCents} vs payment ${expected}`,
      "AMOUNT_MISMATCH"
    );
  }
  db.update(tables.bankTransactions)
    .set({
      status: "MATCHED",
      matchType: payment.direction === "RECEIVE" ? "INVOICE_PAYMENT" : "BILL_PAYMENT",
      paymentId: payment.id,
      journalId: payment.journalId,
      contactId: payment.contactId,
    })
    .where(eq(tables.bankTransactions.id, txn.id))
    .run();
  writeAudit({
    companyId: opts.companyId, userId: opts.userId, action: "bank.matched",
    entityType: "bank_transaction", entityId: txn.id, after: { paymentId: payment.id },
  });
}

/**
 * Record an invoice/bill payment directly from a bank transaction (creates the payment and matches it in one step).
 */
export function matchBankTransactionToDocuments(opts: {
  companyId: string;
  bankTransactionId: string;
  allocations: Array<{ invoiceId?: string; billId?: string; amountCents: number }>;
  contactId?: string;
  userId?: string;
}) {
  const txn = getCompanyBankTxn(opts.companyId, opts.bankTransactionId);
  if (txn.status !== "UNRECONCILED") throw new AccountingError(`Transaction is ${txn.status}`, "BAD_STATUS");
  const direction = txn.amountCents > 0 ? "RECEIVE" : "SPEND";

  return db.transaction(() => {
    const { paymentId, journalId } = createPayment({
      companyId: opts.companyId,
      direction,
      bankAccountId: txn.bankAccountId,
      contactId: opts.contactId,
      date: new Date(txn.date),
      amountCents: Math.abs(txn.amountCents),
      reference: txn.description,
      allocations: opts.allocations,
      userId: opts.userId,
    });
    db.update(tables.bankTransactions)
      .set({
        status: "MATCHED",
        matchType: direction === "RECEIVE" ? "INVOICE_PAYMENT" : "BILL_PAYMENT",
        paymentId,
        journalId,
        contactId: opts.contactId,
      })
      .where(eq(tables.bankTransactions.id, txn.id))
      .run();
    return { paymentId, journalId };
  });
}

/** Match two bank transactions as an internal transfer. DR destination bank / CR source bank. */
export function matchTransfer(opts: {
  companyId: string;
  outTransactionId: string;
  inTransactionId: string;
  userId?: string;
}): { journalId: string } {
  const out = getCompanyBankTxn(opts.companyId, opts.outTransactionId);
  const inn = getCompanyBankTxn(opts.companyId, opts.inTransactionId);
  if (out.amountCents >= 0) throw new AccountingError("Source transaction must be money out", "BAD_DIRECTION");
  if (inn.amountCents <= 0) throw new AccountingError("Destination transaction must be money in", "BAD_DIRECTION");
  if (Math.abs(out.amountCents) !== inn.amountCents) {
    throw new AccountingError("Transfer amounts do not match", "AMOUNT_MISMATCH");
  }
  if (out.bankAccountId === inn.bankAccountId) throw new AccountingError("Transfer must span two accounts", "SAME_ACCOUNT");
  if (out.status !== "UNRECONCILED" || inn.status !== "UNRECONCILED") {
    throw new AccountingError("Both transactions must be unreconciled", "BAD_STATUS");
  }

  const outBank = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.id, out.bankAccountId)).get()!;
  const inBank = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.id, inn.bankAccountId)).get()!;

  return db.transaction(() => {
    const { journalId } = postJournal({
      companyId: opts.companyId,
      date: new Date(out.date),
      description: `Transfer ${outBank.name} → ${inBank.name}`,
      sourceType: "TRANSFER",
      sourceId: out.id,
      userId: opts.userId,
      lines: [
        { accountId: inBank.accountId, debitCents: inn.amountCents, description: "Transfer in" },
        { accountId: outBank.accountId, creditCents: Math.abs(out.amountCents), description: "Transfer out" },
      ],
    });
    db.update(tables.bankTransactions)
      .set({ status: "MATCHED", matchType: "TRANSFER", journalId, transferPairId: inn.id })
      .where(eq(tables.bankTransactions.id, out.id))
      .run();
    db.update(tables.bankTransactions)
      .set({ status: "MATCHED", matchType: "TRANSFER", journalId, transferPairId: out.id })
      .where(eq(tables.bankTransactions.id, inn.id))
      .run();
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bank.transfer_matched",
      entityType: "bank_transaction", entityId: out.id, after: { pairedWith: inn.id, journalId },
    });
    return { journalId };
  });
}

/** Undo a bank match: reverse the journal (if the match created one) and reset the transaction. */
export function unmatchBankTransaction(opts: { companyId: string; bankTransactionId: string; userId?: string }) {
  const txn = getCompanyBankTxn(opts.companyId, opts.bankTransactionId);
  if (txn.status !== "MATCHED") throw new AccountingError("Only matched (not yet reconciled) transactions can be unmatched", "BAD_STATUS");

  return db.transaction(() => {
    if (txn.matchType === "DIRECT" && txn.journalId) {
      reverseJournal({ companyId: opts.companyId, journalId: txn.journalId, userId: opts.userId, reason: "Bank match undone" });
    }
    // For payment/transfer matches we keep the payment journal (it exists independently); just unlink.
    db.update(tables.bankTransactions)
      .set({ status: "UNRECONCILED", matchType: null, paymentId: null, journalId: null, transferPairId: null })
      .where(eq(tables.bankTransactions.id, txn.id))
      .run();
    if (txn.transferPairId) {
      db.update(tables.bankTransactions)
        .set({ status: "UNRECONCILED", matchType: null, journalId: null, transferPairId: null })
        .where(eq(tables.bankTransactions.id, txn.transferPairId))
        .run();
    }
    writeAudit({
      companyId: opts.companyId, userId: opts.userId, action: "bank.unmatched",
      entityType: "bank_transaction", entityId: txn.id,
    });
  });
}

// ───────────────────────── helpers ─────────────────────────

function getCompanyBankTxn(companyId: string, txnId: string) {
  const row = db
    .select({ txn: tables.bankTransactions })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(and(eq(tables.bankTransactions.id, txnId), eq(tables.bankAccounts.companyId, companyId)))
    .get();
  if (!row) throw new AccountingError("Bank transaction not found", "NOT_FOUND");
  return row.txn;
}

function contactName(contactId: string): string {
  const c = db.select({ name: tables.contacts.name }).from(tables.contacts).where(eq(tables.contacts.id, contactId)).get();
  return c?.name ?? "Unknown";
}
