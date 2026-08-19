// Company lifecycle: create (blank), create demo (isolated sample data),
// archive, update settings, and the "is this company empty?" check that
// drives onboarding UX.
//
// INVARIANT: createCompany() provisions CONFIGURATION ONLY — Irish chart of
// accounts, VAT rates and numbering. It never writes contacts, documents,
// bank accounts, journals or any accounting activity. Sample data exists in
// exactly one place (src/lib/demo/sample-data.ts) and is applied only by
// createDemoCompany(), which flags the company isDemo.

import { db, tables } from "@/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { provisionCompany } from "@/lib/engine/setup";
import { AccountingError, postJournal } from "@/lib/engine/journal";
import { writeAudit } from "@/lib/audit";
import { Role } from "@/lib/types";
import { seedDemoData } from "@/lib/demo/sample-data";

export interface CreateCompanyInput {
  userId: string;
  name: string;
  tradingName?: string;
  croNumber?: string;
  vatNumber?: string;
  entityType?: string;
  industry?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  county?: string;
  eircode?: string;
  country?: string;
  contactEmail?: string;
  contactPhone?: string;
  yearEndMonth?: number;
  yearEndDay?: number;
  baseCurrency?: string;
  vatRegistered?: boolean;
  vatBasis?: "INVOICE" | "CASH";
  vatPeriodMonths?: number;
  /** Reuse an existing organisation (e.g. an accounting practice) instead of creating one. */
  organisationId?: string;
}

/** Create a brand-new, completely empty company owned by this user. */
export function createCompany(input: CreateCompanyInput): { companyId: string; organisationId: string } {
  const name = input.name.trim();
  if (name.length < 2) throw new AccountingError("Company name is required", "INVALID_NAME");

  return db.transaction(() => {
    let organisationId = input.organisationId;
    if (organisationId) {
      // The user must already belong to a company in that organisation
      const allowed = db
        .select({ id: tables.companies.id })
        .from(tables.companies)
        .innerJoin(tables.memberships, eq(tables.memberships.companyId, tables.companies.id))
        .where(and(eq(tables.companies.organisationId, organisationId), eq(tables.memberships.userId, input.userId)))
        .get();
      if (!allowed) throw new AccountingError("You do not have access to that organisation", "FORBIDDEN");
    } else {
      const org = db
        .insert(tables.organisations)
        .values({ name, type: "BUSINESS", ownerUserId: input.userId })
        .returning({ id: tables.organisations.id })
        .get();
      organisationId = org.id;
    }

    const { companyId } = provisionCompany({
      organisationId,
      name,
      ownerUserId: input.userId,
      tradingName: input.tradingName?.trim() || undefined,
      croNumber: input.croNumber?.trim() || undefined,
      vatNumber: input.vatRegistered === false ? undefined : input.vatNumber?.trim() || undefined,
      entityType: input.entityType,
      industry: input.industry?.trim() || undefined,
      addressLine1: input.addressLine1?.trim() || undefined,
      addressLine2: input.addressLine2?.trim() || undefined,
      city: input.city?.trim() || undefined,
      county: input.county?.trim() || undefined,
      eircode: input.eircode?.trim() || undefined,
      country: input.country || "IE",
      contactEmail: input.contactEmail?.trim() || undefined,
      contactPhone: input.contactPhone?.trim() || undefined,
      yearEndMonth: input.yearEndMonth,
      yearEndDay: input.yearEndDay,
      baseCurrency: input.baseCurrency,
      vatBasis: input.vatBasis,
      vatPeriodMonths: input.vatPeriodMonths,
      isDemo: false,
    });

    writeAudit({
      companyId,
      userId: input.userId,
      action: "company.created",
      entityType: "company",
      entityId: companyId,
      after: { name, entityType: input.entityType, vatRegistered: input.vatRegistered !== false },
      note: "Blank company — Irish chart of accounts and VAT configuration only",
    });

    return { companyId, organisationId };
  });
}

/**
 * Create a personal, isolated demo company for a user (its own organisation,
 * flagged DEMO, populated from the sample dataset). Never shared with, and
 * never copied into, real companies.
 */
