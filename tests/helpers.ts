import { db, tables } from "../src/db";
import { provisionCompany } from "../src/lib/engine/setup";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";

let counter = 0;

export function createTestCompany(name?: string) {
  counter++;
  const user = db
    .insert(tables.users)
    .values({ email: `test-${randomUUID()}@luca.ie`, name: `Tester ${counter}`, passwordHash: "x" })
    .returning({ id: tables.users.id })
    .get();
  const org = db
    .insert(tables.organisations)
    .values({ name: `Org ${counter}` })
    .returning({ id: tables.organisations.id })
    .get();
  const { companyId } = provisionCompany({
    organisationId: org.id,
    name: name ?? `Test Co ${counter}`,
    ownerUserId: user.id,
  });
  return { userId: user.id, orgId: org.id, companyId };
}

export function accountByCode(companyId: string, code: string) {
  const acct = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.code, code)))
    .get();
  if (!acct) throw new Error(`No account ${code}`);
  return acct;
}

export function vatRateByCategory(companyId: string, category: string) {
  const rate = db
    .select()
    .from(tables.vatRates)
    .where(and(eq(tables.vatRates.companyId, companyId), eq(tables.vatRates.category, category)))
    .get();
  if (!rate) throw new Error(`No VAT rate ${category}`);
  return rate;
}

export function createTestCustomer(companyId: string, name = "Acme Ltd") {
  return db
    .insert(tables.contacts)
    .values({ companyId, type: "CUSTOMER", name, paymentTermsDays: 30 })
    .returning()
    .get();
}

export function createTestSupplier(companyId: string, name = "Suppliers Inc") {
  return db
    .insert(tables.contacts)
    .values({ companyId, type: "SUPPLIER", name, paymentTermsDays: 30 })
    .returning()
    .get();
}

export function createTestBankAccount(companyId: string, name = "Current Account") {
  const glAccount = accountByCode(companyId, "1000");
  return db
    .insert(tables.bankAccounts)
    .values({ companyId, name, accountId: glAccount.id, bank: "AIB", openingBalanceCents: 0 })
    .returning()
    .get();
}
