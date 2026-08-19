import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, Table, statusBadge, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function JournalsPage() {
  const ctx = await requireCompany();
  const journals = db
    .select({
      j: tables.journals,
      total: sql<number>`(select coalesce(sum(${tables.journalLines.debitCents}),0) from ${tables.journalLines} where ${tables.journalLines.journalId} = ${tables.journals.id})`,
    })
    .from(tables.journals)
    .where(eq(tables.journals.companyId, ctx.companyId))
    .orderBy(desc(tables.journals.journalNumber))
    .limit(200)
    .all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Ledger", href: "/ledger" }, { label: "Journals" }]}
        title="Journals"
        subtitle="Every posting in the company, immutable once posted. Corrections are reversals — history is never rewritten."
      />
      <Card>
        <Table
          head={
            <>
              <th className="table-th">#</th>
              <th className="table-th">Date</th>
              <th className="table-th">Description</th>
              <th className="table-th">Source</th>
              <th className="table-th">Status</th>
              <th className="table-th text-right">Amount</th>
            </>
          }
        >
          {journals.map(({ j, total }) => (
            <tr key={j.id} className="hover:bg-ink-50/50">
              <td className="table-td tnum">
                <Link href={`/ledger/journals/${j.id}`} className="font-medium text-brand-700 hover:underline">#{j.journalNumber}</Link>
              </td>
              <td className="table-td whitespace-nowrap">{fmtDate(j.date)}</td>
              <td className="table-td">{j.description}</td>
              <td className="table-td text-xs capitalize text-ink-400">{j.sourceType.toLowerCase().replace(/_/g, " ")}</td>
              <td className="table-td">{statusBadge(j.status)}</td>
              <td className="table-td tnum text-right">{fmtEUR(total)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
