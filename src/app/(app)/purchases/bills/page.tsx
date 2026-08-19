import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Plus, ScanText } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, Money, PageHeader, Table, statusBadge, fmtDate, EmptyState } from "@/components/ui";
import { DocumentUpload } from "@/components/document-upload";

export const dynamic = "force-dynamic";

export default async function BillsPage({ searchParams }: { searchParams: { filter?: string } }) {
  const ctx = await requireCompany();
  const filter = searchParams.filter ?? "all";
  const now = Date.now();

  const conditions = [eq(tables.bills.companyId, ctx.companyId)];
  if (filter === "open") conditions.push(eq(tables.bills.status, "APPROVED"));
  if (filter === "overdue") {
    conditions.push(eq(tables.bills.status, "APPROVED"));
    conditions.push(sql`${tables.bills.dueDate} < ${now}`);
    conditions.push(sql`${tables.bills.totalCents} > ${tables.bills.paidCents}`);
  }
  if (filter === "paid") conditions.push(eq(tables.bills.status, "PAID"));
  if (filter === "draft") conditions.push(inArray(tables.bills.status, ["DRAFT", "AWAITING_APPROVAL"]));

  const bills = db
    .select({ bill: tables.bills, contactName: tables.contacts.name })
    .from(tables.bills)
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .where(and(...conditions))
    .orderBy(desc(tables.bills.date))
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
        title="Bills"
        subtitle="Supplier bills — type them in, or drop a PDF and let Lúca extract everything."
        actions={
          <>
            <Link href="/purchases/suppliers" className="btn-secondary">Suppliers</Link>
            {ctx.can("edit") && <DocumentUpload docType="INVOICE" label={<><ScanText size={15} /> Scan a bill</>} />}
            <Link href="/purchases/bills/new" className="btn-primary"><Plus size={15} /> New bill</Link>
          </>
        }
      />
      <div className="mb-3 flex gap-1 border-b border-ink-100">
        {tabs.map((t) => (
          <Link key={t.key} href={`/purchases/bills?filter=${t.key}`} className={`border-b-2 px-3 py-2 text-[13px] font-medium ${filter === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <Card>
        {bills.length === 0 ? (
          <EmptyState title="No bills here" body="Add a supplier bill, or upload a PDF invoice and Lúca will draft it for you." />
        ) : (
          <Table
            head={
              <>
                <th className="table-th">Number</th>
                <th className="table-th">Supplier</th>
                <th className="table-th">Ref</th>
                <th className="table-th">Date</th>
                <th className="table-th">Status</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th text-right">Due</th>
              </>
            }
          >
            {bills.map(({ bill, contactName }) => {
              const overdue = bill.status === "APPROVED" && new Date(bill.dueDate).getTime() < now && bill.totalCents > bill.paidCents;
              return (
                <tr key={bill.id} className="hover:bg-ink-50/50">
                  <td className="table-td">
                    <Link href={`/purchases/bills/${bill.id}`} className="font-medium text-brand-700 hover:underline">{bill.number}</Link>
                    {bill.origin === "DOCUMENT_EXTRACTION" && <span className="ml-1.5 text-2xs text-ai-600">AI-drafted</span>}
                  </td>
                  <td className="table-td">{contactName}</td>
                  <td className="table-td text-xs text-ink-500">{bill.supplierRef ?? "—"}</td>
                  <td className="table-td whitespace-nowrap">{fmtDate(bill.date)}</td>
                  <td className="table-td">{statusBadge(overdue ? "OVERDUE" : bill.status)}</td>
                  <td className="table-td text-right"><Money cents={bill.totalCents} /></td>
                  <td className="table-td text-right"><Money cents={bill.totalCents - bill.paidCents} muted={bill.totalCents === bill.paidCents} /></td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
