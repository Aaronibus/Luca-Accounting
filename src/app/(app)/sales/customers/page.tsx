import { and, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, Money, PageHeader, Table } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const ctx = await requireCompany();
  const customers = db
    .select({
      c: tables.contacts,
      outstanding: sql<number>`coalesce((select sum(${tables.invoices.totalCents} - ${tables.invoices.paidCents}) from ${tables.invoices} where ${tables.invoices.contactId} = ${tables.contacts.id} and ${tables.invoices.status} in ('APPROVED','SENT')), 0)`,
      lifetime: sql<number>`coalesce((select sum(${tables.invoices.totalCents}) from ${tables.invoices} where ${tables.invoices.contactId} = ${tables.contacts.id} and ${tables.invoices.status} != 'VOID'), 0)`,
    })
    .from(tables.contacts)
    .where(and(eq(tables.contacts.companyId, ctx.companyId), inArray(tables.contacts.type, ["CUSTOMER", "BOTH"])))
    .orderBy(tables.contacts.name)
    .all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "Customers" }]}
        title="Customers"
        actions={ctx.can("edit") ? <ContactForm type="CUSTOMER" /> : undefined}
      />
      <Card>
        <Table
          head={
            <>
              <th className="table-th">Customer</th>
              <th className="table-th">County</th>
              <th className="table-th">Terms</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th text-right">Lifetime billed</th>
            </>
          }
        >
          {customers.map(({ c, outstanding, lifetime }) => (
            <tr key={c.id} className="hover:bg-ink-50/50">
              <td className="table-td">
                <div className="font-medium text-ink-800">{c.name}</div>
                {c.email && <div className="text-2xs text-ink-400">{c.email}</div>}
              </td>
              <td className="table-td">{c.county ?? "—"}</td>
              <td className="table-td tnum">{c.paymentTermsDays} days</td>
              <td className="table-td text-right"><Money cents={outstanding} muted={outstanding === 0} /></td>
              <td className="table-td text-right"><Money cents={lifetime} muted /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
