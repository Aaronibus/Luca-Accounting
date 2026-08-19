import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";

export const dynamic = "force-dynamic";

export default async function NewBillPage() {
  const ctx = await requireCompany("edit");
  const contacts = db
    .select()
    .from(tables.contacts)
    .where(and(eq(tables.contacts.companyId, ctx.companyId), inArray(tables.contacts.type, ["SUPPLIER", "BOTH"])))
    .orderBy(tables.contacts.name)
    .all();
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.type, "EXPENSE")))
    .orderBy(tables.accounts.code)
    .all()
    .filter((a) => !a.systemKey);
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const std = vatRates.find((r) => r.category === "STANDARD")!;

  return (
    <div>
      <PageHeader breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "New bill" }]} title="New bill" subtitle="Approving posts the double-entry: expense + input VAT against creditors." />
      <DocumentForm
        mode="BILL"
        contacts={contacts.map((c) => ({ id: c.id, label: c.name }))}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
        vatRates={vatRates.map((r) => ({ id: r.id, label: r.name, rateBps: r.rateBps, category: r.category }))}
        defaultAccountId={accounts.find((a) => a.code === "5000")?.id ?? accounts[0]?.id ?? ""}
        defaultVatRateId={std.id}
      />
    </div>
  );
}
