// Lúca — accounting data model (Drizzle / SQLite, portable to Postgres)
// Conventions:
//  - All money is integer cents (EUR). Never floats.
//  - VAT rates are basis points (2300 = 23.00%).
//  - Enum-like fields are text validated at the boundary; canonical values in src/lib/types.ts.
//  - Posted journals are immutable: corrections happen via reversal journals.

import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { randomUUID } from "crypto";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date());

const date = (name: string) => integer(name, { mode: "timestamp_ms" });

// ───────────────────────── Identity & tenancy ─────────────────────────

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const organisations = sqliteTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  type: text("type").notNull().default("BUSINESS"), // BUSINESS | PRACTICE
  ownerUserId: text("owner_user_id"),
  createdAt: createdAt(),
});

export const companies = sqliteTable(
  "companies",
  {
    id: id(),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id),
    name: text("name").notNull(),
    tradingName: text("trading_name"),
    croNumber: text("cro_number"),
    vatNumber: text("vat_number"),
    vatBasis: text("vat_basis").notNull().default("INVOICE"), // INVOICE | CASH
    vatPeriodMonths: integer("vat_period_months").notNull().default(2),
    yearEndMonth: integer("year_end_month").notNull().default(12),
    yearEndDay: integer("year_end_day").notNull().default(31),
    baseCurrency: text("base_currency").notNull().default("EUR"),
    // SOLE_TRADER | LIMITED_COMPANY | PARTNERSHIP | CHARITY | OTHER
    entityType: text("entity_type").notNull().default("LIMITED_COMPANY"),
    industry: text("industry"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    county: text("county"),
    eircode: text("eircode"),
    country: text("country").notNull().default("IE"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({ orgIdx: index("companies_org_idx").on(t.organisationId) })
);

export const memberships = sqliteTable(
  "memberships",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    // OWNER | ADMIN | ACCOUNTANT | BOOKKEEPER | EMPLOYEE | VIEWER
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex("memberships_user_company").on(t.userId, t.companyId),
    companyIdx: index("memberships_company_idx").on(t.companyId),
  })
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    userId: text("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    before: text("before"), // JSON
    after: text("after"), // JSON
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => ({
    companyIdx: index("audit_company_created").on(t.companyId, t.createdAt),
    entityIdx: index("audit_entity").on(t.companyId, t.entityType, t.entityId),
  })
);

// ───────────────────────── General ledger ─────────────────────────

export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    // ASSET | LIABILITY | EQUITY | INCOME | EXPENSE
    type: text("type").notNull(),
    // CURRENT_ASSET | FIXED_ASSET | BANK | ACCOUNTS_RECEIVABLE | CURRENT_LIABILITY |
    // ACCOUNTS_PAYABLE | VAT | LONG_TERM_LIABILITY | EQUITY | REVENUE | OTHER_INCOME |
    // COST_OF_SALES | OPERATING_EXPENSE | DEPRECIATION | FINANCE_COST
    subtype: text("subtype").notNull(),
    // ACCOUNTS_RECEIVABLE | ACCOUNTS_PAYABLE | VAT_CONTROL | VAT_PAYABLE |
    // RETAINED_EARNINGS | ROUNDING | SUSPENSE | OWNER_DRAWINGS
    systemKey: text("system_key"),
    description: text("description"),
    defaultVatRateId: text("default_vat_rate_id"),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex("accounts_company_code").on(t.companyId, t.code),
    typeIdx: index("accounts_company_type").on(t.companyId, t.type),
  })
);

export const vatRates = sqliteTable(
  "vat_rates",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    rateBps: integer("rate_bps").notNull(), // 2300 = 23%
    // STANDARD | REDUCED | SECOND_REDUCED | LIVESTOCK | ZERO | EXEMPT | OUTSIDE_SCOPE
    category: text("category").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({ companyIdx: index("vat_rates_company").on(t.companyId) })
);

export const journals = sqliteTable(
  "journals",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    journalNumber: integer("journal_number").notNull(),
    date: date("date").notNull(),
    description: text("description").notNull(),
    // INVOICE | CREDIT_NOTE | BILL | SUPPLIER_CREDIT | PAYMENT | EXPENSE | BANK |
    // TRANSFER | MANUAL | OPENING_BALANCE | YEAR_END | VAT_RETURN | DEPRECIATION | REVERSAL
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    status: text("status").notNull().default("DRAFT"), // DRAFT | POSTED | REVERSED
    postedById: text("posted_by_id"),
    postedAt: date("posted_at"),
    reversesId: text("reverses_id"),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex("journals_company_number").on(t.companyId, t.journalNumber),
    dateIdx: index("journals_company_date").on(t.companyId, t.date),
    sourceIdx: index("journals_source").on(t.companyId, t.sourceType, t.sourceId),
  })
);