export function createDemoCompany(opts: { userId: string }): { companyId: string } {
  return db.transaction(() => {
    const org = db
      .insert(tables.organisations)
      .values({ name: "Demo workspace", type: "BUSINESS", ownerUserId: opts.userId })
      .returning({ id: tables.organisations.id })
      .get();

    const { companyId } = provisionCompany({
      organisationId: org.id,
      name: "Cara Coffee Roasters Ltd",
      ownerUserId: opts.userId,
      vatNumber: "IE3412345WH",
      croNumber: "684221",
      city: "Kilkenny",
      county: "Co. Kilkenny",
      industry: "Food & beverage",
      isDemo: true,
    });

    seedDemoData({ companyId, ownerId: opts.userId });

    writeAudit({
      companyId,
      userId: opts.userId,
      action: "company.demo_created",
      entityType: "company",
      entityId: companyId,
      note: "Isolated demo company with fictional sample data",
    });

    return { companyId };
  });
}

export interface CompanySummary {
  companyId: string;
  name: string;
  tradingName: string | null;
  role: Role;
  isDemo: boolean;
  archived: boolean;
  organisationId: string;
  city: string | null;
}

/** All companies the user can access, newest activity first, demo last. */
export function listUserCompanies(userId: string, opts?: { includeArchived?: boolean }): CompanySummary[] {
  const rows = db
    .select({
      companyId: tables.companies.id,
      name: tables.companies.name,
      tradingName: tables.companies.tradingName,
      role: tables.memberships.role,
      isDemo: tables.companies.isDemo,
      archived: tables.companies.archived,
      organisationId: tables.companies.organisationId,
      city: tables.companies.city,
    })
    .from(tables.memberships)
    .innerJoin(tables.companies, eq(tables.memberships.companyId, tables.companies.id))
    .where(eq(tables.memberships.userId, userId))
    .orderBy(asc(tables.companies.name))
    .all();

  return rows
    .filter((r) => (opts?.includeArchived ? true : !r.archived))
    .sort((a, b) => Number(a.isDemo) - Number(b.isDemo)) as CompanySummary[];
}

/** Does this company have any accounting activity yet? Drives onboarding UX. */
export interface EmptinessReport {
  isEmpty: boolean;
  journals: number;
  invoices: number;
  bills: number;
  expenses: number;
  contacts: number;
  bankAccounts: number;
  bankTransactions: number;
}

export function companyEmptiness(companyId: string): EmptinessReport {
  const count = (q: { n: number } | undefined) => q?.n ?? 0;
  const journals = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.journals).where(eq(tables.journals.companyId, companyId)).get()
  );
  const invoices = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.invoices).where(eq(tables.invoices.companyId, companyId)).get()
  );
  const bills = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.bills).where(eq(tables.bills.companyId, companyId)).get()
  );
  const expenses = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.expenses).where(eq(tables.expenses.companyId, companyId)).get()
  );
  const contacts = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.contacts).where(eq(tables.contacts.companyId, companyId)).get()
  );
  const bankAccounts = count(
    db.select({ n: sql<number>`count(*)` }).from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, companyId)).get()
  );
  const bankTransactions = count(
    db
      .select({ n: sql<number>`count(*)` })
      .from(tables.bankTransactions)
      .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
      .where(eq(tables.bankAccounts.companyId, companyId))
      .get()
  );

  return {
    isEmpty: journals === 0 && invoices === 0 && bills === 0 && expenses === 0 && bankTransactions === 0,
    journals,
    invoices,
    bills,
    expenses,
    contacts,
    bankAccounts,
    bankTransactions,
  };
}

export function updateCompanySettings(opts: {
  companyId: string;
  userId: string;
  patch: Partial<{
    name: string;
    tradingName: string;
    croNumber: string;
    vatNumber: string;
    entityType: string;
    industry: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    county: string;
    eircode: string;
    country: string;
    contactEmail: string;
    contactPhone: string;
    vatBasis: "INVOICE" | "CASH";
    vatPeriodMonths: number;
    yearEndMonth: number;
    yearEndDay: number;
    baseCurrency: string;
  }>;
}) {
  const before = db.select().from(tables.companies).where(eq(tables.companies.id, opts.companyId)).get();
  if (!before) throw new AccountingError("Company not found", "NOT_FOUND");

  const patch = Object.fromEntries(
    Object.entries(opts.patch).filter(([, v]) => v !== undefined && v !== "")
  ) as Record<string, unknown>;
  if (Object.keys(patch).length === 0) return;

  db.update(tables.companies).set(patch).where(eq(tables.companies.id, opts.companyId)).run();
  writeAudit({
    companyId: opts.companyId,
    userId: opts.userId,
    action: "company.settings_updated",
    entityType: "company",
    entityId: opts.companyId,
    before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]])),
    after: patch,
  });
}

