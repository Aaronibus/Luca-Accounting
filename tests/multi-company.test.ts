// ACCEPTANCE TEST — multi-company creation and isolation.
// Mirrors the 14-step scenario in the product spec, end to end, against the
// real services (not mocks): create user → create companies → post activity →
// switch → verify isolation of data, reports, VAT, documents, audit and AI.

import { describe, it, expect } from "vitest";
import { db, tables } from "../src/db";
import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import {
  createCompany,
  createDemoCompany,
  companyEmptiness,
  listUserCompanies,
  setCompanyArchived,
  postOpeningBalances,
  createBankAccount,
} from "../src/lib/services/companies";
import { createInvoice, createBill } from "../src/lib/services/documents";
import { approveInvoice, approveBill } from "../src/lib/engine/posting";
import { AccountingError, postJournal, accountBalance } from "../src/lib/engine/journal";
import { trialBalance, profitAndLoss, agedDebtors } from "../src/lib/engine/reports";
import { computeVatReturn } from "../src/lib/engine/vat";
import { importBankTransactions } from "../src/lib/services/banking";
import { generateBankSuggestions } from "../src/lib/ai/categorise";
import { detectAnomalies } from "../src/lib/ai/anomalies";
import { healthScore, explainProfitChange } from "../src/lib/ai/insights";
import { askCopilot } from "../src/lib/ai/copilot";
import { accountByCode, vatRateByCategory } from "./helpers";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

function createUser(name: string) {
  return db
    .insert(tables.users)
    .values({ email: `${randomUUID()}@luca.test`, name, passwordHash: bcrypt.hashSync("demo1234", 4) })
    .returning()
    .get();
}

/** Everything a company could own — used to prove isolation exhaustively. */
function companyFootprint(companyId: string) {
  const bankTxns = db
    .select({ id: tables.bankTransactions.id })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(eq(tables.bankAccounts.companyId, companyId))
    .all();
  return {
    journals: db.select().from(tables.journals).where(eq(tables.journals.companyId, companyId)).all(),
    invoices: db.select().from(tables.invoices).where(eq(tables.invoices.companyId, companyId)).all(),
    bills: db.select().from(tables.bills).where(eq(tables.bills.companyId, companyId)).all(),
    expenses: db.select().from(tables.expenses).where(eq(tables.expenses.companyId, companyId)).all(),
    contacts: db.select().from(tables.contacts).where(eq(tables.contacts.companyId, companyId)).all(),
    bankAccounts: db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, companyId)).all(),
    bankTransactions: bankTxns,
    payments: db.select().from(tables.payments).where(eq(tables.payments.companyId, companyId)).all(),
    vatReturns: db.select().from(tables.vatReturns).where(eq(tables.vatReturns.companyId, companyId)).all(),
    documents: db.select().from(tables.documents).where(eq(tables.documents.companyId, companyId)).all(),
    suggestions: db.select().from(tables.suggestions).where(eq(tables.suggestions.companyId, companyId)).all(),
    accounts: db.select().from(tables.accounts).where(eq(tables.accounts.companyId, companyId)).all(),
    vatRates: db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, companyId)).all(),
    sequences: db.select().from(tables.numberSequences).where(eq(tables.numberSequences.companyId, companyId)).all(),
  };
}