export const journalLines = sqliteTable(
  "journal_lines",
  {
    id: id(),
    journalId: text("journal_id")
      .notNull()
      .references(() => journals.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    description: text("description"),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    contactId: text("contact_id"),
    vatRateId: text("vat_rate_id"),
  },
  (t) => ({
    accountIdx: index("journal_lines_account").on(t.accountId),
    journalIdx: index("journal_lines_journal").on(t.journalId),
  })
);

export const periodLocks = sqliteTable(
  "period_locks",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    lockedThrough: date("locked_through").notNull(),
    reason: text("reason").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("period_locks_company").on(t.companyId) })
);

export const numberSequences = sqliteTable(
  "number_sequences",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    key: text("key").notNull(), // INVOICE | CREDIT_NOTE | BILL | JOURNAL | PAYMENT | EXPENSE
    prefix: text("prefix").notNull().default(""),
    nextValue: integer("next_value").notNull().default(1),
  },
  (t) => ({ uniq: uniqueIndex("number_seq_company_key").on(t.companyId, t.key) })
);

// ───────────────────────── Contacts ─────────────────────────

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    type: text("type").notNull(), // CUSTOMER | SUPPLIER | BOTH
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    vatNumber: text("vat_number"),
    addressLine1: text("address_line1"),
    city: text("city"),
    county: text("county"),
    eircode: text("eircode"),
    country: text("country").notNull().default("IE"),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    defaultAccountId: text("default_account_id"),
    defaultVatRateId: text("default_vat_rate_id"),
    notes: text("notes"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    typeIdx: index("contacts_company_type").on(t.companyId, t.type),
    nameIdx: index("contacts_company_name").on(t.companyId, t.name),
  })
);

// ───────────────────────── Sales ─────────────────────────

export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    kind: text("kind").notNull().default("INVOICE"), // INVOICE | CREDIT_NOTE
    number: text("number").notNull(),
    reference: text("reference"),
    date: date("date").notNull(),
    dueDate: date("due_date").notNull(),
    // DRAFT | AWAITING_APPROVAL | APPROVED | SENT | PAID | VOID
    status: text("status").notNull().default("DRAFT"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    notes: text("notes"),
    journalId: text("journal_id"),
    voidJournalId: text("void_journal_id"),
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex("invoices_company_number").on(t.companyId, t.number),
    statusIdx: index("invoices_company_status").on(t.companyId, t.status),
    contactIdx: index("invoices_company_contact").on(t.companyId, t.contactId),
    dateIdx: index("invoices_company_date").on(t.companyId, t.date),
  })
);

export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    accountId: text("account_id").notNull(),
    vatRateId: text("vat_rate_id").notNull(),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({ invoiceIdx: index("invoice_lines_invoice").on(t.invoiceId) })
);

// ───────────────────────── Purchases ─────────────────────────

export const bills = sqliteTable(
  "bills",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id),
    kind: text("kind").notNull().default("BILL"), // BILL | SUPPLIER_CREDIT
    number: text("number").notNull(),
    supplierRef: text("supplier_ref"),
    date: date("date").notNull(),
    dueDate: date("due_date").notNull(),
    // DRAFT | AWAITING_APPROVAL | APPROVED | PAID | VOID
    status: text("status").notNull().default("DRAFT"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    vatCents: integer("vat_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    paidCents: integer("paid_cents").notNull().default(0),
    notes: text("notes"),
    journalId: text("journal_id"),
    voidJournalId: text("void_journal_id"),
    origin: text("origin").notNull().default("MANUAL"), // MANUAL | DOCUMENT_EXTRACTION
    createdById: text("created_by_id"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex("bills_company_number").on(t.companyId, t.number),
    statusIdx: index("bills_company_status").on(t.companyId, t.status),
    contactIdx: index("bills_company_contact").on(t.companyId, t.contactId),
    dateIdx: index("bills_company_date").on(t.companyId, t.date),
  })
);

