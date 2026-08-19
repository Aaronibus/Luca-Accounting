import { describe, it, expect } from "vitest";
import { db, tables } from "../src/db";
import { and, eq } from "drizzle-orm";
import { generateBankSuggestions } from "../src/lib/ai/categorise";
import { acceptSuggestion, rejectSuggestion, acceptAllConfident } from "../src/lib/ai/suggestions";
import { detectAnomalies } from "../src/lib/ai/anomalies";
import { explainReconciliation, healthScore } from "../src/lib/ai/insights";
import { extractInvoiceFields } from "../src/lib/ai/extract";
import { importBankTransactions } from "../src/lib/services/banking";
import { createInvoice, createBill, createExpense } from "../src/lib/services/documents";
import { approveInvoice, approveBill, categoriseBankTransaction } from "../src/lib/engine/posting";
import { accountBalance } from "../src/lib/engine/journal";
import { createTestCompany, accountByCode, vatRateByCategory, createTestCustomer, createTestSupplier, createTestBankAccount } from "./helpers";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

function suggestionsFor(companyId: string) {
  return db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .all();
}

describe("transaction intelligence", () => {
  it("suggests Irish merchant categorisations with correct VAT treatment", () => {
    const { companyId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [
        { date: d("2026-05-02"), description: "ELECTRIC IRELAND DD", amountCents: -21800 },
        { date: d("2026-05-03"), description: "VODAFONE IRELAND", amountCents: -6150 },
        { date: d("2026-05-04"), description: "AXA INSURANCE DD", amountCents: -12000 },
      ],
    });
    generateBankSuggestions(companyId);
    const sugg = suggestionsFor(companyId);
    expect(sugg.length).toBe(3);

    const esb = sugg.find((s) => JSON.parse(s.payload).accountName?.includes("Light & Heat"));
    expect(esb).toBeTruthy();
    const esbPayload = JSON.parse(esb!.payload);
    // 9% VAT from gross 218.00 → net 200.00, VAT 18.00
    expect(esbPayload.vatCents).toBe(1800);

    const axa = sugg.find((s) => JSON.parse(s.payload).accountName?.includes("Insurance"));
    expect(axa).toBeTruthy();
    expect(JSON.parse(axa!.payload).vatCents).toBe(0); // insurance exempt
  });

  it("matches money-in to an open invoice by exact amount", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId, "Murphy Construction");
    const bank = createTestBankAccount(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-05-01"), userId,
      lines: [{ description: "Job", quantity: 1, unitPriceCents: 250000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });

    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [{ date: d("2026-05-10"), description: "MURPHY CONSTRUCTION", amountCents: 307500 }],
    });
    generateBankSuggestions(companyId);
    const sugg = suggestionsFor(companyId);
    expect(sugg.length).toBe(1);
    expect(sugg[0].kind).toBe("MATCH");
    expect(sugg[0].confidence).toBeGreaterThanOrEqual(90); // name overlap boosts it

    // Accept → invoice paid, txn matched, AR cleared
    acceptSuggestion({ companyId, suggestionId: sugg[0].id, userId });
    const invoice = db.select().from(tables.invoices).where(eq(tables.invoices.id, inv.invoiceId)).get()!;
    expect(invoice.status).toBe("PAID");
    const ar = accountByCode(companyId, "1100");
    expect(accountBalance(companyId, ar.id)).toBe(0);
    const txn = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, bank.id)).get()!;
    expect(txn.status).toBe("MATCHED");
  });

  it("detects transfers between accounts", () => {
    const { companyId } = createTestCompany();
    const current = createTestBankAccount(companyId, "Current");
    const glSavings = db.insert(tables.accounts).values({ companyId, code: "1010", name: "Savings", type: "ASSET", subtype: "BANK" }).returning().get();
    const savings = db.insert(tables.bankAccounts).values({ companyId, name: "Savings", accountId: glSavings.id }).returning().get();
    importBankTransactions({ companyId, bankAccountId: current.id, rows: [{ date: d("2026-05-05"), description: "TFR TO DEPOSIT", amountCents: -1000000 }] });
    importBankTransactions({ companyId, bankAccountId: savings.id, rows: [{ date: d("2026-05-06"), description: "TFR FROM CURRENT", amountCents: 1000000 }] });
    generateBankSuggestions(companyId);
    const sugg = suggestionsFor(companyId);
    const transfer = sugg.find((s) => s.kind === "TRANSFER");
    expect(transfer).toBeTruthy();
    expect(transfer!.confidence).toBeGreaterThanOrEqual(85);
  });

  it("learns from past categorisations (merchant memory)", () => {
    const { companyId, userId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [{ date: d("2026-04-01"), description: "ZENDESK *INV4321", amountCents: -9900 }],
    });
    generateBankSuggestions(companyId);
    // Zendesk is not in the KB → no suggestion; categorise manually
    expect(suggestionsFor(companyId).length).toBe(0);
    const txn1 = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, bank.id)).get()!;
    const software = accountByCode(companyId, "6300");
    const std = vatRateByCategory(companyId, "STANDARD");
    categoriseBankTransaction({ companyId, bankTransactionId: txn1.id, accountId: software.id, vatRateId: std.id, vatCents: 0, userId });

    // next month, same merchant → memory suggestion
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [{ date: d("2026-05-01"), description: "ZENDESK *INV5555", amountCents: -9900 }],
    });
    generateBankSuggestions(companyId);
    const sugg = suggestionsFor(companyId);
    expect(sugg.length).toBe(1);
    expect(sugg[0].source).toBe("MEMORY");
    expect(JSON.parse(sugg[0].payload).accountName).toContain("Software");
  });

  it("bulk-accepts only high-confidence suggestions", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId, "Delaney Media");
    const bank = createTestBankAccount(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-05-01"), userId,
      lines: [{ description: "Retainer", quantity: 1, unitPriceCents: 100000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [
        { date: d("2026-05-09"), description: "DELANEY MEDIA INV", amountCents: 123000 }, // exact match + name → high conf
        { date: d("2026-05-10"), description: "WOODIES DIY", amountCents: -8500 }, // heuristic, low conf
      ],
    });
    generateBankSuggestions(companyId);
    const result = acceptAllConfident({ companyId, userId, threshold: 92 });
    expect(result.applied.length).toBe(1);
    expect(result.skipped.length).toBe(1);
  });

  it("rejecting a suggestion leaves the ledger untouched", () => {
    const { companyId, userId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [{ date: d("2026-05-02"), description: "ELECTRIC IRELAND DD", amountCents: -10000 }],
    });
    generateBankSuggestions(companyId);
    const sugg = suggestionsFor(companyId)[0];
    rejectSuggestion({ companyId, suggestionId: sugg.id, userId });
    const glBank = accountByCode(companyId, "1000");
    expect(accountBalance(companyId, glBank.id)).toBe(0);
    const txn = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, bank.id)).get()!;
    expect(txn.status).toBe("UNRECONCILED");
  });
});

