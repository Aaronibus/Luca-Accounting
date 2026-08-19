import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, Money, PageHeader, Table, statusBadge, fmtDate, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({ searchParams }: { searchParams: { filter?: string } }) {
  const ctx = await requireCompany();
  const filter = searchParams.filter ?? "all";
  const now = Date.now();

  const conditions = [eq(tables.invoices.companyId, ctx.companyId)];
  if (filter === "open") conditions.push(inArray(tables.invoices.status, ["APPROVED", "SENT"]));
  if (filter === "overdue") {
    conditions.push(inArray(tables.invoices.status, ["APPROVED", "SENT"]));
    conditions.push(sql`${tables.invoices.dueDate} < ${now}`);
    conditions.push(sql`${tables.invoices.totalCents} > ${tables.invoices.paidCents}`);
  }
  if (filter === "paid") conditions.push(eq(tables.invoices.status, "PAID"));
  if (filter === "draft") conditions.push(inArray(tables.invoices.status, ["DRAFT", "AWAITING_APPROVAL"]));

  const invoices = db
    .select({ inv: tables.invoices, contactName: tables.contacts.name })
    .from(tables.invoices)
    .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
    .where(and(...conditions))
    .orderBy(desc(tables.invoices.date))
    .limit(200)
    .all();

  const tabs = [
    { key: "all", label: "All" },
    { key: "draft", label: "Drafts" },
    { key: "open", label: "Awaiting payment" },
    { key: "overdue", label: "Overdue" },
    { key: "paid", label: "Paid" },
  ];

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle="Sales invoices and credit notes."
        actions={
          <>
            <Link href="/sales/customers" className="btn-secondary">Customers</Link>
            <Link href="/sales/invoices/new" className="btn-primary"><Plus size={15} /> New invoice</Link>
          </>
        }
      />
      <div className="mb-3 flex gap-1 border-b border-ink-100">
        {tabs.map((t) => (
          <Link key={t.key} href={`/sales/invoices?filter=${t.key}`} className={`border-b-2 px-3 py-2 text-[13px] font-medium ${filter === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <Card>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices here" body="Create your first invoice — Lúca handles the VAT and the double-entry underneath." action={<Link href="/sales/invoices/new" className="btn-primary">New invoice</Link>} />
        ) : (
          <Table
            head={
              <>
                <th className="table-th">Number</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Date</th>
                <th className="table-th">Due</th>
                <th className="table-th">Status</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th text-right">Amount due</th>
              </>
            }
          >
            {invoices.map(({ inv, contactName }) => {
              const overdue = ["APPROVED", "SENT"].includes(inv.status) && new Date(inv.dueDate).getTime() < now && inv.totalCents > inv.paidCents;
              return (
                <tr key={inv.id} className="hover:bg-ink-50/50">
                  <td className="table-td">
                    <Link href={`/sales/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline">{inv.number}</Link>
                    {inv.kind === "CREDIT_NOTE" && <span className="ml-1.5 text-2xs text-ink-400">credit note</span>}
                  </td>
                  <td className="table-td">{contactName}</td>
                  <td className="table-td whitespace-nowrap">{fmtDate(inv.date)}</td>
                  <td className="table-td whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
                  <td className="table-td">{statusBadge(overdue ? "OVERDUE" : inv.status)}</td>
                  <td className="table-td text-right"><Money cents={inv.totalCents} /></td>
                  <td className="table-td text-right"><Money cents={inv.totalCents - inv.paidCents} muted={inv.totalCents === inv.paidCents} /></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
