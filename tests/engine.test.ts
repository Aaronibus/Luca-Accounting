import { describe, it, expect } from "vitest";
import { db, tables } from "../src/db";
import { and, eq } from "drizzle-orm";
import { postJournal, reverseJournal, accountBalance, isDateLocked, AccountingError } from "../src/lib/engine/journal";
import { trialBalance, profitAndLoss, balanceSheet, agedDebtors, accountActivity } from "../src/lib/engine/reports";
import { approveInvoice, approveBill, approveExpense, createPayment, categoriseBankTransaction, matchTransfer, voidInvoice } from "../src/lib/engine/posting";
import { createInvoice, createBill, createExpense } from "../src/lib/services/documents";
import { importBankTransactions, bankReconciliationStatus, txnFingerprint } from "../src/lib/services/banking";
import { computeVatReturn, prepareVatReturn, finaliseVatReturn } from "../src/lib/engine/vat";
import { createTestCompany, accountByCode, vatRateByCategory, createTestCustomer, createTestSupplier, createTestBankAccount } from "./helpers";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

describe("journal engine", () => {
  it("rejects unbalanced journals", () => {
    const { companyId, userId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    expect(() =>
      postJournal({
        companyId, date: d("2026-01-15"), description: "bad", sourceType: "MANUAL", userId,
        lines: [
          { accountId: bank.id, debitCents: 1000 },
          { accountId: sales.id, creditCents: 999 },
        ],
      })
    ).toThrowError(/does not balance/);
  });

  it("rejects lines with both or neither side", () => {
    const { companyId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    expect(() =>
      postJournal({
        companyId, date: d("2026-01-15"), description: "bad", sourceType: "MANUAL",
        lines: [
          { accountId: bank.id, debitCents: 1000, creditCents: 1000 },
          { accountId: sales.id, creditCents: 0 },
        ],
      })
    ).toThrow(AccountingError);
  });

  it("rejects non-integer and negative amounts", () => {
    const { companyId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    expect(() =>
      postJournal({
        companyId, date: d("2026-01-15"), description: "bad", sourceType: "MANUAL",
        lines: [
          { accountId: bank.id, debitCents: 10.5 },
          { accountId: sales.id, creditCents: 10.5 },
        ],
      })
    ).toThrow(/integer/);
  });

  it("posts balanced journals and updates balances", () => {
    const { companyId, userId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    const { journalId } = postJournal({
      companyId, date: d("2026-01-15"), description: "Cash sale", sourceType: "MANUAL", userId,
      lines: [
        { accountId: bank.id, debitCents: 12300 },
        { accountId: sales.id, creditCents: 12300 },
      ],
    });
    expect(journalId).toBeTruthy();
    expect(accountBalance(companyId, bank.id)).toBe(12300);
    expect(accountBalance(companyId, sales.id)).toBe(-12300);
  });

  it("cannot post to another company's accounts (isolation)", () => {
    const a = createTestCompany("A");
    const b = createTestCompany("B");
    const salesB = accountByCode(b.companyId, "4000");
    const bankA = accountByCode(a.companyId, "1000");
    expect(() =>
      postJournal({
        companyId: a.companyId, date: d("2026-01-15"), description: "cross-tenant", sourceType: "MANUAL",
        lines: [
          { accountId: bankA.id, debitCents: 100 },
          { accountId: salesB.id, creditCents: 100 },
        ],
      })
    ).toThrow(/does not exist in this company/);
  });

  it("reverses journals immutably", () => {
    const { companyId, userId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    const { journalId } = postJournal({
      companyId, date: d("2026-01-10"), description: "To reverse", sourceType: "MANUAL", userId,
      lines: [
        { accountId: bank.id, debitCents: 5000 },
        { accountId: sales.id, creditCents: 5000 },
      ],
    });
    reverseJournal({ companyId, journalId, userId, reason: "mistake" });
    expect(accountBalance(companyId, bank.id)).toBe(0);
    expect(accountBalance(companyId, sales.id)).toBe(0);
    const original = db.select().from(tables.journals).where(eq(tables.journals.id, journalId)).get()!;
    expect(original.status).toBe("REVERSED");
    // original lines untouched
    const lines = db.select().from(tables.journalLines).where(eq(tables.journalLines.journalId, journalId)).all();
    expect(lines.some((l) => l.debitCents === 5000)).toBe(true);
    // cannot double-reverse
    expect(() => reverseJournal({ companyId, journalId, userId })).toThrow(/already reversed/i);
  });

  it("enforces period locks", () => {
    const { companyId, userId } = createTestCompany();
    const sales = accountByCode(companyId, "4000");
    const bank = accountByCode(companyId, "1000");
    db.insert(tables.periodLocks)
      .values({ companyId, lockedThrough: d("2026-02-28"), reason: "test lock", createdById: userId })
      .run();
    expect(isDateLocked(companyId, d("2026-02-15"))).toBe(true);
    expect(isDateLocked(companyId, d("2026-03-01"))).toBe(false);
    expect(() =>
      postJournal({
        companyId, date: d("2026-02-15"), description: "locked", sourceType: "MANUAL",
        lines: [
          { accountId: bank.id, debitCents: 100 },
          { accountId: sales.id, creditCents: 100 },
        ],
      })
    ).toThrow(/locked/);
    // posting after the lock works
    postJournal({
      companyId, date: d("2026-03-15"), description: "open", sourceType: "MANUAL",
      lines: [
        { accountId: bank.id, debitCents: 100 },
        { accountId: sales.id, creditCents: 100 },
      ],
    });
  });
});

describe("invoice lifecycle", () => {
  it("creates, approves and pays an invoice with correct VAT and postings", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const bankAcct = createTestBankAccount(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");

    const { invoiceId, totalCents } = createInvoice({
      companyId, contactId: customer.id, date: d("2026-03-05"), userId,
      lines: [
        { description: "Consulting", quantity: 10, unitPriceCents: 10000, accountId: sales.id, vatRateId: std.id },
        { description: "Support", quantity: 1, unitPriceCents: 25000, accountId: sales.id, vatRateId: std.id },
      ],
    });
    // net 1250.00, VAT 287.50, total 1537.50
    expect(totalCents).toBe(153750);

    approveInvoice({ companyId, invoiceId, userId });
    const ar = accountByCode(companyId, "1100");
    const vatControl = accountByCode(companyId, "2100");
    expect(accountBalance(companyId, ar.id)).toBe(153750);
    expect(accountBalance(companyId, vatControl.id)).toBe(-28750);
    expect(accountBalance(companyId, sales.id)).toBe(-125000);

    // partial payment
    createPayment({
      companyId, direction: "RECEIVE", bankAccountId: bankAcct.id, contactId: customer.id,
      date: d("2026-03-20"), amountCents: 100000,
      allocations: [{ invoiceId, amountCents: 100000 }], userId,
    });
    let inv = db.select().from(tables.invoices).where(eq(tables.invoices.id, invoiceId)).get()!;
    expect(inv.paidCents).toBe(100000);
    expect(inv.status).toBe("APPROVED");
    expect(accountBalance(companyId, ar.id)).toBe(53750);

    // overpayment rejected
    expect(() =>
      createPayment({
        companyId, direction: "RECEIVE", bankAccountId: bankAcct.id,
        date: d("2026-03-21"), amountCents: 60000,
        allocations: [{ invoiceId, amountCents: 60000 }],
      })
    ).toThrow(/exceeds amount due/);

    // settle
    createPayment({
      companyId, direction: "RECEIVE", bankAccountId: bankAcct.id, contactId: customer.id,
      date: d("2026-03-25"), amountCents: 53750,
      allocations: [{ invoiceId, amountCents: 53750 }], userId,
    });
    inv = db.select().from(tables.invoices).where(eq(tables.invoices.id, invoiceId)).get()!;
    expect(inv.status).toBe("PAID");
    expect(accountBalance(companyId, ar.id)).toBe(0);

    // trial balance still balances
    const tb = trialBalance(companyId);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("voids an unpaid invoice via reversal", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const { invoiceId } = createInvoice({
      companyId, contactId: customer.id, date: d("2026-03-05"), userId,
      lines: [{ description: "X", quantity: 1, unitPriceCents: 10000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId, userId });
    const ar = accountByCode(companyId, "1100");
    expect(accountBalance(companyId, ar.id)).toBe(12300);
    voidInvoice({ companyId, invoiceId, userId });
    expect(accountBalance(companyId, ar.id)).toBe(0);
    const inv = db.select().from(tables.invoices).where(eq(tables.invoices.id, invoiceId)).get()!;
    expect(inv.status).toBe("VOID");
  });

  it("credit notes post opposite to invoices and net in aged debtors", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-03-01"), userId,
      lines: [{ description: "Goods", quantity: 1, unitPriceCents: 50000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });
    const cn = createInvoice({
      companyId, contactId: customer.id, kind: "CREDIT_NOTE", date: d("2026-03-10"), userId,
      lines: [{ description: "Return", quantity: 1, unitPriceCents: 10000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: cn.invoiceId, userId });
    const ar = accountByCode(companyId, "1100");
    expect(accountBalance(companyId, ar.id)).toBe(61500 - 12300);
    const aged = agedDebtors(companyId, d("2026-03-15"));
    expect(aged[0].totalCents).toBe(61500 - 12300);
  });
});

describe("bills and expenses", () => {
  it("posts bills with input VAT and pays them", () => {
    const { companyId, userId } = createTestCompany();
    const supplier = createTestSupplier(companyId);
    const bankAcct = createTestBankAccount(companyId);
    const purchases = accountByCode(companyId, "5000");
    const std = vatRateByCategory(companyId, "STANDARD");

    const { billId, totalCents } = createBill({
      companyId, contactId: supplier.id, date: d("2026-03-08"), userId,
      lines: [{ description: "Stock", quantity: 4, unitPriceCents: 5000, accountId: purchases.id, vatRateId: std.id }],
    });
    expect(totalCents).toBe(24600); // 200 + 46 VAT

    approveBill({ companyId, billId, userId });
    const ap = accountByCode(companyId, "2000");
    const vatControl = accountByCode(companyId, "2100");
    expect(accountBalance(companyId, ap.id)).toBe(-24600);
    expect(accountBalance(companyId, vatControl.id)).toBe(4600); // input VAT = debit

    createPayment({
      companyId, direction: "SPEND", bankAccountId: bankAcct.id, contactId: supplier.id,
      date: d("2026-03-20"), amountCents: 24600,
      allocations: [{ billId, amountCents: 24600 }], userId,
    });
    expect(accountBalance(companyId, ap.id)).toBe(0);
    const bill = db.select().from(tables.bills).where(eq(tables.bills.id, billId)).get()!;
    expect(bill.status).toBe("PAID");
  });

  it("expenses paid personally credit the directors' loan", () => {
    const { companyId, userId } = createTestCompany();
    const opex = accountByCode(companyId, "6600");
    const std = vatRateByCategory(companyId, "STANDARD");
    const { expenseId, netCents, vatCents } = createExpense({
      companyId, merchant: "Easons", date: d("2026-03-12"), accountId: opex.id,
      vatRateId: std.id, grossCents: 6150, paidVia: "PERSONAL", userId,
    });
    expect(netCents).toBe(5000);
    expect(vatCents).toBe(1150);
    approveExpense({ companyId, expenseId, userId });
    const dla = accountByCode(companyId, "2500");
    expect(accountBalance(companyId, dla.id)).toBe(-6150);
    expect(accountBalance(companyId, opex.id)).toBe(5000);
  });
});

describe("banking", () => {
  it("imports with duplicate detection", () => {
    const { companyId, userId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    const rows = [
      { date: d("2026-03-01"), description: "SUMUP PAYOUT", amountCents: 45000 },
      { date: d("2026-03-01"), description: "COSTA COFFEE", amountCents: -450 },
      { date: d("2026-03-01"), description: "COSTA COFFEE", amountCents: -450 }, // legit same-day duplicate pair
    ];
    const first = importBankTransactions({ companyId, bankAccountId: bank.id, rows, userId });
    expect(first.imported).toBe(3);
    // re-import the same file → all duplicates
    const second = importBankTransactions({ companyId, bankAccountId: bank.id, rows, userId });
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(3);
  });

  it("categorises bank transactions with VAT and reconciles", () => {
    const { companyId, userId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id, userId,
      rows: [{ date: d("2026-03-03"), description: "IONOS HOSTING", amountCents: -12300 }],
    });
    const txn = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, bank.id)).get()!;
    const software = accountByCode(companyId, "6300");
    const std = vatRateByCategory(companyId, "STANDARD");
    categoriseBankTransaction({
      companyId, bankTransactionId: txn.id, accountId: software.id,
      vatRateId: std.id, vatCents: 2300, userId,
    });
    expect(accountBalance(companyId, software.id)).toBe(10000);
    const glBank = accountByCode(companyId, "1000");
    expect(accountBalance(companyId, glBank.id)).toBe(-12300);

    const recon = bankReconciliationStatus(companyId, bank.id);
    expect(recon.differenceCents).toBe(0);
    expect(recon.unmatched.length).toBe(0);
  });

  it("explains reconciliation differences via unmatched transactions", () => {
    const { companyId, userId } = createTestCompany();
    const bank = createTestBankAccount(companyId);
    importBankTransactions({
      companyId, bankAccountId: bank.id, userId,
      rows: [
        { date: d("2026-03-03"), description: "UNKNOWN DD", amountCents: -184250 },
        { date: d("2026-03-04"), description: "CUSTOMER LODGEMENT", amountCents: 50000 },
      ],
    });
    const recon = bankReconciliationStatus(companyId, bank.id);
    expect(recon.statementBalanceCents).toBe(-134250);
    expect(recon.ledgerBalanceCents).toBe(0);
    expect(recon.differenceCents).toBe(-134250);
    expect(recon.unmatchedTotalCents).toBe(-134250); // difference fully explained by unmatched
  });

  it("matches transfers between accounts", () => {
    const { companyId, userId } = createTestCompany();
    const current = createTestBankAccount(companyId, "Current");
    // second bank account needs its own GL account
    const glSavings = db
      .insert(tables.accounts)
      .values({ companyId, code: "1010", name: "Savings", type: "ASSET", subtype: "BANK" })
      .returning()
      .get();
    const savings = db
      .insert(tables.bankAccounts)
      .values({ companyId, name: "Savings", accountId: glSavings.id })
      .returning()
      .get();
    importBankTransactions({
      companyId, bankAccountId: current.id, userId,
      rows: [{ date: d("2026-03-05"), description: "TRANSFER TO SAVINGS", amountCents: -500000 }],
    });
    importBankTransactions({
      companyId, bankAccountId: savings.id, userId,
      rows: [{ date: d("2026-03-05"), description: "TRANSFER FROM CURRENT", amountCents: 500000 }],
    });
    const outTxn = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, current.id)).get()!;
    const inTxn = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, savings.id)).get()!;
    matchTransfer({ companyId, outTransactionId: outTxn.id, inTransactionId: inTxn.id, userId });
    expect(accountBalance(companyId, glSavings.id)).toBe(500000);
    const tb = trialBalance(companyId);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});

describe("VAT returns", () => {
  it("computes T1/T2/T3 from the VAT control account", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const supplier = createTestSupplier(companyId);
    const sales = accountByCode(companyId, "4000");
    const purchases = accountByCode(companyId, "5000");
    const std = vatRateByCategory(companyId, "STANDARD");

    // Sale: net 1000, VAT 230
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-01-15"), userId,
      lines: [{ description: "Sale", quantity: 1, unitPriceCents: 100000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });

    // Purchase: net 400, VAT 92
    const bill = createBill({
      companyId, contactId: supplier.id, date: d("2026-02-10"), userId,
      lines: [{ description: "Buy", quantity: 1, unitPriceCents: 40000, accountId: purchases.id, vatRateId: std.id }],
    });
    approveBill({ companyId, billId: bill.billId, userId });

    const calc = computeVatReturn(companyId, d("2026-01-01"), d("2026-02-28"));
    expect(calc.t1Cents).toBe(23000);
    expect(calc.t2Cents).toBe(9200);
    expect(calc.t3Cents).toBe(13800);
    expect(calc.t4Cents).toBe(0);
  });

  it("finalises a return, moves VAT to payable, locks the period", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-01-15"), userId,
      lines: [{ description: "Sale", quantity: 1, unitPriceCents: 100000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });

    const prepared = prepareVatReturn({ companyId, periodStart: d("2026-01-01"), periodEnd: d("2026-02-28"), userId });
    const result = finaliseVatReturn({ companyId, vatReturnId: prepared.id, userId });
    expect(result.t3Cents).toBe(23000);

    const vatControl = accountByCode(companyId, "2100");
    const vatPayable = accountByCode(companyId, "2110");
    expect(accountBalance(companyId, vatControl.id)).toBe(0);
    expect(accountBalance(companyId, vatPayable.id)).toBe(-23000);

    // period now locked
    expect(isDateLocked(companyId, d("2026-02-15"))).toBe(true);
    const bank = accountByCode(companyId, "1000");
    expect(() =>
      postJournal({
        companyId, date: d("2026-01-20"), description: "backpost", sourceType: "MANUAL",
        lines: [
          { accountId: bank.id, debitCents: 100 },
          { accountId: sales.id, creditCents: 100 },
        ],
      })
    ).toThrow(/locked/);

    // return cannot be re-finalised
    expect(() => finaliseVatReturn({ companyId, vatReturnId: prepared.id, userId })).toThrow(/finalised/i);

    // TB still balances after the close
    const tb = trialBalance(companyId);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("flags draft documents inside the period as exceptions", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const sales = accountByCode(companyId, "4000");
    const std = vatRateByCategory(companyId, "STANDARD");
    createInvoice({
      companyId, contactId: customer.id, date: d("2026-01-20"), userId,
      lines: [{ description: "Draft sale", quantity: 1, unitPriceCents: 5000, accountId: sales.id, vatRateId: std.id }],
    });
    const calc = computeVatReturn(companyId, d("2026-01-01"), d("2026-02-28"));
    expect(calc.exceptions.some((e) => e.code === "DRAFT_INVOICE_IN_PERIOD")).toBe(true);
  });
});

describe("financial statements", () => {
  it("P&L, balance sheet and TB agree after a mixed month", () => {
    const { companyId, userId } = createTestCompany();
    const customer = createTestCustomer(companyId);
    const supplier = createTestSupplier(companyId);
    const bankAcct = createTestBankAccount(companyId);
    const sales = accountByCode(companyId, "4000");
    const purchases = accountByCode(companyId, "5000");
    const rent = accountByCode(companyId, "6000");
    const std = vatRateByCategory(companyId, "STANDARD");
    const exempt = vatRateByCategory(companyId, "EXEMPT");

    const inv = createInvoice({
      companyId, contactId: customer.id, date: d("2026-04-05"), userId,
      lines: [{ description: "Sales", quantity: 1, unitPriceCents: 500000, accountId: sales.id, vatRateId: std.id }],
    });
    approveInvoice({ companyId, invoiceId: inv.invoiceId, userId });
    createPayment({
      companyId, direction: "RECEIVE", bankAccountId: bankAcct.id, contactId: customer.id,
      date: d("2026-04-10"), amountCents: 615000, allocations: [{ invoiceId: inv.invoiceId, amountCents: 615000 }], userId,
    });

    const bill = createBill({
      companyId, contactId: supplier.id, date: d("2026-04-08"), userId,
      lines: [
        { description: "Stock", quantity: 1, unitPriceCents: 150000, accountId: purchases.id, vatRateId: std.id },
        { description: "Rent", quantity: 1, unitPriceCents: 80000, accountId: rent.id, vatRateId: exempt.id },
      ],
    });
    approveBill({ companyId, billId: bill.billId, userId });

    const pnl = profitAndLoss(companyId, d("2026-04-01"), d("2026-04-30"));
    expect(pnl.revenue.totalCents).toBe(500000);
    expect(pnl.costOfSales.totalCents).toBe(150000);
    expect(pnl.grossProfitCents).toBe(350000);
    expect(pnl.operatingExpenses.totalCents).toBe(80000);
    expect(pnl.netProfitCents).toBe(270000);

    const bs = balanceSheet(companyId, d("2026-04-30"));
    expect(bs.balances).toBe(true);
    expect(bs.netAssetsCents).toBe(270000); // no equity postings, so net assets = cumulative profit

    const tb = trialBalance(companyId, d("2026-04-30"));
    expect(tb.totalDebit).toBe(tb.totalCredit);

    // drill-down: bank activity shows the lodgement with running balance
    const activity = accountActivity(companyId, accountByCode(companyId, "1000").id);
    expect(activity.closingCents).toBe(615000);
    expect(activity.lines.length).toBe(1);
  });
});

describe("fingerprints", () => {
  it("normalises descriptions but keeps distinct days distinct", () => {
    const a = txnFingerprint(d("2026-03-01"), -450, "COSTA COFFEE  DUBLIN");
    const b = txnFingerprint(d("2026-03-01"), -450, "costa coffee dublin");
    const c = txnFingerprint(d("2026-03-02"), -450, "COSTA COFFEE DUBLIN");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