export function setCompanyArchived(opts: { companyId: string; userId: string; archived: boolean }) {
  db.update(tables.companies).set({ archived: opts.archived }).where(eq(tables.companies.id, opts.companyId)).run();
  writeAudit({
    companyId: opts.companyId,
    userId: opts.userId,
    action: opts.archived ? "company.archived" : "company.unarchived",
    entityType: "company",
    entityId: opts.companyId,
  });
}

// ───────────────────────── Opening balances ─────────────────────────

export interface OpeningBalanceLine {
  accountId: string;
  debitCents: number;
  creditCents: number;
}

/**
 * Post explicit opening balances as a single balanced OPENING_BALANCE journal.
 * Any imbalance is taken to retained earnings (the standard treatment when a
 * user enters a partial opening trial balance) — but only if they opt in.
 */
export function postOpeningBalances(opts: {
  companyId: string;
  userId: string;
  date: Date;
  lines: OpeningBalanceLine[];
  balanceToRetainedEarnings?: boolean;
}): { journalId: string; journalNumber: number } {
  const lines = opts.lines.filter((l) => l.debitCents > 0 || l.creditCents > 0);
  if (lines.length === 0) throw new AccountingError("Enter at least one opening balance", "NO_LINES");

  const totalDebit = lines.reduce((a, l) => a + l.debitCents, 0);
  const totalCredit = lines.reduce((a, l) => a + l.creditCents, 0);
  const diff = totalDebit - totalCredit;

  const journalLines = lines.map((l) => ({
    accountId: l.accountId,
    debitCents: l.debitCents,
    creditCents: l.creditCents,
    description: "Opening balance",
  }));

  if (diff !== 0) {
    if (!opts.balanceToRetainedEarnings) {
      throw new AccountingError(
        `Opening balances do not balance (debits ${(totalDebit / 100).toFixed(2)} vs credits ${(totalCredit / 100).toFixed(2)}). Enable "balance to retained earnings" or correct the figures.`,
        "UNBALANCED"
      );
    }
    const retained = db
      .select()
      .from(tables.accounts)
      .where(and(eq(tables.accounts.companyId, opts.companyId), eq(tables.accounts.systemKey, "RETAINED_EARNINGS")))
      .get();
    if (!retained) throw new AccountingError("Retained earnings account missing", "MISSING_SYSTEM_ACCOUNT");
    journalLines.push({
      accountId: retained.id,
      debitCents: diff < 0 ? -diff : 0,
      creditCents: diff > 0 ? diff : 0,
      description: "Opening balance — brought forward reserves",
    });
  }

  return postJournal({
    companyId: opts.companyId,
    date: opts.date,
    description: "Opening balances",
    sourceType: "OPENING_BALANCE",
    userId: opts.userId,
    lines: journalLines,
  });
}

/** Create a bank account (GL account + bank record) for a company. */
export function createBankAccount(opts: {
  companyId: string;
  userId: string;
  name: string;
  bank?: string;
  ibanMasked?: string;
  openingBalanceCents?: number;
  openingBalanceDate?: Date;
}): { bankAccountId: string; accountId: string } {
  const name = opts.name.trim();
  if (!name) throw new AccountingError("Bank account name is required", "INVALID_NAME");

  return db.transaction(() => {
    // Next free code in the 10xx bank range
    const existing = db
      .select({ code: tables.accounts.code })
      .from(tables.accounts)
      .where(and(eq(tables.accounts.companyId, opts.companyId), eq(tables.accounts.subtype, "BANK")))
      .all()
      .map((r) => parseInt(r.code, 10))
      .filter((n) => Number.isFinite(n));
    let code = 1000;
    while (existing.includes(code)) code += 10;

    const account = db
      .insert(tables.accounts)
      .values({
        companyId: opts.companyId,
        code: String(code),
        name,
        type: "ASSET",
        subtype: "BANK",
      })
      .returning({ id: tables.accounts.id })
      .get();

    const bank = db
      .insert(tables.bankAccounts)
      .values({
        companyId: opts.companyId,
        name,
        accountId: account.id,
        bank: opts.bank?.trim() || undefined,
        ibanMasked: opts.ibanMasked?.trim() || undefined,
        openingBalanceCents: opts.openingBalanceCents ?? 0,
        openingBalanceDate: opts.openingBalanceDate,
      })
      .returning({ id: tables.bankAccounts.id })
      .get();

    writeAudit({
      companyId: opts.companyId,
      userId: opts.userId,
      action: "bankaccount.created",
      entityType: "bank_account",
      entityId: bank.id,
      after: { name, code, openingBalanceCents: opts.openingBalanceCents ?? 0 },
    });

    return { bankAccountId: bank.id, accountId: account.id };
  });
}