describe("anomaly detection", () => {
  it("flags duplicate bills, worse when supplier ref matches", () => {
    const { companyId, userId } = createTestCompany();
    const supplier = createTestSupplier(companyId, "Office World");
    const purchases = accountByCode(companyId, "5000");
    const std = vatRateByCategory(companyId, "STANDARD");
    for (const ref of ["OW-100", "OW-100"]) {
      const bill = createBill({
        companyId, contactId: supplier.id, date: d("2026-05-05"), supplierRef: ref, userId,
        lines: [{ description: "Desks", quantity: 1, unitPriceCents: 80000, accountId: purchases.id, vatRateId: std.id }],
      });
      approveBill({ companyId, billId: bill.billId, userId });
    }
    const anomalies = detectAnomalies(companyId);
    const dup = anomalies.find((a) => a.kind === "DUPLICATE");
    expect(dup).toBeTruthy();
    expect(dup!.severity).toBe("critical"); // same supplier ref
    expect(dup!.evidence.length).toBe(2);
  });

  it("flags duplicate expenses", () => {
    const { companyId, userId } = createTestCompany();
    const opex = accountByCode(companyId, "6600");
    const std = vatRateByCategory(companyId, "STANDARD");
    for (let i = 0; i < 2; i++) {
      createExpense({ companyId, merchant: "Easons", date: d("2026-05-0" + (3 + i)), accountId: opex.id, vatRateId: std.id, grossCents: 4599, paidVia: "PERSONAL", userId });
    }
    const anomalies = detectAnomalies(companyId);
    expect(anomalies.some((a) => a.kind === "DUPLICATE" && a.title.includes("Easons"))).toBe(true);
  });
});

