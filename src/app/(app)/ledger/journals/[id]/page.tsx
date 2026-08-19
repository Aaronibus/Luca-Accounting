import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, statusBadge, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { reverseJournalAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const SOURCE_LINK: Record<string, (id: string) => string> = {
  INVOICE: (id) => `/sales/invoices/${id}`,
  CREDIT_NOTE: (id) => `/sales/invoices/${id}`,
  BILL: (id) => `/purchases/bills/${id}`,
  SUPPLIER_CREDIT: (id) => `/purchases/bills/${id}`,
};

export default async function JournalDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCompany();
  const journal = db
    .select()
    .from(tables.journals)
    .where(and(eq(tables.journals.id, params.id), eq(tables.journals.companyId, ctx.companyId)))
    .get();
  if (!journal) notFound();

  const lines = db
    .select({ line: tables.journalLines, code: tables.accounts.code, name: tables.accounts.name })
    .from(tables.journalLines)
    .innerJoin(tables.accounts, eq(tables.journalLines.accountId, tables.accounts.id))
    .where(eq(tables.journalLines.journalId, journal.id))
    .all();
  const totalDebit = lines.reduce((a, l) => a + l.line.debitCents, 0);
  const totalCredit = lines.reduce((a, l) => a + l.line.creditCents, 0);

  const reversal = db.select().from(tables.journals).where(eq(tables.journals.reversesId, journal.id)).get();
  const sourceHref = journal.sourceId && SOURCE_LINK[journal.sourceType]?.(journal.sourceId);

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Ledger", href: "/ledger" }, { label: "Journals", href: "/ledger/journals" }, { label: `#${journal.journalNumber}` }]}
        title={`Journal #${journal.journalNumber}`}
        subtitle={`${fmtDate(journal.date)} · ${journal.description}`}
        actions={
          <>
            {statusBadge(journal.status)}
            {journal.status === "POSTED" && ctx.can("post") && journal.sourceType === "MANUAL" && (
              <ActionButton
                action={reverseJournalAction.bind(null, journal.id, "Reversed from journal page")}
                variant="danger"
                confirm="Post an equal-and-opposite reversal journal? The original stays in the ledger for the audit trail."
              >
                Reverse
              </ActionButton>
            )}
          </>
        }
      />
      <Card>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="table-th">Account</th>
              <th className="table-th">Line description</th>
              <th className="table-th text-right">Debit</th>
              <th className="table-th text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ line, code, name }) => (
              <tr key={line.id} className="hover:bg-ink-50/50">
                <td className="table-td">
                  <Link href={`/ledger/accounts/${line.accountId}`} className="text-ink-800 hover:text-brand-700">
                    <span className="tnum text-ink-400">{code}</span> {name}
                  </Link>
                </td>
                <td className="table-td text-ink-600">{line.description ?? "—"}</td>
                <td className="table-td tnum text-right">{line.debitCents ? fmtEUR(line.debitCents) : ""}</td>
                <td className="table-td tnum text-right">{line.creditCents ? fmtEUR(line.creditCents) : ""}</td>
              </tr>
            ))}
            <tr className="bg-brand-25 font-bold">
              <td className="table-td" colSpan={2}>Totals (balanced)</td>
              <td className="table-td tnum text-right">{fmtEUR(totalDebit)}</td>
              <td className="table-td tnum text-right">{fmtEUR(totalCredit)}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-xs text-ink-500">
          <span>Source: <span className="capitalize">{journal.sourceType.toLowerCase().replace(/_/g, " ")}</span></span>
          {sourceHref && <Link href={sourceHref} className="font-medium text-brand-700 hover:underline">Open source document →</Link>}
          {journal.reversesId && <Link href={`/ledger/journals/${journal.reversesId}`} className="font-medium text-brand-700 hover:underline">Reverses journal →</Link>}
          {reversal && <Link href={`/ledger/journals/${reversal.id}`} className="font-medium text-brand-700 hover:underline">Reversed by #{reversal.journalNumber} →</Link>}
          {journal.postedAt && <span>Posted {fmtDate(journal.postedAt)}</span>}
        </div>
      </Card>
    </div>
  );
}
