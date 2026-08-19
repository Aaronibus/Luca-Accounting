"use server";

// Server actions — every mutation goes through requireCompany (tenancy + role)
// and the accounting engine (integrity). UI never touches the database directly.

import { revalidatePath } from "next/cache";
import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { requireCompany, AuthError } from "@/lib/auth";
import { AccountingError, postJournal } from "@/lib/engine/journal";
import { approveInvoice, voidInvoice, approveBill, voidBill, approveExpense, categoriseBankTransaction, unmatchBankTransaction, matchBankTransactionToDocuments } from "@/lib/engine/posting";
import { createInvoice, createBill, createExpense, DocLineInput } from "@/lib/services/documents";
import { importBankTransactions, parseBankCSV, reconcileTransactions } from "@/lib/services/banking";
import { prepareVatReturn, finaliseVatReturn } from "@/lib/engine/vat";
import { generateBankSuggestions } from "@/lib/ai/categorise";
import { acceptSuggestion, rejectSuggestion, acceptAllConfident } from "@/lib/ai/suggestions";
import { extractInvoice, extractPdfText, resolveSupplier } from "@/lib/ai/extract";
import { parseEUR } from "@/lib/money";
import { writeAudit } from "@/lib/audit";

export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

function handle(e: unknown): ActionResult {
  if (e instanceof AccountingError || e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong — nothing was changed" };
}

// ── AI suggestions ──────────────────────────────────────────────────────

export async function acceptSuggestionAction(suggestionId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    acceptSuggestion({ companyId: ctx.companyId, suggestionId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Applied and posted — see the audit trail for details" };
  } catch (e) {
    return handle(e);
  }
}

export async function rejectSuggestionAction(suggestionId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    rejectSuggestion({ companyId: ctx.companyId, suggestionId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return handle(e);
  }
}

export async function generateSuggestionsAction(): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("ai");
    const { created } = generateBankSuggestions(ctx.companyId);
    revalidatePath("/", "layout");
    return { ok: true, message: created ? `${created} new suggestion${created === 1 ? "" : "s"} ready for review` : "Nothing new to suggest" };
  } catch (e) {
    return handle(e);
  }
}

export async function bulkReconcileAction(): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("reconcile");
    generateBankSuggestions(ctx.companyId);
    const result = acceptAllConfident({ companyId: ctx.companyId, userId: ctx.user.id, threshold: 92 });
    revalidatePath("/", "layout");
    return { ok: true, message: `Applied ${result.applied.length}, left ${result.skipped.length} for review` };
  } catch (e) {
    return handle(e);
  }
}

// ── documents (invoices / bills / expenses) ─────────────────────────────

export async function approveInvoiceAction(invoiceId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("approve");
    approveInvoice({ companyId: ctx.companyId, invoiceId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Invoice approved and posted" };
  } catch (e) {
    return handle(e);
  }
}

export async function voidInvoiceAction(invoiceId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    voidInvoice({ companyId: ctx.companyId, invoiceId, userId: ctx.user.id, reason });
    revalidatePath("/", "layout");
    return { ok: true, message: "Invoice voided via reversal journal" };
  } catch (e) {
    return handle(e);
  }
}

export async function approveBillAction(billId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("approve");
    approveBill({ companyId: ctx.companyId, billId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Bill approved and posted" };
  } catch (e) {
    return handle(e);
  }
}

export async function voidBillAction(billId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    voidBill({ companyId: ctx.companyId, billId, userId: ctx.user.id, reason });
    revalidatePath("/", "layout");
    return { ok: true, message: "Bill voided via reversal journal" };
  } catch (e) {
    return handle(e);
  }
}

