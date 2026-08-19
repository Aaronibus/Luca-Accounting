// Isolated demo dataset — "Cara Coffee Roasters Ltd", a fictional Kilkenny
// roastery with eight months of 2026 trading, partially reconciled banking,
// finalised VAT returns, planted anomalies and live AI-suggestion material.
//
// This is the ONLY place demo data exists. It is applied to exactly one
// company (flagged isDemo) and never leaks into companies created normally:
// provisionCompany() creates configuration only.

import { db, tables } from "@/db";
import { eq, and } from "drizzle-orm";
import { createInvoice, createBill, createExpense } from "@/lib/services/documents";
import { approveInvoice, approveBill, approveExpense, matchBankTransactionToDocuments, categoriseBankTransaction, matchTransfer } from "@/lib/engine/posting";
import { postJournal } from "@/lib/engine/journal";
import { importBankTransactions, reconcileTransactions } from "@/lib/services/banking";
import { prepareVatReturn, finaliseVatReturn } from "@/lib/engine/vat";
import { generateBankSuggestions } from "@/lib/ai/categorise";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

/** Populate an (empty, freshly provisioned) company with the demo dataset. */
export function seedDemoData(opts: { companyId: string; ownerId: string; accountantId?: string }) {
  const companyId = opts.companyId;
  const uid = opts.ownerId;
  const accountantId = opts.accountantId ?? opts.ownerId;


  // ── lookups ──
  const acct = (code: string) => db.select().from(tables.accounts).where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.code, code))).get()!;
  const rate = (cat: string) => db.select().from(tables.vatRates).where(and(eq(tables.vatRates.companyId, companyId), eq(tables.vatRates.category, cat))).get()!;
  const STD = rate("STANDARD").id, RED = rate("REDUCED").id, SEC = rate("SECOND_REDUCED").id, ZERO = rate("ZERO").id, EX = rate("EXEMPT").id;
  const SALES = acct("4000").id, SALES_SVC = acct("4100").id, PURCH = acct("5000").id, FREIGHT = acct("5200").id;
  const RENT = acct("6000").id, INS = acct("6020").id, POWER = acct("6100").id, PHONE = acct("6200").id, SOFT = acct("6300").id,
    MKT = acct("6400").id, MOTOR = acct("6500").id, TRAVEL = acct("6510").id, OFFICE = acct("6600").id, REPAIRS = acct("6700").id,
    PROF = acct("6800").id, BANKF = acct("6900").id, WAGES = acct("7000").id, PRSI = acct("7010").id;

  // ── bank accounts ──
  const currentGl = acct("1000");
  const savingsGl = db.insert(tables.accounts).values({ companyId, code: "1010", name: "Deposit Account", type: "ASSET", subtype: "BANK" }).returning().get();
  const current = db.insert(tables.bankAccounts).values({
    companyId, name: "AIB Current Account", accountId: currentGl.id, bank: "AIB", ibanMasked: "IE29 AIBK •••• 3841",
    openingBalanceCents: 2_500_000, openingBalanceDate: d("2026-01-01"),
  }).returning().get();
  const savings = db.insert(tables.bankAccounts).values({
    companyId, name: "AIB Deposit Account", accountId: savingsGl.id, bank: "AIB", ibanMasked: "IE29 AIBK •••• 9905",
    openingBalanceCents: 0, openingBalanceDate: d("2026-01-01"),
  }).returning().get();

  // Opening balances journal: bank 25,000 / share capital 100 / retained earnings 24,900
  postJournal({
    companyId, date: d("2026-01-01"), description: "Opening balances", sourceType: "OPENING_BALANCE", userId: uid,
    lines: [
      { accountId: currentGl.id, debitCents: 2_500_000, description: "Opening bank balance" },
      { accountId: acct("3000").id, creditCents: 10_000, description: "Share capital" },
      { accountId: acct("3100").id, creditCents: 2_490_000, description: "Retained earnings b/fwd" },
    ],
  });

  // ── contacts ──
  const customer = (name: string, email: string, county: string, terms = 30) =>
    db.insert(tables.contacts).values({ companyId, type: "CUSTOMER", name, email, county, paymentTermsDays: terms, defaultAccountId: SALES, defaultVatRateId: STD }).returning().get();
  const supplier = (name: string, email: string | null, accountId?: string, vatRateId?: string) =>
    db.insert(tables.contacts).values({ companyId, type: "SUPPLIER", name, email: email ?? undefined, paymentTermsDays: 30, defaultAccountId: accountId, defaultVatRateId: vatRateId }).returning().get();

  const cGrainne = customer("Gráinne's Café", "hello@grainnescafe.ie", "Co. Kilkenny", 14);
  const cNoble = customer("Noble Rot Wine Bar", "accounts@noblerot.ie", "Co. Carlow");
  const cAvoca = customer("Avondale Food Hall", "ap@avondalefoodhall.ie", "Co. Wicklow");
  const cHarbour = customer("Harbour Hotel Group", "accounts@harbourhotels.ie", "Co. Waterford", 45);
  const cBrew = customer("Brew & Bloom", "orders@brewandbloom.ie", "Co. Kilkenny", 14);
  const cSilk = customer("Silken Thomas Bistro", "manager@silkenthomas.ie", "Co. Kildare");
  const cMarket = customer("Market Lane Deli", "info@marketlanedeli.ie", "Co. Cork");
  const cOnline = customer("Web Shop Sales", "shop@caracoffee.ie", "Co. Kilkenny", 0);

  const sBeans = supplier("Origin Green Imports Ltd", "sales@origingreen.ie", PURCH, STD);
  const sPack = supplier("Kilkenny Packaging Co", "orders@kkpackaging.ie", PURCH, STD);
  const sESB = supplier("Electric Ireland", null, POWER, SEC);
  const sVoda = supplier("Vodafone Ireland", null, PHONE, STD);
  const sLandlord = supplier("Butler Estates Ltd", "rent@butlerestates.ie", RENT, EX);
  const sAxa = supplier("AXA Insurance", null, INS, EX);
  const sKelly = supplier("Kelly & Co Accountants", "maire@kellyaccountants.ie", PROF, STD);
  const sFreight = supplier("Fastway Couriers", null, FREIGHT, STD);
  const sMachine = supplier("Espresso Solutions Ireland", "service@espressosolutions.ie", REPAIRS, RED);
  const sAds = supplier("Meta Platforms Ireland", null, MKT, STD);

  // ── trading pattern: monthly invoices & bills Jan–Aug ──
  interface Sale { c: typeof cGrainne; day: string; lines: Array<[string, number, number, string, string]> } // desc, qty, unit, acct, vat
  const invoiceIds: Array<{ id: string; total: number; contact: typeof cGrainne; date: string; number: string }> = [];

  const monthlyWholesale: Array<[typeof cGrainne, number]> = [
    [cGrainne, 204000], [cNoble, 126000], [cAvoca, 288000], [cHarbour, 555000], [cBrew, 115500], [cSilk, 162000],
  ];

  const mk = (n: number) => String(n).padStart(2, "0");
  for (let m = 1; m <= 8; m++) {
    for (const [cust, base] of monthlyWholesale) {
      // slight seasonal variation, deterministic
      const wobble = 1 + 0.12 * Math.sin(m + base % 7) ;
      const unit = Math.round((base * wobble) / 10) * 10;
      if (m === 8 && cust === cSilk) continue; // Silken Thomas paused orders in Aug
      const date = `2026-${mk(m)}-${mk(3 + (base % 5))}`;
      const r = createInvoice({
        companyId, contactId: cust.id, date: d(date), userId: uid,
        lines: [
          { description: "Wholesale coffee — house blend (kg)", quantity: 1, unitPriceCents: unit, accountId: SALES, vatRateId: STD },
          ...(m % 3 === 0 ? [{ description: "Barista training session", quantity: 1, unitPriceCents: 18000, accountId: SALES_SVC, vatRateId: STD }] : []),
        ],
      });
      approveInvoice({ companyId, invoiceId: r.invoiceId, userId: uid });
      invoiceIds.push({ id: r.invoiceId, total: r.totalCents, contact: cust, date, number: r.number });
    }
    // web shop: one consolidated invoice per month
    const web = createInvoice({
      companyId, contactId: cOnline.id, date: d(`2026-${mk(m)}-28`), userId: uid,
      lines: [{ description: "Online retail sales (consolidated)", quantity: 1, unitPriceCents: 480000 + m * 12000, accountId: SALES, vatRateId: STD }],
    });
    approveInvoice({ companyId, invoiceId: web.invoiceId, userId: uid });
    invoiceIds.push({ id: web.invoiceId, total: web.totalCents, contact: cOnline, date: `2026-${mk(m)}-28`, number: web.number });
  }

  // Market Lane: two invoices in July that will be paid together (AI combo-match demo)
  const ml1 = createInvoice({ companyId, contactId: cMarket.id, date: d("2026-07-06"), userId: uid,
    lines: [{ description: "Wholesale coffee — dark roast", quantity: 1, unitPriceCents: 52000, accountId: SALES, vatRateId: STD }] });
  approveInvoice({ companyId, invoiceId: ml1.invoiceId, userId: uid });
  const ml2 = createInvoice({ companyId, contactId: cMarket.id, date: d("2026-07-20"), userId: uid,
    lines: [{ description: "Wholesale coffee — decaf", quantity: 1, unitPriceCents: 31000, accountId: SALES, vatRateId: STD }] });
  approveInvoice({ companyId, invoiceId: ml2.invoiceId, userId: uid });

  // ── bills ──
  const billIds: Array<{ id: string; total: number; contact: typeof sBeans; date: string; number: string }> = [];
  const addBill = (s: typeof sBeans, date: string, lines: Array<{ description: string; unitPriceCents: number; accountId: string; vatRateId: string }>, ref?: string, approve = true) => {
    const r = createBill({
      companyId, contactId: s.id, date: d(date), supplierRef: ref, userId: uid,
      lines: lines.map((l) => ({ ...l, quantity: 1 })),
    });
    if (approve) approveBill({ companyId, billId: r.billId, userId: uid });
    billIds.push({ id: r.billId, total: r.totalCents, contact: s, date, number: r.number });
    return r;
  };

  for (let m = 1; m <= 8; m++) {
    addBill(sBeans, `2026-${mk(m)}-04`, [{ description: "Green beans — Huila, Colombia (300kg)", unitPriceCents: 590000 + m * 8000, accountId: PURCH, vatRateId: ZERO }], `OGI-2026-${100 + m}`);
    addBill(sPack, `2026-${mk(m)}-09`, [{ description: "Retail bags, labels & boxes", unitPriceCents: 42000, accountId: PURCH, vatRateId: STD }], `KP-${400 + m}`);
    addBill(sLandlord, `2026-${mk(m)}-01`, [{ description: "Unit 7 roastery rent", unitPriceCents: 180000, accountId: RENT, vatRateId: EX }]);
    if (m <= 8) addBill(sKelly, `2026-${mk(m)}-15`, [{ description: "Monthly bookkeeping retainer", unitPriceCents: 25000, accountId: PROF, vatRateId: STD }], `KC-${m}/26`);
    if (m % 2 === 1) addBill(sFreight, `2026-${mk(m)}-18`, [{ description: "Wholesale deliveries", unitPriceCents: 28000, accountId: FREIGHT, vatRateId: STD }]);
  }
  // Machine service in March — plus the PLANTED DUPLICATE (same ref, same amount, 4 days apart)
  addBill(sMachine, "2026-03-10", [{ description: "Roaster annual service", unitPriceCents: 68000, accountId: REPAIRS, vatRateId: RED }], "ESI-8841");
  addBill(sMachine, "2026-03-14", [{ description: "Roaster annual service", unitPriceCents: 68000, accountId: REPAIRS, vatRateId: RED }], "ESI-8841");
  // Unusually large repairs bill in July (anomaly demo): new burner assembly
  addBill(sMachine, "2026-07-22", [{ description: "Roaster burner assembly replacement", unitPriceCents: 480000, accountId: REPAIRS, vatRateId: RED }], "ESI-9204");
  // AXA annual insurance in Jan
  addBill(sAxa, "2026-01-08", [{ description: "Combined business insurance 2026", unitPriceCents: 310000, accountId: INS, vatRateId: EX }], "AXA-77120");
  // Meta ads — awaiting approval (draft) in July & Aug (VAT exception demo)
  addBill(sAds, "2026-07-28", [{ description: "Instagram campaign — Iced range", unitPriceCents: 45000, accountId: MKT, vatRateId: STD }], undefined, false);
  addBill(sAds, "2026-08-12", [{ description: "Instagram campaign — Autumn blend", unitPriceCents: 52000, accountId: MKT, vatRateId: STD }], undefined, false);

  // ── expenses ──
  const expenseSpecs: Array<[string, string, string, string, number, ("BANK" | "PERSONAL")]> = [
    ["Circle K Kilkenny", "Diesel — delivery van", "2026-06-03", MOTOR, 8900, "BANK"],
    ["Irish Rail", "Dublin — SCA trade show", "2026-06-11", TRAVEL, 4550, "PERSONAL"],
    ["Easons", "Office stationery", "2026-07-02", OFFICE, 4599, "PERSONAL"],
    ["Easons", "Office stationery", "2026-07-05", OFFICE, 4599, "PERSONAL"], // planted duplicate
    ["Woodies", "Shelving for roastery", "2026-07-19", REPAIRS, 15600, "BANK"],
    ["An Post", "Sample shipping", "2026-08-04", OFFICE, 2350, "PERSONAL"],
  ];
  for (const [merchant, desc, date, accountId, gross, via] of expenseSpecs) {
    const vatRateId = merchant === "Irish Rail" || merchant === "An Post" ? EX : merchant === "Woodies" ? RED : STD;
    const e = createExpense({ companyId, merchant, description: desc, date: d(date), accountId, vatRateId, grossCents: gross, paidVia: via, bankAccountId: via === "BANK" ? current.id : undefined, origin: "RECEIPT_SCAN", userId: uid });
    // approve all but the August one (leave one in the review queue)
    if (date < "2026-08-01") approveExpense({ companyId, expenseId: e.expenseId, userId: uid });
  }

  // ── payroll: monthly wages journal (Jan–Jul) ──
  for (let m = 1; m <= 7; m++) {
    postJournal({
      companyId, date: d(`2026-${mk(m)}-26`), description: `Payroll ${d(`2026-${mk(m)}-01`).toLocaleString("en-IE", { month: "long", timeZone: "UTC" })} 2026`, sourceType: "MANUAL", userId: uid,
      lines: [
        { accountId: WAGES, debitCents: 420000, description: "Gross wages" },
        { accountId: PRSI, debitCents: 46000, description: "Employer PRSI" },
        { accountId: currentGl.id, creditCents: 355000, description: "Net pay" },
        { accountId: acct("2200").id, creditCents: 111000, description: "PAYE/PRSI due to Revenue" },
      ],
    });
  }

  // ── bank feed ──
  // Everything the business did shows up here; we then match most of it.
  type FeedRow = { date: string; description: string; amountCents: number; ref?: string };
  const feed: FeedRow[] = [];

  // Customer receipts: pay all invoices dated before July; leave some recent open
  const openInvoiceNumbers = new Set<string>();
  for (const inv of invoiceIds) {
    const isHarbour = inv.contact.id === cHarbour.id;
    const payDelay = isHarbour ? 50 : 18; // Harbour Hotel pays late (aged debtors demo)
    const payDate = new Date(d(inv.date).getTime() + payDelay * 86_400_000);
    const cutoff = d("2026-08-19");
    if (payDate <= cutoff && !(isHarbour && inv.date >= "2026-06-01")) {
      feed.push({
        date: payDate.toISOString().slice(0, 10),
        description: `${inv.contact.name.toUpperCase().replace(/[^A-Z ]/g, "")} ${inv.number}`,
        amountCents: inv.total,
      });
    } else {
      openInvoiceNumbers.add(inv.number);
    }
  }
  // Market Lane combined payment (arrives in feed, unmatched → AI combo suggestion)
  feed.push({ date: "2026-08-14", description: "MARKET LANE DELI", amountCents: ml1.totalCents + ml2.totalCents });

  // Supplier payments: pay all bills dated before July 15 (skip the duplicate ESI-8841 second copy — it stays owing)
  const dupBillId = billIds.filter((b) => b.contact.id === sMachine.id && b.date === "2026-03-14")[0]?.id;
  for (const bill of billIds) {
    if (bill.id === dupBillId) continue;
    if (bill.date >= "2026-07-15") continue;
    const payDate = new Date(d(bill.date).getTime() + 12 * 86_400_000);
    feed.push({
      date: payDate.toISOString().slice(0, 10),
      description: `${bill.contact.name.toUpperCase().replace(/[^A-Z ]/g, "")}`,
      amountCents: -bill.total,
    });
  }

  // Payroll + PAYE payments
  for (let m = 1; m <= 7; m++) {
    feed.push({ date: `2026-${mk(m)}-26`, description: "PAYROLL NET PAY BATCH", amountCents: -355000 });
    if (m >= 2) feed.push({ date: `2026-${mk(m)}-21`, description: "REVENUE PAYE/PRSI ROS", amountCents: -111000 });
  }

  // Direct-debit utilities & recurring (to be categorised directly)
  for (let m = 1; m <= 8; m++) {
    if (m % 2 === 1) feed.push({ date: `2026-${mk(m)}-11`, description: "ELECTRIC IRELAND DD", amountCents: -(38000 + m * 900) });
    feed.push({ date: `2026-${mk(m)}-06`, description: "VODAFONE IRELAND DD", amountCents: -9840 });
    feed.push({ date: `2026-${mk(m)}-14`, description: "AWS EMEA", amountCents: -6200 });
    if (m <= 7) feed.push({ date: `2026-${mk(m)}-30`, description: "FEES QUARTERLY MAINTAIN", amountCents: -1250 });
  }
  // Circle K diesel expense (bank-paid) appears in feed
  feed.push({ date: "2026-06-03", description: "CIRCLE K KILKENNY", amountCents: -8900 });
  feed.push({ date: "2026-07-19", description: "WOODIES KILKENNY", amountCents: -15600 });

  // Transfers to deposit account (quarterly savings)
  for (const [dt] of [["2026-03-31"], ["2026-06-30"]] as const) {
    feed.push({ date: dt, description: "TFR TO DEPOSIT A/C", amountCents: -1000000 });
  }

  // VAT payments for finalised periods (paid on due date)
  // (amount computed after finalisation — placeholder handled below)

  // Recent unexplained activity for the AI demo (mid-Aug)
  feed.push({ date: "2026-08-10", description: "ELECTRIC IRELAND DD", amountCents: -41200 });
  feed.push({ date: "2026-08-11", description: "SUMUP PAYOUT 8842", amountCents: 84350 });
  feed.push({ date: "2026-08-12", description: "STRIPE TRANSFER", amountCents: 12980 * 10 });
  feed.push({ date: "2026-08-13", description: "ZETTLE BY PAYPAL", amountCents: 45210 });
  feed.push({ date: "2026-08-15", description: "APPLEGREEN M9 SOUTH", amountCents: -7240 });
  feed.push({ date: "2026-08-16", description: "AXA INSURANCE DD", amountCents: -28900 });
  feed.push({ date: "2026-08-17", description: "SQSP* SQUARESPACE", amountCents: -2800 });

  // Import current-account feed
  const sortedFeed = feed.sort((a, b) => a.date.localeCompare(b.date));
  importBankTransactions({
    companyId, bankAccountId: current.id, userId: uid,
    rows: sortedFeed.map((f) => ({ date: d(f.date), description: f.description, amountCents: f.amountCents })),
  });
  // Deposit account feed: the two incoming transfers
  importBankTransactions({
    companyId, bankAccountId: savings.id, userId: uid,
    rows: [
      { date: d("2026-03-31"), description: "TFR FROM CURRENT A/C", amountCents: 1000000 },
      { date: d("2026-06-30"), description: "TFR FROM CURRENT A/C", amountCents: 1000000 },
    ],
  });

  // ── match the historical feed ──
  const allTxns = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, current.id)).all();
  const savTxns = db.select().from(tables.bankTransactions).where(eq(tables.bankTransactions.bankAccountId, savings.id)).all();

  const invByAmount = new Map<number, typeof invoiceIds>();
  for (const inv of invoiceIds) {
    const arr = invByAmount.get(inv.total) ?? [];
    arr.push(inv);
    invByAmount.set(inv.total, arr);
  }
  const billByAmount = new Map<number, typeof billIds>();
  for (const b of billIds) {
    if (b.id === dupBillId) continue;
    const arr = billByAmount.get(b.total) ?? [];
    arr.push(b);
    billByAmount.set(b.total, arr);
  }

  const leaveUnmatchedAfter = d("2026-08-01").getTime();
  const toReconcile: string[] = [];

  for (const txn of allTxns) {
    const when = new Date(txn.date).getTime();
    const isRecent = when >= leaveUnmatchedAfter;
    if (isRecent) continue; // leave August for the AI inbox

    if (txn.amountCents > 0) {
      const pool = invByAmount.get(txn.amountCents);
      const inv = pool?.find((i) => {
        const row = db.select().from(tables.invoices).where(eq(tables.invoices.id, i.id)).get()!;
        return row.totalCents - row.paidCents === txn.amountCents;
      });
      if (inv) {
        matchBankTransactionToDocuments({
          companyId, bankTransactionId: txn.id, contactId: inv.contact.id,
          allocations: [{ invoiceId: inv.id, amountCents: txn.amountCents }], userId: uid,
        });
        toReconcile.push(txn.id);
        continue;
      }
    } else {
      const abs = Math.abs(txn.amountCents);
      const pool = billByAmount.get(abs);
      const bill = pool?.find((b) => {
        const row = db.select().from(tables.bills).where(eq(tables.bills.id, b.id)).get()!;
        return row.status === "APPROVED" && row.totalCents - row.paidCents === abs;
      });
      if (bill) {
        matchBankTransactionToDocuments({
          companyId, bankTransactionId: txn.id, contactId: bill.contact.id,
          allocations: [{ billId: bill.id, amountCents: abs }], userId: uid,
        });
        toReconcile.push(txn.id);
        continue;
      }
    }

    // direct categorisations
    const desc = txn.description;
    const gross = Math.abs(txn.amountCents);
    const direct = (accountId: string, vatRateId: string | undefined, vatCents: number, contactId?: string) => {
      categoriseBankTransaction({ companyId, bankTransactionId: txn.id, accountId, vatRateId, vatCents, contactId, userId: uid });
      toReconcile.push(txn.id);
    };
    if (/ELECTRIC IRELAND/.test(desc)) { direct(POWER, SEC, Math.round((gross * 900) / 10900), sESB.id); continue; }
    if (/VODAFONE/.test(desc)) { direct(PHONE, STD, Math.round((gross * 2300) / 12300), sVoda.id); continue; }
    if (/AWS EMEA/.test(desc)) { direct(SOFT, STD, 0, undefined); continue; }
    if (/FEES QUARTERLY/.test(desc)) { direct(BANKF, EX, 0); continue; }
    if (/PAYROLL NET PAY/.test(desc)) {
      // net pay already posted by the payroll journal → match: create a bank journal against wages control…
      // Simplest correct treatment: the payroll journal already credited the bank GL, so this feed line matches that journal.
      db.update(tables.bankTransactions).set({ status: "MATCHED", matchType: "DIRECT" }).where(eq(tables.bankTransactions.id, txn.id)).run();
      toReconcile.push(txn.id);
      continue;
    }
    if (/REVENUE PAYE/.test(desc)) { direct(acct("2200").id, EX, 0); continue; }
    if (/CIRCLE K|WOODIES/.test(desc)) {
      // bank-paid expenses were posted on approval (credited bank GL) → treat feed line as matched to that journal
      db.update(tables.bankTransactions).set({ status: "MATCHED", matchType: "DIRECT" }).where(eq(tables.bankTransactions.id, txn.id)).run();
      toReconcile.push(txn.id);
      continue;
    }
    if (/TFR TO DEPOSIT/.test(desc)) {
      const pair = savTxns.find((s) => s.amountCents === -txn.amountCents && Math.abs(new Date(s.date).getTime() - when) < 2 * 86_400_000);
      if (pair) {
        matchTransfer({ companyId, outTransactionId: txn.id, inTransactionId: pair.id, userId: uid });
        toReconcile.push(txn.id, pair.id);
      }
      continue;
    }
    // anything else pre-August stays unmatched (reconciliation demo)
  }

  // Reconcile matched items up to 30 June (leave July matched-but-unreconciled)
  const reconcilable = db.select().from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.bankAccountId, current.id), eq(tables.bankTransactions.status, "MATCHED")))
    .all()
    .filter((t) => new Date(t.date).getTime() <= d("2026-06-30").getTime())
    .map((t) => t.id);
  reconcileTransactions({ companyId, transactionIds: reconcilable, userId: uid });

  // ── bank rule (demo) ──
  db.insert(tables.bankRules).values({
    companyId, name: "SumUp card payouts → Sales", matchMode: "CONTAINS", matchText: "SUMUP PAYOUT",
    direction: "IN", setAccountId: SALES, setVatRateId: STD, priority: 10,
  }).run();

  // ── VAT returns: Jan–Feb and Mar–Apr finalised; May–Jun draft ──
  const vatPayable = db.select().from(tables.accounts).where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, "VAT_PAYABLE"))).get()!;
  const payVat = (amount: number, payDate: string) => {
    if (amount <= 0) return;
    importBankTransactions({
      companyId, bankAccountId: current.id, userId: uid,
      rows: [{ date: d(payDate), description: "REVENUE VAT3 ROS", amountCents: -amount }],
    });
    const vt = db.select().from(tables.bankTransactions)
      .where(and(eq(tables.bankTransactions.bankAccountId, current.id), eq(tables.bankTransactions.status, "UNRECONCILED")))
      .all()
      .find((t) => t.amountCents === -amount && t.description === "REVENUE VAT3 ROS");
    if (vt) {
      categoriseBankTransaction({ companyId, bankTransactionId: vt.id, accountId: vatPayable.id, vatCents: 0, userId: uid });
      reconcileTransactions({ companyId, transactionIds: [vt.id], userId: uid });
    }
  };

  const r1 = prepareVatReturn({ companyId, periodStart: d("2026-01-01"), periodEnd: new Date(Date.UTC(2026, 1, 28, 23, 59, 59)), userId: accountantId });
  const f1 = finaliseVatReturn({ companyId, vatReturnId: r1.id, userId: accountantId });
  payVat(f1.t3Cents, "2026-03-21"); // pay before the next period locks March
  const r2 = prepareVatReturn({ companyId, periodStart: d("2026-03-01"), periodEnd: new Date(Date.UTC(2026, 3, 30, 23, 59, 59)), userId: accountantId });
  const f2 = finaliseVatReturn({ companyId, vatReturnId: r2.id, userId: accountantId });
  payVat(f2.t3Cents, "2026-05-21");
  prepareVatReturn({ companyId, periodStart: d("2026-05-01"), periodEnd: new Date(Date.UTC(2026, 5, 30, 23, 59, 59)), userId: accountantId });

  // ── generate AI suggestions for the outstanding August items ──
  generateBankSuggestions(companyId);

  // ── a couple of quotes/queries flavour: audit note ──
  return {
    vatJanFeb: { t1Cents: f1.t1Cents, t2Cents: f1.t2Cents, t3Cents: f1.t3Cents },
    vatMarApr: { t1Cents: f2.t1Cents, t2Cents: f2.t2Cents, t3Cents: f2.t3Cents },
  };
}
