import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const ctx = await requireCompany("edit");
  const contacts = db
    .select()
    .from(tables.contacts)
    .where(and(eq(tables.contacts.companyId, ctx.companyId), eq(tables.contacts.archived, false)))
    .orderBy(tables.contacts.name)
    .all()
    .filter((c) => c.type !== "SUPPLIER");
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.type, "INCOME")))
    .orderBy(tables.accounts.code)
    .all();
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const std = vatRates.find((r) => r.category === "STANDARD")!;

  return (
    <div>
      <PageHeader breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "New invoice" }]} title="New invoice" subtitle="Approving posts the double-entry automatically: debtors, income and VAT control." />
      <DocumentForm
        mode="INVOICE"
        contacts={contacts.map((c) => ({ id: c.id, label: c.name }))}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
        vatRates={vatRates.map((r) => ({ id: r.id, label: r.name, rateBps: r.rateBps, category: r.category }))}
        defaultAccountId={accounts[0]?.id ?? ""}
        defaultVatRateId={std.id}
      />
    </div>
  );
}