export async function approveExpenseAction(expenseId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("approve");
    approveExpense({ companyId: ctx.companyId, expenseId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Expense approved and posted" };
  } catch (e) {
    return handle(e);
  }
}

interface DocFormLine {
  description: string;
  quantity: string;
  unitPrice: string;
  accountId: string;
  vatRateId: string;
}

function parseLines(lines: DocFormLine[]): DocLineInput[] {
  return lines
    .filter((l) => l.description.trim() && l.unitPrice.trim())
    .map((l) => ({
      description: l.description.trim(),
      quantity: parseFloat(l.quantity || "1"),
      unitPriceCents: parseEUR(l.unitPrice),
      accountId: l.accountId,
      vatRateId: l.vatRateId,
    }));
}

export async function createInvoiceAction(input: {
  contactId: string;
  date: string;
  kind?: "INVOICE" | "CREDIT_NOTE";
  reference?: string;
  lines: DocFormLine[];
  approve?: boolean;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const { invoiceId, number } = createInvoice({
      companyId: ctx.companyId,
      contactId: input.contactId,
      kind: input.kind,
      date: new Date(input.date),
      reference: input.reference,
      lines: parseLines(input.lines),
      userId: ctx.user.id,
    });
    if (input.approve && ctx.can("approve")) {
      approveInvoice({ companyId: ctx.companyId, invoiceId, userId: ctx.user.id });
    }
    revalidatePath("/", "layout");
    return { ok: true, id: invoiceId, message: `${input.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice"} ${number} ${input.approve ? "approved" : "saved as draft"}` };
  } catch (e) {
    return handle(e);
  }
}

export async function createBillAction(input: {
  contactId: string;
  date: string;
  supplierRef?: string;
  lines: DocFormLine[];
  approve?: boolean;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const { billId, number } = createBill({
      companyId: ctx.companyId,
      contactId: input.contactId,
      date: new Date(input.date),
      supplierRef: input.supplierRef,
      lines: parseLines(input.lines),
      userId: ctx.user.id,
    });
    if (input.approve && ctx.can("approve")) {
      approveBill({ companyId: ctx.companyId, billId, userId: ctx.user.id });
    }
    revalidatePath("/", "layout");
    return { ok: true, id: billId, message: `Bill ${number} ${input.approve ? "approved" : "saved as draft"}` };
  } catch (e) {
    return handle(e);
  }
}

export async function createExpenseAction(input: {
  merchant: string;
  description?: string;
  date: string;
  accountId: string;
  vatRateId: string;
  gross: string;
  paidVia: "BANK" | "PERSONAL";
  bankAccountId?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("submit_expense");
    const { expenseId } = createExpense({
      companyId: ctx.companyId,
      merchant: input.merchant,
      description: input.description,
      date: new Date(input.date),
      accountId: input.accountId,
      vatRateId: input.vatRateId,
      grossCents: parseEUR(input.gross),
      paidVia: input.paidVia,
      bankAccountId: input.bankAccountId,
      userId: ctx.user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true, id: expenseId, message: "Expense saved as draft" };
  } catch (e) {
    return handle(e);
  }
}

export async function recordPaymentAction(input: {
  direction: "RECEIVE" | "SPEND";
  invoiceId?: string;
  billId?: string;
  contactId?: string;
  bankAccountId: string;
  date: string;
  amount: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    const { createPayment } = await import("@/lib/engine/posting");
    const amountCents = parseEUR(input.amount);
    createPayment({
      companyId: ctx.companyId,
      direction: input.direction,
      bankAccountId: input.bankAccountId,
      contactId: input.contactId,
      date: new Date(input.date),
      amountCents,
      allocations: [{ invoiceId: input.invoiceId, billId: input.billId, amountCents }],
      userId: ctx.user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Payment recorded and posted" };
  } catch (e) {
    return handle(e);
  }
}

export async function createContactAction(input: { type: "CUSTOMER" | "SUPPLIER"; name: string; email?: string; county?: string; paymentTermsDays?: number }): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const row = db
      .insert(tables.contacts)
      .values({
        companyId: ctx.companyId,
        type: input.type,
        name: input.name.trim(),
        email: input.email?.trim() || undefined,
        county: input.county?.trim() || undefined,
        paymentTermsDays: input.paymentTermsDays ?? 30,
      })
      .returning({ id: tables.contacts.id })
      .get();
    writeAudit({ companyId: ctx.companyId, userId: ctx.user.id, action: "contact.created", entityType: "contact", entityId: row.id, after: input });
    revalidatePath("/", "layout");
    return { ok: true, id: row.id };
  } catch (e) {
    return handle(e);
  }
}

// ── banking ─────────────────────────────────────────────────────────────

export async function importBankCsvAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const bankAccountId = String(formData.get("bankAccountId") ?? "");
    const file = formData.get("file") as File | null;
    if (!file || !bankAccountId) return { ok: false, error: "Choose a CSV file first" };
    if (file.size > 5_000_000) return { ok: false, error: "File too large (max 5MB)" };
    const text = await file.text();
    const rows = parseBankCSV(text);
    const result = importBankTransactions({
      companyId: ctx.companyId,
      bankAccountId,
      rows,
      filename: file.name,
      userId: ctx.user.id,
    });
    generateBankSuggestions(ctx.companyId);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Imported ${result.imported} transaction${result.imported === 1 ? "" : "s"}${result.duplicates ? `, skipped ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"}` : ""} — AI suggestions are ready`,
    };
  } catch (e) {
    return handle(e);
  }
}

export async function categoriseTransactionAction(input: {
  bankTransactionId: string;
  accountId: string;
  vatRateId?: string;
  vat?: string;
  contactId?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    categoriseBankTransaction({
      companyId: ctx.companyId,
      bankTransactionId: input.bankTransactionId,
      accountId: input.accountId,
      vatRateId: input.vatRateId || undefined,
      vatCents: input.vat ? parseEUR(input.vat) : 0,
      contactId: input.contactId || undefined,
      userId: ctx.user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Transaction explained and posted" };
  } catch (e) {
    return handle(e);
  }
}

export async function unmatchTransactionAction(bankTransactionId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    unmatchBankTransaction({ companyId: ctx.companyId, bankTransactionId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Match undone — the posting was reversed" };
  } catch (e) {
    return handle(e);
  }
}

export async function reconcileMatchedAction(bankAccountId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("reconcile");
    const matched = db
      .select({ id: tables.bankTransactions.id })
      .from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.bankAccountId, bankAccountId), eq(tables.bankTransactions.status, "MATCHED")))
      .all();
    const { reconciled } = reconcileTransactions({ companyId: ctx.companyId, transactionIds: matched.map((m) => m.id), userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: `${reconciled} transaction${reconciled === 1 ? "" : "s"} reconciled` };
  } catch (e) {
    return handle(e);
  }
}

export async function createBankRuleAction(input: {
  name: string;
  matchText: string;
  direction: "IN" | "OUT" | "ANY";
  setAccountId: string;
  setVatRateId?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const row = db
      .insert(tables.bankRules)
      .values({
        companyId: ctx.companyId,
        name: input.name.trim(),
        matchText: input.matchText.trim(),
        direction: input.direction,
        setAccountId: input.setAccountId,
        setVatRateId: input.setVatRateId || undefined,
      })
      .returning({ id: tables.bankRules.id })
      .get();
    writeAudit({ companyId: ctx.companyId, userId: ctx.user.id, action: "bankrule.created", entityType: "bank_rule", entityId: row.id, after: input });
    revalidatePath("/", "layout");
    return { ok: true, message: "Rule created — it will drive future suggestions" };
  } catch (e) {
    return handle(e);
  }
}

// ── VAT ─────────────────────────────────────────────────────────────────

export async function prepareVatAction(periodStart: string, periodEnd: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("vat");
    prepareVatReturn({
      companyId: ctx.companyId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      userId: ctx.user.id,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Draft VAT return prepared from the VAT control account" };
  } catch (e) {
    return handle(e);
  }
}

export async function finaliseVatAction(vatReturnId: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("vat");
    finaliseVatReturn({ companyId: ctx.companyId, vatReturnId, userId: ctx.user.id });
    revalidatePath("/", "layout");
    return { ok: true, message: "Return finalised — VAT moved to payable and the period is locked" };
  } catch (e) {
    return handle(e);
  }
}

// ── manual journals ─────────────────────────────────────────────────────

export async function createJournalAction(input: {
  date: string;
  description: string;
  lines: Array<{ accountId: string; debit: string; credit: string; description?: string }>;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    const { journalNumber } = postJournal({
      companyId: ctx.companyId,
      date: new Date(input.date),
      description: input.description,
      sourceType: "MANUAL",
      userId: ctx.user.id,
      lines: input.lines
        .filter((l) => l.accountId && (l.debit.trim() || l.credit.trim()))
        .map((l) => ({
          accountId: l.accountId,
          debitCents: l.debit.trim() ? parseEUR(l.debit) : 0,
          creditCents: l.credit.trim() ? parseEUR(l.credit) : 0,
          description: l.description,
        })),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Journal #${journalNumber} posted` };
  } catch (e) {
    return handle(e);
  }
}