export const billLines = sqliteTable(
  "bill_lines",
  {
    id: id(),
    billId: text("bill_id")
      .notNull()
      .references(() => bills.id),
    description: text("description").notNull(),
    quantity: real("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull(),
    accountId: text("account_id").notNull(),
    vatRateId: text("vat_rate_id").notNull(),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({ billIdx: index("bill_lines_bill").on(t.billId) })
);

// ───────────────────────── Payments ─────────────────────────

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: text("contact_id"),
    direction: text("direction").notNull(), // RECEIVE | SPEND
    date: date("date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    reference: text("reference"),
    bankAccountId: text("bank_account_id").notNull(),
    journalId: text("journal_id"),
    status: text("status").notNull().default("POSTED"), // DRAFT | POSTED | VOID
    createdAt: createdAt(),
  },
  (t) => ({ dateIdx: index("payments_company_date").on(t.companyId, t.date) })
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: id(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: text("invoice_id"),
    billId: text("bill_id"),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => ({
    paymentIdx: index("pay_alloc_payment").on(t.paymentId),
    invoiceIdx: index("pay_alloc_invoice").on(t.invoiceId),
    billIdx: index("pay_alloc_bill").on(t.billId),
  })
);

// ───────────────────────── Expenses ─────────────────────────

export const expenses = sqliteTable(
  "expenses",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    contactId: text("contact_id"),
    merchant: text("merchant").notNull(),
    description: text("description"),
    date: date("date").notNull(),
    accountId: text("account_id").notNull(),
    vatRateId: text("vat_rate_id").notNull(),
    netCents: integer("net_cents").notNull(),
    vatCents: integer("vat_cents").notNull(),
    grossCents: integer("gross_cents").notNull(),
    paidVia: text("paid_via").notNull().default("BANK"), // BANK | PERSONAL | CASH
    bankAccountId: text("bank_account_id"),
    status: text("status").notNull().default("DRAFT"), // DRAFT | APPROVED | VOID
    origin: text("origin").notNull().default("MANUAL"), // MANUAL | RECEIPT_SCAN
    journalId: text("journal_id"),
    submittedById: text("submitted_by_id"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()),
  },
  (t) => ({
    statusIdx: index("expenses_company_status").on(t.companyId, t.status),
    dateIdx: index("expenses_company_date").on(t.companyId, t.date),
  })
);

// ───────────────────────── Banking ─────────────────────────

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    ibanMasked: text("iban_masked"),
    bank: text("bank"),
    currency: text("currency").notNull().default("EUR"),
    openingBalanceCents: integer("opening_balance_cents").notNull().default(0),
    openingBalanceDate: date("opening_balance_date"),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("bank_accounts_company").on(t.companyId) })
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    bankAccountId: text("bank_account_id").notNull(),
    filename: text("filename"),
    importedById: text("imported_by_id"),
    rowCount: integer("row_count").notNull(),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("import_batches_company").on(t.companyId) })
);

export const bankTransactions = sqliteTable(
  "bank_transactions",
  {
    id: id(),
    bankAccountId: text("bank_account_id")
      .notNull()
      .references(() => bankAccounts.id),
    importBatchId: text("import_batch_id"),
    date: date("date").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    amountCents: integer("amount_cents").notNull(), // signed: + in, − out
    balanceCents: integer("balance_cents"),
    // UNRECONCILED | MATCHED | RECONCILED | EXCLUDED
    status: text("status").notNull().default("UNRECONCILED"),
    // INVOICE_PAYMENT | BILL_PAYMENT | DIRECT | TRANSFER
    matchType: text("match_type"),
    paymentId: text("payment_id"),
    journalId: text("journal_id"),
    transferPairId: text("transfer_pair_id"),
    contactId: text("contact_id"),
    fingerprint: text("fingerprint").notNull(),
    reconciledAt: date("reconciled_at"),
    reconciledById: text("reconciled_by_id"),
    createdAt: createdAt(),
  },
  (t) => ({
    statusIdx: index("bank_txn_account_status").on(t.bankAccountId, t.status),
    dateIdx: index("bank_txn_account_date").on(t.bankAccountId, t.date),
    fpIdx: index("bank_txn_fingerprint").on(t.bankAccountId, t.fingerprint),
  })
);

export const bankRules = sqliteTable(
  "bank_rules",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    matchMode: text("match_mode").notNull().default("CONTAINS"), // CONTAINS | STARTS_WITH | REGEX
    matchText: text("match_text").notNull(),
    direction: text("direction").notNull().default("ANY"), // IN | OUT | ANY
    minAmountCents: integer("min_amount_cents"),
    maxAmountCents: integer("max_amount_cents"),
    setContactId: text("set_contact_id"),
    setAccountId: text("set_account_id"),
    setVatRateId: text("set_vat_rate_id"),
    priority: integer("priority").notNull().default(100),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    hitCount: integer("hit_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("bank_rules_company").on(t.companyId, t.enabled) })
);

export const reconciliationSessions = sqliteTable(
  "reconciliation_sessions",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    bankAccountId: text("bank_account_id").notNull(),
    statementDate: date("statement_date").notNull(),
    statementBalanceCents: integer("statement_balance_cents").notNull(),
    ledgerBalanceCents: integer("ledger_balance_cents").notNull(),
    differenceCents: integer("difference_cents").notNull(),
    status: text("status").notNull().default("IN_PROGRESS"), // IN_PROGRESS | BALANCED | CLOSED
    explanation: text("explanation"),
    createdById: text("created_by_id"),
    closedAt: date("closed_at"),
    createdAt: createdAt(),
  },
  (t) => ({ idx: index("recon_company_bank").on(t.companyId, t.bankAccountId) })
);

