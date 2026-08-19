import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { trialBalance } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, Badge, fmtDate, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage() {
  const ctx = await requireCompany();
  const asOf = new Date();
  const tb = trialBalance(ctx.companyId, asOf);
  const balanced = tb.totalDebit === tb.totalCredit;

  if (tb.rows.length === 0) {
    return (
      <div>
        <PageHeader
          breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Trial Balance" }]}
          title="Trial Balance"
          subtitle={`${ctx.company.name} · as at ${fmtDate(asOf)}`}
        />
        <Card>
          <EmptyState
            title="Nothing posted to the ledger yet"
            body="Your chart of accounts is ready and waiting. Enter opening balances or post your first transaction and every account appears here."
            action={<Link href="/ledger/opening-balances" className="btn-primary">Add opening balances</Link>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Trial Balance" }]}
        title="Trial Balance"
        subtitle={`${ctx.company.name} · as at ${fmtDate(asOf)}`}
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/export/trial-balance" className="btn-secondary">Export CSV</a>
            {balanced ? <Badge tone="green">Balanced ✓</Badge> : <Badge tone="red">OUT OF BALANCE</Badge>}
          </div>
        }
      />
      <Card>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="table-th">Code</th>
              <th className="table-th">Account</th>
              <th className="table-th">Type</th>
              <th className="table-th text-right">Debit</th>
              <th className="table-th text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId} className="hover:bg-ink-50/50">
                <td className="table-td tnum text-ink-400">{r.code}</td>
                <td className="table-td">
                  <Link href={`/ledger/accounts/${r.accountId}`} className="text-ink-700 hover:text-brand-700 hover:underline">{r.name}</Link>
                </td>
                <td className="table-td text-xs capitalize text-ink-400">{r.type.toLowerCase()}</td>
                <td className="table-td tnum text-right">{r.debitCents ? fmtEUR(r.debitCents) : ""}</td>
                <td className="table-td tnum text-right">{r.creditCents ? fmtEUR(r.creditCents) : ""}</td>
              </tr>
            ))}
            <tr className="bg-brand-25 font-bold">
              <td className="table-td" colSpan={3}>Totals</td>
              <td className="table-td tnum text-right">{fmtEUR(tb.totalDebit)}</td>
              <td className="table-td tnum text-right">{fmtEUR(tb.totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