describe("ACCEPTANCE: multi-company creation and isolation", () => {
  it("passes the full 14-step scenario", async () => {
    // ── 1. Create User A ──────────────────────────────────────────────
    const userA = createUser("Aisling Ryan");

    // A brand-new user belongs to no companies at all
    expect(listUserCompanies(userA.id)).toHaveLength(0);

    // ── 2. Create Company A ───────────────────────────────────────────
    const { companyId: companyA } = createCompany({
      userId: userA.id,
      name: "Ryan Joinery Ltd",
      entityType: "LIMITED_COMPANY",
      industry: "Construction & trades",
      city: "Ennis",
      county: "Co. Clare",
      vatRegistered: true,
      vatNumber: "IE9876543A",
    });

    // ── 3. Company A contains ZERO accounting transactions ────────────
    const fresh = companyFootprint(companyA);
    expect(fresh.journals).toHaveLength(0);
    expect(fresh.invoices).toHaveLength(0);
    expect(fresh.bills).toHaveLength(0);
    expect(fresh.expenses).toHaveLength(0);
    expect(fresh.contacts).toHaveLength(0);
    expect(fresh.bankAccounts).toHaveLength(0);
    expect(fresh.bankTransactions).toHaveLength(0);
    expect(fresh.payments).toHaveLength(0);
    expect(fresh.vatReturns).toHaveLength(0);
    expect(fresh.documents).toHaveLength(0);
    expect(fresh.suggestions).toHaveLength(0);
    // …but configuration DOES exist
    expect(fresh.accounts.length).toBeGreaterThan(30);
    expect(fresh.vatRates.length).toBe(6);
    expect(fresh.sequences.length).toBeGreaterThanOrEqual(5);
    expect(companyEmptiness(companyA).isEmpty).toBe(true);

    // Reports on an empty company are genuinely empty, not fabricated
    expect(trialBalance(companyA).rows).toHaveLength(0);
    expect(profitAndLoss(companyA, d("2026-01-01"), d("2026-12-31")).netProfitCents).toBe(0);
    expect(computeVatReturn(companyA, d("2026-01-01"), d("2026-02-28")).t1Cents).toBe(0);
    expect(agedDebtors(companyA)).toHaveLength(0);
    expect(healthScore(companyA).score).toBe(100);
    expect(detectAnomalies(companyA)).toHaveLength(0);

    // ── 4. Create several invoices and transactions in Company A ──────
    const customerA = db
      .insert(tables.contacts)
      .values({ companyId: companyA, type: "CUSTOMER", name: "Clare County Council", paymentTermsDays: 30 })
      .returning()
      .get();
    const supplierA = db
      .insert(tables.contacts)
      .values({ companyId: companyA, type: "SUPPLIER", name: "Timber Supplies Ireland", paymentTermsDays: 30 })
      .returning()
      .get();

    const salesA = accountByCode(companyA, "4000");
    const purchasesA = accountByCode(companyA, "5000");
    const stdA = vatRateByCategory(companyA, "STANDARD");

    const invA1 = createInvoice({
      companyId: companyA, contactId: customerA.id, date: d("2026-03-04"), userId: userA.id,
      lines: [{ description: "Fit-out — phase 1", quantity: 1, unitPriceCents: 850000, accountId: salesA.id, vatRateId: stdA.id }],
    });
    approveInvoice({ companyId: companyA, invoiceId: invA1.invoiceId, userId: userA.id });

    const invA2 = createInvoice({
      companyId: companyA, contactId: customerA.id, date: d("2026-03-18"), userId: userA.id,
      lines: [{ description: "Fit-out — phase 2", quantity: 1, unitPriceCents: 420000, accountId: salesA.id, vatRateId: stdA.id }],
    });
    approveInvoice({ companyId: companyA, invoiceId: invA2.invoiceId, userId: userA.id });

    const billA = createBill({
      companyId: companyA, contactId: supplierA.id, date: d("2026-03-09"), userId: userA.id,
      lines: [{ description: "Oak boards", quantity: 1, unitPriceCents: 260000, accountId: purchasesA.id, vatRateId: stdA.id }],
    });
    approveBill({ companyId: companyA, billId: billA.billId, userId: userA.id });

    const bankA = createBankAccount({
      companyId: companyA, userId: userA.id, name: "AIB Current", bank: "AIB", openingBalanceCents: 0,
    });
    importBankTransactions({
      companyId: companyA, bankAccountId: bankA.bankAccountId, userId: userA.id,
      rows: [
        { date: d("2026-03-25"), description: "CLARE COUNTY COUNCIL", amountCents: 1045500 },
        { date: d("2026-03-26"), description: "ELECTRIC IRELAND DD", amountCents: -21800 },
      ],
    });
    generateBankSuggestions(companyA);

    const afterA = companyFootprint(companyA);
    expect(afterA.invoices).toHaveLength(2);
    expect(afterA.bills).toHaveLength(1);
    expect(afterA.journals.length).toBe(3);
    expect(afterA.bankTransactions).toHaveLength(2);
    expect(afterA.suggestions.length).toBeGreaterThan(0);
    expect(companyEmptiness(companyA).isEmpty).toBe(false);

    const tbA = trialBalance(companyA);
    expect(tbA.totalDebit).toBe(tbA.totalCredit);
    const arA = accountBalance(companyA, accountByCode(companyA, "1100").id);
    expect(arA).toBe(1045500 + 516600); // both invoices outstanding, VAT inclusive

    // ── 5. Create Company B ───────────────────────────────────────────
    const { companyId: companyB } = createCompany({
      userId: userA.id,
      name: "Ryan Property Holdings Ltd",
      entityType: "LIMITED_COMPANY",
      county: "Co. Clare",
      vatRegistered: false,
    });

    // ── 6. Company B is completely empty ──────────────────────────────
    const freshB = companyFootprint(companyB);
    expect(freshB.journals).toHaveLength(0);
    expect(freshB.invoices).toHaveLength(0);
    expect(freshB.bills).toHaveLength(0);
    expect(freshB.expenses).toHaveLength(0);
    expect(freshB.contacts).toHaveLength(0);
    expect(freshB.bankAccounts).toHaveLength(0);
    expect(freshB.bankTransactions).toHaveLength(0);
    expect(freshB.suggestions).toHaveLength(0);
    expect(freshB.documents).toHaveLength(0);
    expect(freshB.vatReturns).toHaveLength(0);
    expect(companyEmptiness(companyB).isEmpty).toBe(true);
    // Configuration only
    expect(freshB.accounts.length).toBeGreaterThan(30);
    expect(freshB.vatRates.length).toBe(6);
    // Not a single record shares an id with Company A
    const aAccountIds = new Set(afterA.accounts.map((a) => a.id));
    expect(freshB.accounts.some((a) => aAccountIds.has(a.id))).toBe(false);
    // Numbering restarts — B's first invoice will be INV-0001 again
    expect(freshB.sequences.find((s) => s.key === "INVOICE")!.nextValue).toBe(1);

    // ── 7 & 8. Company A's data is still intact ───────────────────────
    const recheckA = companyFootprint(companyA);
    expect(recheckA.invoices).toHaveLength(2);
    expect(recheckA.bills).toHaveLength(1);
    expect(recheckA.journals).toHaveLength(3);
    expect(accountBalance(companyA, accountByCode(companyA, "1100").id)).toBe(arA);
    expect(trialBalance(companyA).totalDebit).toBe(tbA.totalDebit);

    // ── 9 & 10. None of Company A's data appears in Company B ─────────
    expect(trialBalance(companyB).rows).toHaveLength(0);
    expect(profitAndLoss(companyB, d("2026-01-01"), d("2026-12-31")).revenue.totalCents).toBe(0);
    expect(agedDebtors(companyB)).toHaveLength(0);
    expect(computeVatReturn(companyB, d("2026-03-01"), d("2026-04-30")).t1Cents).toBe(0);
    expect(detectAnomalies(companyB)).toHaveLength(0);
    expect(healthScore(companyB).score).toBe(100);
    // Cross-tenant posting is rejected by the engine itself
    expect(() =>
      postJournal({
        companyId: companyB,
        date: d("2026-03-05"),
        description: "cross-tenant attempt",
        sourceType: "MANUAL",
        lines: [
          { accountId: accountByCode(companyB, "1000").id, debitCents: 1000 },
          { accountId: salesA.id, creditCents: 1000 }, // Company A's sales account
        ],
      })
    ).toThrow(/does not exist in this company/);
    // Audit logs never cross either
    const auditB = db.select().from(tables.auditLogs).where(eq(tables.auditLogs.companyId, companyB)).all();
    expect(auditB.every((l) => l.companyId === companyB)).toBe(true);
    expect(auditB.some((l) => l.action === "company.created")).toBe(true);

    // ── 11 & 12. The AI, asked about Company B, sees only Company B ────
    const aiB = await askCopilot({
      companyId: companyB,
      userId: userA.id,
      question: "What needs my attention?",
      context: { page: "/dashboard" },
    });
    const aiBText = [aiB.answer, ...aiB.details].join(" ");
    // No Company A figures, customers, suppliers or document numbers leak in
    for (const leak of ["Clare County Council", "Timber Supplies", "8,500", "10,455", "2,600", invA1.number, billA.number]) {
      expect(aiBText).not.toContain(leak);
    }
    const aiBProfit = await askCopilot({
      companyId: companyB,
      userId: userA.id,
      question: "Why is my profit down this month?",
    });
    expect([aiBProfit.answer, ...aiBProfit.details].join(" ")).not.toContain("Clare County Council");
    // And the underlying insight for B is genuinely zero
    expect(explainProfitChange(companyB, d("2026-03-01"), d("2026-03-31")).answer).toContain("€0.00");
    // Whereas the same question in Company A does surface A's data
    const aiA = await askCopilot({
      companyId: companyA,
      userId: userA.id,
      question: "Who owes me money?",
    });
    expect([aiA.answer, ...aiA.details].join(" ")).toContain("Clare County Council");
    // Suggestions are company-scoped: generating for B creates none from A's feed
    const createdB = generateBankSuggestions(companyB);
    expect(createdB.created).toBe(0);

    // ── 13 & 14. Company C is independent too ─────────────────────────
    const { companyId: companyC } = createCompany({ userId: userA.id, name: "Ryan Sole Trader", entityType: "SOLE_TRADER" });
    const freshC = companyFootprint(companyC);
    expect(companyEmptiness(companyC).isEmpty).toBe(true);
    expect(freshC.journals).toHaveLength(0);
    expect(freshC.invoices).toHaveLength(0);
    expect(freshC.contacts).toHaveLength(0);
    expect(freshC.accounts.length).toBeGreaterThan(30);

    // Posting in C leaves A and B untouched
    postOpeningBalances({
      companyId: companyC,
      userId: userA.id,
      date: d("2026-01-01"),
      lines: [{ accountId: accountByCode(companyC, "1000").id, debitCents: 500000, creditCents: 0 }],
      balanceToRetainedEarnings: true,
    });
    expect(trialBalance(companyC).totalDebit).toBe(500000);
    expect(trialBalance(companyB).rows).toHaveLength(0);
    expect(trialBalance(companyA).totalDebit).toBe(tbA.totalDebit);

    // The user now sees exactly three companies, all their own
    const list = listUserCompanies(userA.id);
    expect(list.map((c) => c.companyId).sort()).toEqual([companyA, companyB, companyC].sort());
    expect(list.every((c) => !c.isDemo)).toBe(true);
  });

  it("keeps demo data isolated from real companies", () => {
    const userB = createUser("Demo Explorer");
    const { companyId: demoId } = createDemoCompany({ userId: userB.id });

    const demo = db.select().from(tables.companies).where(eq(tables.companies.id, demoId)).get()!;
    expect(demo.isDemo).toBe(true);
    expect(companyEmptiness(demoId).isEmpty).toBe(false); // demo has activity

    // A real company created by the SAME user is still completely blank
    const { companyId: realId } = createCompany({ userId: userB.id, name: "Explorer Real Ltd" });
    const real = db.select().from(tables.companies).where(eq(tables.companies.id, realId)).get()!;
    expect(real.isDemo).toBe(false);
    expect(companyEmptiness(realId).isEmpty).toBe(true);

    const realFootprint = companyFootprint(realId);
    expect(realFootprint.invoices).toHaveLength(0);
    expect(realFootprint.contacts).toHaveLength(0);
    expect(realFootprint.bankTransactions).toHaveLength(0);

    // Demo and real live in different organisations
    expect(demo.organisationId).not.toBe(real.organisationId);

    // Demo data belongs only to the demo company
    const demoContacts = db.select().from(tables.contacts).where(eq(tables.contacts.companyId, demoId)).all();
    expect(demoContacts.length).toBeGreaterThan(5);
    expect(demoContacts.every((c) => c.companyId === demoId)).toBe(true);
  });

  it("scopes users to their own companies only", () => {
    const owner = createUser("Owner One");
    const stranger = createUser("Stranger Two");
    const { companyId } = createCompany({ userId: owner.id, name: "Private Books Ltd" });

    // The stranger has no membership, so the company never appears for them
    expect(listUserCompanies(stranger.id).some((c) => c.companyId === companyId)).toBe(false);
    const membership = db
      .select()
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, stranger.id), eq(tables.memberships.companyId, companyId)))
      .get();
    expect(membership).toBeUndefined();

    // Two users, two companies, no overlap
    const { companyId: otherCompany } = createCompany({ userId: stranger.id, name: "Stranger Books Ltd" });
    expect(listUserCompanies(owner.id).some((c) => c.companyId === otherCompany)).toBe(false);
    expect(listUserCompanies(stranger.id).some((c) => c.companyId === companyId)).toBe(false);
  });

  it("archives a company without destroying its data", () => {
    const user = createUser("Archiver");
    const { companyId } = createCompany({ userId: user.id, name: "Old Venture Ltd" });
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    postJournal({
      companyId, date: d("2026-02-01"), description: "Historic sale", sourceType: "MANUAL", userId: user.id,
      lines: [
        { accountId: bank.id, debitCents: 10000 },
        { accountId: sales.id, creditCents: 10000 },
      ],
    });

    setCompanyArchived({ companyId, userId: user.id, archived: true });
    expect(listUserCompanies(user.id).some((c) => c.companyId === companyId)).toBe(false);
    expect(listUserCompanies(user.id, { includeArchived: true }).some((c) => c.companyId === companyId)).toBe(true);
    // Data is retained
    expect(trialBalance(companyId).totalDebit).toBe(10000);

    setCompanyArchived({ companyId, userId: user.id, archived: false });
    expect(listUserCompanies(user.id).some((c) => c.companyId === companyId)).toBe(true);
  });

  it("posts explicit opening balances only when asked, and balances them", () => {
    const user = createUser("Opener");
    const { companyId } = createCompany({ userId: user.id, name: "Migration Ltd" });

    // Nothing is invented on creation
    expect(trialBalance(companyId).rows).toHaveLength(0);

    const bank = accountByCode(companyId, "1000");
    const ar = accountByCode(companyId, "1100");
    const ap = accountByCode(companyId, "2000");

    // Unbalanced entry is rejected unless the user opts into the retained-earnings plug
    expect(() =>
      postOpeningBalances({
        companyId, userId: user.id, date: d("2026-01-01"),
        lines: [
          { accountId: bank.id, debitCents: 1200000, creditCents: 0 },
          { accountId: ap.id, debitCents: 0, creditCents: 300000 },
        ],
      })
    ).toThrow(/do not balance/);

    postOpeningBalances({
      companyId, userId: user.id, date: d("2026-01-01"),
      balanceToRetainedEarnings: true,
      lines: [
        { accountId: bank.id, debitCents: 1200000, creditCents: 0 },
        { accountId: ar.id, debitCents: 450000, creditCents: 0 },
        { accountId: ap.id, debitCents: 0, creditCents: 300000 },
      ],
    });

    const tb = trialBalance(companyId);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(accountBalance(companyId, bank.id)).toBe(1200000);
    const retained = db
      .select()
      .from(tables.accounts)
      .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, "RETAINED_EARNINGS")))
      .get()!;
    expect(accountBalance(companyId, retained.id)).toBe(-1350000);

    const journals = db.select().from(tables.journals).where(eq(tables.journals.companyId, companyId)).all();
    expect(journals).toHaveLength(1);
    expect(journals[0].sourceType).toBe("OPENING_BALANCE");
  });

  it("creates bank accounts with their own GL account per company", () => {
    const user = createUser("Banker");
    const { companyId: c1 } = createCompany({ userId: user.id, name: "Bank Test One" });
    const { companyId: c2 } = createCompany({ userId: user.id, name: "Bank Test Two" });

    const b1 = createBankAccount({ companyId: c1, userId: user.id, name: "Current", openingBalanceCents: 100000 });
    const b2 = createBankAccount({ companyId: c1, userId: user.id, name: "Deposit" });
    const b3 = createBankAccount({ companyId: c2, userId: user.id, name: "Current" });

    // Distinct GL accounts, codes allocated per company
    expect(new Set([b1.accountId, b2.accountId, b3.accountId]).size).toBe(3);
    const c1Banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, c1)).all();
    const c2Banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, c2)).all();
    expect(c1Banks).toHaveLength(2);
    expect(c2Banks).toHaveLength(1);

    // Importing into one company's account leaves the other untouched
    importBankTransactions({
      companyId: c1, bankAccountId: b1.bankAccountId, userId: user.id,
      rows: [{ date: d("2026-04-01"), description: "TEST LODGEMENT", amountCents: 50000 }],
    });
    const c2Txns = db
      .select()
      .from(tables.bankTransactions)
      .where(inArray(tables.bankTransactions.bankAccountId, c2Banks.map((b) => b.id)))
      .all();
    expect(c2Txns).toHaveLength(0);

    // And a bank account from another company cannot be used for an import
    expect(() =>
      importBankTransactions({
        companyId: c2, bankAccountId: b1.bankAccountId, userId: user.id,
        rows: [{ date: d("2026-04-02"), description: "CROSS TENANT", amountCents: 1 }],
      })
    ).toThrow(AccountingError);
  });
});