describe("reconciliation explanation", () => {
  it("explains a difference caused by unmatched transactions with the exact figure", () => {
    const { companyId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [
        { date: d("2026-05-01"), description: "MYSTERY DD ONE", amountCents: -100000 },
        { date: d("2026-05-02"), description: "MYSTERY DD TWO", amountCents: -60000 },
        { date: d("2026-05-03"), description: "MYSTERY LODGEMENT", amountCents: -24250 },
      ],
    });
    const insight = explainReconciliation(companyId, bank.id);
    expect(insight.answer).toContain("1,842.50");
    expect(insight.answer).toContain("3 transaction");
    expect(insight.evidence.length).toBe(3);
  });

  it("reports fully reconciled accounts as such", () => {
    const { companyId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    const insight = explainReconciliation(companyId, bank.id);
    expect(insight.answer).toMatch(/fully reconciled/i);
  });
});

describe("health score", () => {
  it("penalises unexplained transactions and overdue invoices", () => {
    const { companyId, userId } = createTestCompany();
    const clean = healthScore(companyId);
    expect(clean.score).toBe(100);

    const customer = createTestCustomer(companyId);
    const bank = createTestBankAccount(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2025-11-01"), dueDate: d("2025-12-01"), userId,
      lines: [{ description: "Old job", quantity: 1, unitPriceCents: 100000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });
    importBankTransactions({
      companyId, bankAccountId: bank.id,
      rows: [{ date: d("2026-05-01"), description: "SOMETHING", amountCents: -5000 }],
    });
    const dirty = healthScore(companyId);
    expect(dirty.score).toBeLessThan(clean.score);
    expect(dirty.factors.some((f) => f.label.includes("overdue"))).toBe(true);
    expect(dirty.factors.some((f) => f.label.includes("unexplained"))).toBe(true);
  });
});

describe("document extraction", () => {
  it("extracts invoice fields with arithmetic verification", () => {
    const text = `
Pierse Office Supplies Ltd
Unit 4, Park West, Dublin 12
VAT No: IE6388047V

INVOICE

Invoice Number: POS-2026-0441
Invoice Date: 12/05/2026
Due Date: 11/06/2026

Description                     Amount
Ergonomic office chairs x4     820.00

Subtotal                        820.00
VAT @ 23%                       188.60
Total Due                     1,008.60
`;
    const result = extractInvoiceFields(text);
    expect(result.supplierName.value).toContain("Pierse");
    expect(result.invoiceNumber.value).toBe("POS-2026-0441");
    expect(result.date.value).toBe("2026-05-12");
    expect(result.dueDate.value).toBe("2026-06-11");
    expect(result.netCents.value).toBe(82000);
    expect(result.vatCents.value).toBe(18860);
    expect(result.grossCents.value).toBe(100860);
    expect(result.vatRateBps.value).toBe(2300);
    expect(result.arithmeticOk).toBe(true);
    expect(result.netCents.confidence).toBeGreaterThanOrEqual(90);
  });

  it("derives missing net from gross and VAT", () => {
    const text = `
Insomnia Coffee Company
Receipt
14 May 2026
VAT 9% 1.14
Total 13.80
`;
    const r = extractInvoiceFields(text);
    expect(r.grossCents.value).toBe(1380);
    expect(r.vatCents.value).toBe(114);
    expect(r.netCents.value).toBe(1266);
    expect(r.arithmeticOk).toBe(true);
    expect(r.vatRateBps.value).toBe(900);
  });
});
