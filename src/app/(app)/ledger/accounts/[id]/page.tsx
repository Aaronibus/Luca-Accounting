import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { accountActivity } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, fmtDate, statusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AccountActivityPage({ params }: { params: { id: string } }) {
  const ctx = await requireCompany();
  const account = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.id, params.id), eq(tables.accounts.companyId, ctx.companyId)))
    .get();
  if (!account) notFound();

  const activity = accountActivity(ctx.companyId, account.id);
  const lines = activity.lines.slice(-200).reverse();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Ledger", href: "/ledger" }, { label: `${account.code} ${account.name}` }]}
        title={`${account.code} · ${account.name}`}
        subtitle={`${account.type.toLowerCase()} · ${account.subtype.toLowerCase().replace(/_/g, " ")}${account.description ? ` — ${account.description}` : ""}`}
        actions={
          <div className="text-right">
            <div className="text-2xs uppercase tracking-wide text-ink-400">Balance</div>
            <div className="tnum text-lg font-semibold">{fmtEUR(activity.closingCents)}</div>
          </div>
        }
      />
      <Card>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Journal</th>
              <th className="table-th">Description</th>
              <th className="table-th">Source</th>
              <th className="table-th text-right">Debit</th>
              <th className="table-th text-right">Credit</th>
              <th className="table-th text-right">Running</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.journalId}-${i}`} className={`hover:bg-ink-50/50 ${l.journalStatus === "REVERSED" ? "opacity-50" : ""}`}>
                <td className="table-td whitespace-nowrap">{fmtDate(l.date)}</td>
                <td className="table-td">
                  <Link href={`/ledger/journals/${l.journalId}`} className="tnum font-medium text-brand-700 hover:underline">#{l.journalNumber}</Link>
                </td>
                <td className="table-td">
                  {l.lineDescription ?? l.description}
                  {l.journalStatus === "REVERSED" && <span className="ml-1.5">{statusBadge("REVERSED")}</span>}
                </td>
                <td className="table-td text-xs capitalize text-ink-400">{l.sourceType.toLowerCase().replace(/_/g, " ")}</td>
                <td className="table-td tnum text-right">{l.debitCents ? fmtEUR(l.debitCents) : ""}</td>
                <td className="table-td tnum text-right">{l.creditCents ? fmtEUR(l.creditCents) : ""}</td>
                <td className="table-td tnum text-right text-ink-500">{fmtEUR(l.runningCents)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={7} className="table-td py-8 text-center text-ink-400">No postings to this account yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
