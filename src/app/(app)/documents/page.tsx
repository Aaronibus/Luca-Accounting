import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileUp } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, PageHeader, Table, Badge, fmtDate, EmptyState } from "@/components/ui";
import { DocumentUpload } from "@/components/document-upload";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const ctx = await requireCompany();
  const docs = db
    .select()
    .from(tables.documents)
    .where(eq(tables.documents.companyId, ctx.companyId))
    .orderBy(desc(tables.documents.createdAt))
    .limit(100)
    .all();

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Invoices, receipts and supporting files — linked straight to the transactions they support."
        actions={ctx.can("edit") ? <DocumentUpload docType="INVOICE" label={<><FileUp size={15} /> Upload & extract</>} /> : undefined}
      />
      <Card>
        {docs.length === 0 ? (
          <EmptyState title="No documents yet" body="Upload a PDF bill or receipt — Lúca extracts the fields, cross-checks the arithmetic and drafts the entry for approval." />
        ) : (
          <Table
            head={
              <>
                <th className="table-th">File</th>
                <th className="table-th">Type</th>
                <th className="table-th">Extraction</th>
                <th className="table-th">Linked to</th>
                <th className="table-th">Uploaded</th>
              </>
            }
          >
            {docs.map((d) => (
              <tr key={d.id} className="hover:bg-ink-50/50">
                <td className="table-td font-medium text-ink-800">{d.filename}</td>
                <td className="table-td text-xs capitalize text-ink-500">{d.docType.toLowerCase()}</td>
                <td className="table-td">
                  {d.extractionStatus === "EXTRACTED" ? <Badge tone="ai">extracted</Badge> : d.extractionStatus === "FAILED" ? <Badge tone="red">failed</Badge> : <Badge>stored</Badge>}
                </td>
                <td className="table-td">
                  {d.billId ? <Link href={`/purchases/bills/${d.billId}`} className="text-brand-700 hover:underline">Bill →</Link>
                    : d.expenseId ? <Link href="/expenses" className="text-brand-700 hover:underline">Expense →</Link>
                    : d.invoiceId ? <Link href={`/sales/invoices/${d.invoiceId}`} className="text-brand-700 hover:underline">Invoice →</Link>
                    : <span className="text-ink-400">—</span>}
                </td>
                <td className="table-td whitespace-nowrap text-xs text-ink-500">{d.createdAt ? fmtDate(d.createdAt) : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
