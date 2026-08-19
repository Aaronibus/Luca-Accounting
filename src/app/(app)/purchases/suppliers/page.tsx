import { and, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, Money, PageHeader, Table } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const ctx = await requireCompany();
  const suppliers = db
    .select({
      c: tables.contacts,
      owing: sql<number>`coalesce((select sum(${tables.bills.totalCents} - ${tables.bills.paidCents}) from ${tables.bills} where ${tables.bills.contactId} = ${tables.contacts.id} and ${tables.bills.status} = 'APPROVED'), 0)`,
      lifetime: sql<number>`coalesce((select sum(${tables.bills.totalCents}) from ${tables.bills} where ${tables.bills.contactId} = ${tables.contacts.id} and ${tables.bills.status} != 'VOID'), 0)`,
    })
    .from(tables.contacts)
    .where(and(eq(tables.contacts.companyId, ctx.companyId), inArray(tables.contacts.type, ["SUPPLIER", "BOTH"])))
    .orderBy(tables.contacts.name)
    .all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Suppliers" }]}
        title="Suppliers"
        actions={ctx.can("edit") ? <ContactForm type="SUPPLIER" /> : undefined}
      />
      <Card>
        <Table
          head={
            <>
              <th className="table-th">Supplier</th>
              <th className="table-th">County</th>
              <th className="table-th text-right">You owe</th>
              <th className="table-th text-right">Lifetime spend</th>
            </>
          }
        >
          {suppliers.map(({ c, owing, lifetime }) => (
            <tr key={c.id} className="hover:bg-ink-50/50">
              <td className="table-td">
                <div className="font-medium text-ink-800">{c.name}</div>
                {c.email && <div className="text-2xs text-ink-400">{c.email}</div>}
              </td>
              <td className="table-td">{c.county ?? "—"}</td>
              <td className="table-td text-right"><Money cents={owing} muted={owing === 0} /></td>
              <td className="table-td text-right"><Money cents={lifetime} muted /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