// ───────────────────────── VAT ─────────────────────────

export const vatReturns = sqliteTable(
  "vat_returns",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    dueDate: date("due_date").notNull(),
    status: text("status").notNull().default("DRAFT"), // DRAFT | REVIEW | FINALISED
    t1Cents: integer("t1_cents").notNull().default(0),
    t2Cents: integer("t2_cents").notNull().default(0),
    t3Cents: integer("t3_cents").notNull().default(0),
    t4Cents: integer("t4_cents").notNull().default(0),
    e1Cents: integer("e1_cents").notNull().default(0),
    e2Cents: integer("e2_cents").notNull().default(0),
    es1Cents: integer("es1_cents").notNull().default(0),
    es2Cents: integer("es2_cents").notNull().default(0),
    pa1Cents: integer("pa1_cents").notNull().default(0),
    exceptions: text("exceptions"), // JSON
    journalId: text("journal_id"),
    finalisedById: text("finalised_by_id"),
    finalisedAt: date("finalised_at"),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex("vat_returns_period").on(t.companyId, t.periodStart, t.periodEnd),
    statusIdx: index("vat_returns_status").on(t.companyId, t.status),
  })
);

// ───────────────────────── Documents ─────────────────────────

export const documents = sqliteTable(
  "documents",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    docType: text("doc_type").notNull().default("OTHER"), // INVOICE | RECEIPT | STATEMENT | CONTRACT | OTHER
    extracted: text("extracted"), // JSON from document intelligence
    extractionStatus: text("extraction_status").notNull().default("NONE"), // PENDING | EXTRACTED | FAILED | NONE
    uploadedById: text("uploaded_by_id"),
    invoiceId: text("invoice_id"),
    billId: text("bill_id"),
    expenseId: text("expense_id"),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("documents_company").on(t.companyId) })
);

// ───────────────────────── AI ─────────────────────────

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    // CATEGORISATION | MATCH | TRANSFER | DUPLICATE | ANOMALY | VAT_EXCEPTION |
    // MISSING_RECURRING | RECONCILIATION
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    bankTransactionId: text("bank_transaction_id"),
    payload: text("payload").notNull(), // JSON proposal
    explanation: text("explanation").notNull(),
    confidence: integer("confidence").notNull(), // 0-100
    evidence: text("evidence"), // JSON [{label, href}]
    status: text("status").notNull().default("SUGGESTED"), // SUGGESTED | ACCEPTED | REJECTED | SUPERSEDED
    source: text("source").notNull().default("HEURISTIC"), // RULE | MEMORY | HEURISTIC | LLM
    actedById: text("acted_by_id"),
    actedAt: date("acted_at"),
    createdAt: createdAt(),
  },
  (t) => ({
    statusIdx: index("suggestions_status").on(t.companyId, t.status, t.kind),
    entityIdx: index("suggestions_entity").on(t.companyId, t.entityType, t.entityId),
  })
);

// ───────────────────────── Fixed assets ─────────────────────────

export const fixedAssets = sqliteTable(
  "fixed_assets",
  {
    id: id(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id),
    name: text("name").notNull(),
    assetAccountId: text("asset_account_id").notNull(),
    depreciationAccountId: text("depreciation_account_id"),
    accumulatedAccountId: text("accumulated_account_id"),
    purchaseDate: date("purchase_date").notNull(),
    costCents: integer("cost_cents").notNull(),
    method: text("method").notNull().default("STRAIGHT_LINE"), // STRAIGHT_LINE | REDUCING_BALANCE
    usefulLifeMonths: integer("useful_life_months").notNull().default(60),
    residualCents: integer("residual_cents").notNull().default(0),
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | DISPOSED
    disposedAt: date("disposed_at"),
    disposalProceedsCents: integer("disposal_proceeds_cents"),
    createdAt: createdAt(),
  },
  (t) => ({ companyIdx: index("fixed_assets_company").on(t.companyId) })
);
