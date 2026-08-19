"use server";

// Company lifecycle server actions: create (blank), try demo, switch, archive,
// update settings, opening balances, bank accounts. Every one resolves the
// acting user from the session — a client can never name a company it doesn't
// belong to.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { requireUser, requireCompany, setActiveCompany, AuthError } from "@/lib/auth";
import { AccountingError } from "@/lib/engine/journal";
import {
  createCompany,
  createDemoCompany,
  setCompanyArchived,
  updateCompanySettings,
  postOpeningBalances,
  createBankAccount,
} from "@/lib/services/companies";
import { parseEUR } from "@/lib/money";
import type { ActionResult } from "./actions";

function handle(e: unknown): ActionResult {
  if (e instanceof AccountingError || e instanceof AuthError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong — nothing was changed" };
}

export interface NewCompanyForm {
  name: string;
  tradingName?: string;
  croNumber?: string;
  entityType?: string;
  industry?: string;
  addressLine1?: string;
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
  vatNumber?: string;
  vatBasis?: "INVOICE" | "CASH";
  vatPeriodMonths?: number;
}

/** Create a brand-new EMPTY company and switch into it. */
export async function createCompanyAction(input: NewCompanyForm): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const { companyId } = createCompany({ userId: user.id, ...input });
    setActiveCompany(companyId);
    revalidatePath("/", "layout");
    return { ok: true, id: companyId, message: "Company created — your accounting file is ready" };
  } catch (e) {
    return handle(e);
  }
}

/** Provision a personal, clearly-labelled DEMO company with fictional data. */
export async function createDemoCompanyAction(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const { companyId } = createDemoCompany({ userId: user.id });
    setActiveCompany(companyId);
    revalidatePath("/", "layout");
    return { ok: true, id: companyId, message: "Demo company ready — all figures are fictional" };
  } catch (e) {
    return handle(e);
  }
}

export async function switchCompanyAction(companyId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const membership = db
      .select()
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, companyId)))
      .get();
    if (!membership) return { ok: false, error: "You do not have access to that company" };
    setActiveCompany(companyId);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return handle(e);
  }
}

export async function updateCompanySettingsAction(patch: Record<string, string | number>): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("admin");
    updateCompanySettings({ companyId: ctx.companyId, userId: ctx.user.id, patch: patch as never });
    revalidatePath("/", "layout");
    return { ok: true, message: "Company settings updated" };
  } catch (e) {
    return handle(e);
  }
}

export async function archiveCompanyAction(companyId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const membership = db
      .select()
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, companyId)))
      .get();
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { ok: false, error: "Only an owner or admin can archive a company" };
    }
    setCompanyArchived({ companyId, userId: user.id, archived: true });
    revalidatePath("/", "layout");
    return { ok: true, message: "Company archived — its data is retained but hidden" };
  } catch (e) {
    return handle(e);
  }
}

export async function unarchiveCompanyAction(companyId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const membership = db
      .select()
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, companyId)))
      .get();
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return { ok: false, error: "Only an owner or admin can restore a company" };
    }
    setCompanyArchived({ companyId, userId: user.id, archived: false });
    revalidatePath("/", "layout");
    return { ok: true, message: "Company restored" };
  } catch (e) {
    return handle(e);
  }
}

export async function createBankAccountAction(input: {
  name: string;
  bank?: string;
  ibanMasked?: string;
  openingBalance?: string;
  openingBalanceDate?: string;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("edit");
    const { bankAccountId } = createBankAccount({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      name: input.name,
      bank: input.bank,
      ibanMasked: input.ibanMasked,
      openingBalanceCents: input.openingBalance?.trim() ? parseEUR(input.openingBalance) : 0,
      openingBalanceDate: input.openingBalanceDate ? new Date(input.openingBalanceDate) : undefined,
    });
    revalidatePath("/", "layout");
    return { ok: true, id: bankAccountId, message: "Bank account added" };
  } catch (e) {
    return handle(e);
  }
}

export async function postOpeningBalancesAction(input: {
  date: string;
  lines: Array<{ accountId: string; debit: string; credit: string }>;
  balanceToRetainedEarnings?: boolean;
}): Promise<ActionResult> {
  try {
    const ctx = await requireCompany("post");
    const { journalNumber } = postOpeningBalances({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      date: new Date(input.date),
      balanceToRetainedEarnings: input.balanceToRetainedEarnings,
      lines: input.lines
        .filter((l) => l.accountId && (l.debit.trim() || l.credit.trim()))
        .map((l) => ({
          accountId: l.accountId,
          debitCents: l.debit.trim() ? parseEUR(l.debit) : 0,
          creditCents: l.credit.trim() ? parseEUR(l.credit) : 0,
        })),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Opening balances posted as journal #${journalNumber}` };
  } catch (e) {
    return handle(e);
  }
}

export async function signOutAndRedirect(): Promise<void> {
  redirect("/login");
}
