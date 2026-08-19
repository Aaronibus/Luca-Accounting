import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { balanceSheet, BalanceSheetSection } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, Badge, fmtDate, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function Section({ s }: { s: BalanceSheetSection }) {
  if (s.rows.length === 0) return null;
  return (
    <>
      <tr><td colSpan={2} className="px-4 pb-1 pt-4 text-2xs font-semibold uppercase tracking-wider text-ink-400">{s.label}</td></tr>
      {s.rows.map((r) => (
        <tr key={r.accountId} className="hover:bg-ink-50/50">
          <td className="table-td pl-6">
            <Link href={`/ledger/accounts/${r.accountId}`} className="text-ink-700 hover:text-brand-700 hover:underline">{r.name}</Link>
            <span className="ml-1.5 text-2xs text-ink-300">{r.code}</span>
          </td>
          <td className="table-td tnum text-right">{fmtEUR(r.amountCents)}</td>
        </tr>
      ))}
      <tr className="font-semibold">
        <td className="table-td pl-4">Total {s.label.toLowerCase()}</td>
        <td className="table-td tnum text-right">{fmtEUR(s.totalCents)}</td>
      </tr>
    </>
  );
}

export default async function BalanceSheetPage() {
  const ctx = await requireCompany();
  const asOf = new Date();
  const bs = balanceSheet(ctx.companyId, asOf);

  const hasRows =
    bs.fixedAssets.rows.length + bs.currentAssets.rows.length + bs.currentLiabilities.rows.length +
    bs.longTermLiabilities.rows.length + bs.equity.rows.length > 0;
  if (!hasRows && bs.retainedEarningsComputedCents === 0) {
    return (
      <div>
        <PageHeader
          breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Balance Sheet" }]}
          title="Balance Sheet"
          subtitle={`${ctx.company.name} · as at ${fmtDate(asOf)}`}
        />
        <Card>
          <EmptyState
            title="No balances to report yet"
            body="Once you enter opening balances or post transactions, your assets, liabilities and equity appear here — always in balance."
            action={<Link href="/ledger/opening-balances" className="btn-primary">Add opening balances</Link>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Balance Sheet" }]}
        title="Balance Sheet"
        subtitle={`${ctx.company.name} · as at ${fmtDate(asOf)}`}
        actions={bs.balances ? <Badge tone="green">Balances ✓</Badge> : <Badge tone="red">Does not balance</Badge>}
      />
      <Card>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <Section s={bs.fixedAssets} />
            <Section s={bs.currentAssets} />
            <Section s={bs.currentLiabilities} />
            <Section s={bs.longTermLiabilities} />
            <tr className="bg-brand-25 font-bold">
              <td className="table-td pl-4">Net assets</td>
              <td className="table-td tnum text-right">{fmtEUR(bs.netAssetsCents)}</td>
            </tr>
            <Section s={bs.equity} />
            <tr className="hover:bg-ink-50/50">
              <td className="table-td pl-6 text-ink-700">Retained earnings (incl. current period)</td>
              <td className="table-td tnum text-right">{fmtEUR(bs.retainedEarningsComputedCents)}</td>
            </tr>
            <tr className="bg-brand-25 font-bold">
              <td className="table-td pl-4">Total equity</td>
              <td className="table-td tnum text-right">{fmtEUR(bs.totalEquityCents)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
