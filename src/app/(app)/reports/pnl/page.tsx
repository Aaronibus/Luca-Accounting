import Link from "next/link";
import { requireCompany } from "@/lib/auth";
import { profitAndLoss, PnlSection } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { PeriodPicker } from "@/components/period-picker";
import { rangeToDates } from "@/lib/ranges";

export const dynamic = "force-dynamic";

function Section({ section, prev, flipGood }: { section: PnlSection; prev?: PnlSection; flipGood?: boolean }) {
  const prevMap = new Map((prev?.rows ?? []).map((r) => [r.accountId, r.amountCents]));
  if (section.rows.length === 0) return null;
  return (
    <>
      <tr>
        <td colSpan={4} className="px-4 pb-1 pt-4 text-2xs font-semibold uppercase tracking-wider text-ink-400">{section.label}</td>
      </tr>
      {section.rows.map((r) => {
        const prevVal = prevMap.get(r.accountId) ?? 0;
        const delta = r.amountCents - prevVal;
        return (
          <tr key={r.accountId} className="hover:bg-ink-50/50">
            <td className="table-td pl-6">
              <Link href={`/ledger/accounts/${r.accountId}`} className="text-ink-700 hover:text-brand-700 hover:underline">{r.name}</Link>
              <span className="ml-1.5 text-2xs text-ink-300">{r.code}</span>
            </td>
            <td className="table-td tnum text-right">{fmtEUR(r.amountCents)}</td>
            <td className="table-td tnum text-right text-ink-400">{prev ? fmtEUR(prevVal) : "—"}</td>
            <td className={`table-td tnum text-right text-xs ${delta === 0 ? "text-ink-300" : (flipGood ? delta > 0 : delta < 0) ? "text-positive-600" : "text-negative-600"}`}>
              {prev && delta !== 0 ? `${delta > 0 ? "+" : "−"}${fmtEUR(Math.abs(delta))}` : ""}
            </td>
          </tr>
        );
      })}
      <tr className="font-semibold">
        <td className="table-td pl-4">Total {section.label.toLowerCase()}</td>
        <td className="table-td tnum text-right">{fmtEUR(section.totalCents)}</td>
        <td className="table-td tnum text-right text-ink-400">{prev ? fmtEUR(prev.totalCents) : "—"}</td>
        <td className="table-td" />
      </tr>
    </>
  );
}

export default async function PnlPage({ searchParams }: { searchParams: { range?: string } }) {
  const ctx = await requireCompany();
  const { from, to, label } = rangeToDates(searchParams.range);
  const len = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - len);

  const pnl = profitAndLoss(ctx.companyId, from, to);
  const prev = profitAndLoss(ctx.companyId, prevFrom, prevTo);

  const hasActivity =
    pnl.revenue.rows.length + pnl.costOfSales.rows.length + pnl.operatingExpenses.rows.length +
    pnl.otherIncome.rows.length + pnl.financeCosts.rows.length > 0;

  if (!hasActivity) {
    return (
      <div>
        <PageHeader
          breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Profit & Loss" }]}
          title="Profit & Loss"
          subtitle={`${ctx.company.name} · ${label}`}
          actions={<PeriodPicker />}
        />
        <Card>
          <EmptyState
            title="No accounting transactions recorded for this period"
            body="Approve an invoice, bill or expense — or explain a bank transaction — and this report fills in from the journals behind it."
            action={
              <div className="flex gap-2">
                <Link href="/sales/invoices/new" className="btn-primary">Create invoice</Link>
                <Link href="/purchases/bills/new" className="btn-secondary">Add bill</Link>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const summaryRow = (label: string, cur: number, prevVal: number, strong = false) => (
    <tr className={strong ? "bg-brand-25 font-bold" : "font-semibold"}>
      <td className="table-td pl-4">{label}</td>
      <td className="table-td tnum text-right">{fmtEUR(cur)}</td>
      <td className="table-td tnum text-right text-ink-400">{fmtEUR(prevVal)}</td>
      <td className={`table-td tnum text-right text-xs ${cur - prevVal >= 0 ? "text-positive-600" : "text-negative-600"}`}>
        {cur - prevVal !== 0 ? `${cur - prevVal > 0 ? "+" : "−"}${fmtEUR(Math.abs(cur - prevVal))}` : ""}
      </td>
    </tr>
  );

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Profit & Loss" }]}
        title="Profit & Loss"
        subtitle={`${ctx.company.name} · ${label} (compared with the preceding period)`}
        actions={<PeriodPicker />}
      />
      <Card>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="table-th">Account</th>
              <th className="table-th text-right">{label}</th>
              <th className="table-th text-right">Prior period</th>
              <th className="table-th text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            <Section section={pnl.revenue} prev={prev.revenue} flipGood />
            <Section section={pnl.costOfSales} prev={prev.costOfSales} />
            {summaryRow("Gross profit", pnl.grossProfitCents, prev.grossProfitCents)}
            <Section section={pnl.otherIncome} prev={prev.otherIncome} flipGood />
            <Section section={pnl.operatingExpenses} prev={prev.operatingExpenses} />
            <Section section={pnl.financeCosts} prev={prev.financeCosts} />
            {summaryRow("Net profit", pnl.netProfitCents, prev.netProfitCents, true)}
          </tbody>
        </table>
        <p className="px-4 py-3 text-2xs text-ink-400">Click any account to drill into the postings behind the figure.</p>
      </Card>
    </div>
  );
}