export async function reverseJournalAction(journalId: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    const { reverseJournal } = await import("@/lib/engine/journal");
    const r = reverseJournal({ companyId: ctx.companyId, journalId, userId: ctx.user.id, reason });
    revalidatePath("/", "layout");
    return { ok: true, message: `Reversal posted as journal #${r.journalNumber}` };
  } catch (e) {
    return handle(e);
  }
}

export async function setPeriodLockAction(lockedThrough: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("lock");
    db.insert(tables.periodLocks)
      .values({ companyId: ctx.companyId, lockedThrough: new Date(lockedThrough), reason: reason || "Manual lock", createdById: ctx.user.id })
      .run();
    writeAudit({ companyId: ctx.companyId, userId: ctx.user.id, action: "period.locked", entityType: "company", entityId: ctx.companyId, after: { lockedThrough, reason } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Period locked through ${lockedThrough}` };
  } catch (e) {
    return handle(e);
  }
}

// ── document upload + extraction ────────────────────────────────────────

export async function uploadDocumentAction(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const file = formData.get("file") as File | null;
    const docType = String(formData.get("docType") ?? "INVOICE");
    if (!file) return { ok: false, error: "Choose a file first" };
    if (file.size > 10_000_000) return { ok: false, error: "File too large (max 10MB)" };

    const uploadsDir = path.join(process.cwd(), "uploads", ctx.companyId);
    fs.mkdirSync(uploadsDir, { recursive: true });
    const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
    const storagePath = path.join(uploadsDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(storagePath, buffer);

    // Extract text
    let text = "";
    let extractionStatus = "NONE";
    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        text = await extractPdfText(buffer);
      } else if (file.type.startsWith("text/") || /\.(txt|csv)$/i.test(file.name)) {
        text = buffer.toString("utf-8");
      }
    } catch {
      extractionStatus = "FAILED";
    }

    let extracted: string | undefined;
    let draftInfo = "";
    if (text.trim().length > 20) {
      const fields = await extractInvoice(text);
      extracted = JSON.stringify(fields);
      extractionStatus = "EXTRACTED";

      // Create a draft bill when we have enough signal
      if (docType === "INVOICE" && fields.supplierName.value && fields.grossCents.value && fields.grossCents.value > 0) {
        const supplier = resolveSupplier(ctx.companyId, fields.supplierName.value);
        const vatRate = pickVatRate(ctx.companyId, fields.vatRateBps.value);
        const account = pickAccount(ctx.companyId, fields.suggestedAccountCode.value);
        const net = fields.netCents.value ?? fields.grossCents.value - (fields.vatCents.value ?? 0);
        const { billId, number } = createBill({
          companyId: ctx.companyId,
          contactId: supplier.id,
          date: fields.date.value ? new Date(fields.date.value) : new Date(),
          dueDate: fields.dueDate.value ? new Date(fields.dueDate.value) : undefined,
          supplierRef: fields.invoiceNumber.value ?? undefined,
          origin: "DOCUMENT_EXTRACTION",
          userId: ctx.user.id,
          lines: [
            {
              description: fields.description.value ?? `${fields.supplierName.value} — extracted from ${file.name}`,
              quantity: 1,
              unitPriceCents: net,
              accountId: account,
              vatRateId: vatRate,
            },
          ],
        });
        const doc = storeDocument(ctx.companyId, ctx.user.id, file, safeName, storagePath, docType, extracted, extractionStatus, { billId });
        draftInfo = ` Draft bill ${number} created${fields.arithmeticOk ? " (amounts cross-checked: net + VAT = gross ✓)" : " — amounts need review"}. It posts nothing until approved.`;
        revalidatePath("/", "layout");
        return { ok: true, id: doc, message: `Extracted ${file.name}.${draftInfo}` };
      }
      if (docType === "RECEIPT" && fields.grossCents.value && fields.grossCents.value > 0) {
        const vatRate = pickVatRate(ctx.companyId, fields.vatRateBps.value);
        const account = pickAccount(ctx.companyId, fields.suggestedAccountCode.value);
        const { expenseId } = createExpense({
          companyId: ctx.companyId,
          merchant: fields.supplierName.value ?? "Unknown merchant",
          description: fields.description.value ?? undefined,
          date: fields.date.value ? new Date(fields.date.value) : new Date(),
          accountId: account,
          vatRateId: vatRate,
          grossCents: fields.grossCents.value,
          vatCents: fields.vatCents.value ?? undefined,
          paidVia: "PERSONAL",
          origin: "RECEIPT_SCAN",
          userId: ctx.user.id,
        });
        const doc = storeDocument(ctx.companyId, ctx.user.id, file, safeName, storagePath, docType, extracted, extractionStatus, { expenseId });
        revalidatePath("/", "layout");
        return { ok: true, id: doc, message: `Receipt scanned — draft expense created for your approval.` };
      }
    }

    const doc = storeDocument(ctx.companyId, ctx.user.id, file, safeName, storagePath, docType, extracted, extractionStatus, {});
    revalidatePath("/", "layout");
    return {
      ok: true,
      id: doc,
      message:
        extractionStatus === "EXTRACTED"
          ? "Document stored and text extracted — not enough confident fields to draft a bill automatically."
          : "Document stored. (Text extraction works best with PDF invoices that have a text layer.)",
    };
  } catch (e) {
    return handle(e);
  }
}

function storeDocument(
  companyId: string,
  userId: string,
  file: File,
  filename: string,
  storagePath: string,
  docType: string,
  extracted: string | undefined,
  extractionStatus: string,
  links: { billId?: string; expenseId?: string }
): string {
  const doc = db
    .insert(tables.documents)
    .values({
      companyId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      storagePath,
      docType,
      extracted,
      extractionStatus,
      uploadedById: userId,
      billId: links.billId,
      expenseId: links.expenseId,
    })
    .returning({ id: tables.documents.id })
    .get();
  writeAudit({ companyId, userId, action: "document.uploaded", entityType: "document", entityId: doc.id, after: { filename: file.name, docType, extractionStatus, ...links } });
  return doc.id;
}

function pickVatRate(companyId: string, bps: number | null): string {
  const rates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, companyId)).all();
  if (bps != null) {
    const exact = rates.find((r) => r.rateBps === bps && r.category !== "EXEMPT");
    if (exact) return exact.id;
  }
  return rates.find((r) => r.category === "STANDARD")!.id;
}

function pickAccount(companyId: string, code: string | null): string {
  const byCode = code
    ? db.select().from(tables.accounts).where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.code, code))).get()
    : null;
  if (byCode) return byCode.id;
  return db.select().from(tables.accounts).where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.code, "5000"))).get()!.id;
}
