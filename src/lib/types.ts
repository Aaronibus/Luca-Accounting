// Canonical enum values (SQLite stores text; these are the only legal values)

export const ROLES = ["OWNER", "ADMIN", "ACCOUNTANT", "BOOKKEEPER", "EMPLOYEE", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

/** Capability map — what each role can do. Enforced in the data-access layer. */
export const CAPABILITIES = {
  OWNER: ["view", "edit", "approve", "post", "reconcile", "vat", "lock", "admin", "ai"],
  ADMIN: ["view", "edit", "approve", "post", "reconcile", "vat", "lock", "admin", "ai"],
  ACCOUNTANT: ["view", "edit", "approve", "post", "reconcile", "vat", "lock", "ai"],
  BOOKKEEPER: ["view", "edit", "approve", "post", "reconcile", "ai"],
  EMPLOYEE: ["view_own", "submit_expense"],
  VIEWER: ["view"],
} as const;
export type Capability =
  | "view" | "view_own" | "edit" | "approve" | "post" | "reconcile"
  | "vat" | "lock" | "admin" | "ai" | "submit_expense";

export function roleCan(role: Role, cap: Capability): boolean {
  return (CAPABILITIES[role] as readonly string[]).includes(cap);
}

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_SUBTYPES = [
  "CURRENT_ASSET", "FIXED_ASSET", "BANK", "ACCOUNTS_RECEIVABLE",
  "CURRENT_LIABILITY", "ACCOUNTS_PAYABLE", "VAT", "LONG_TERM_LIABILITY",
  "EQUITY", "REVENUE", "OTHER_INCOME", "COST_OF_SALES", "OPERATING_EXPENSE",
  "DEPRECIATION", "FINANCE_COST",
] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];

export const SYSTEM_KEYS = [
  "ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE", "VAT_CONTROL", "VAT_PAYABLE",
  "RETAINED_EARNINGS", "ROUNDING", "SUSPENSE", "OWNER_DRAWINGS", "DIRECTORS_LOAN",
] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

export const VAT_CATEGORIES = [
  "STANDARD", "REDUCED", "SECOND_REDUCED", "LIVESTOCK", "ZERO", "EXEMPT", "OUTSIDE_SCOPE",
] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

export const JOURNAL_SOURCES = [
  "INVOICE", "CREDIT_NOTE", "BILL", "SUPPLIER_CREDIT", "PAYMENT", "EXPENSE",
  "BANK", "TRANSFER", "MANUAL", "OPENING_BALANCE", "YEAR_END", "VAT_RETURN",
  "DEPRECIATION", "REVERSAL",
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export type JournalStatus = "DRAFT" | "POSTED" | "REVERSED";
export type InvoiceStatus = "DRAFT" | "AWAITING_APPROVAL" | "APPROVED" | "SENT" | "PAID" | "VOID";
export type BillStatus = "DRAFT" | "AWAITING_APPROVAL" | "APPROVED" | "PAID" | "VOID";
export type ExpenseStatus = "DRAFT" | "APPROVED" | "VOID";
export type BankTxnStatus = "UNRECONCILED" | "MATCHED" | "RECONCILED" | "EXCLUDED";
export type SuggestionStatus = "SUGGESTED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
export type VatReturnStatus = "DRAFT" | "REVIEW" | "FINALISED";

export const SUGGESTION_KINDS = [
  "CATEGORISATION", "MATCH", "TRANSFER", "DUPLICATE", "ANOMALY",
  "VAT_EXCEPTION", "MISSING_RECURRING", "RECONCILIATION",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** Which normal balance side each account type carries. */
export const NORMAL_SIDE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  INCOME: "CREDIT",
};
