import Link from "next/link";
import type { AgedRow } from "@/lib/engine/reports";
import { fmtEUR } from "@/lib/money";

export function AgedTable({ rows, hrefBase }: { rows: AgedRow[]; hrefBase: string }) {
  const totals = rows.reduce(
    (a, r) => ({
      current: a.current + r.currentCents,
      d30: a.d30 + r.days1to30Cents,
      d60: a.d60 + r.days31to60Cents,
      d90: a.d90 + r.days61to90Cents,
      d90p: a.d90p + r.days90plusCents,
      total: a.total + r.totalCents,
    }),
    { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, total: 0 }
  );

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="table-th">Contact</th>
          <th className="table-th text-right">Current</th>
          <th className="table-th text-right">1–30 days</th>
          <th className="table-th text-right">31–60</th>
          <th className="table-th text-right">61–90</th>
          <th className="table-th text-right">90+</th>
          <th className="table-th text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.contactId} className="hover:bg-ink-50/50">
            <td className="table-td">
              <div className="font-medium text-ink-800">{r.contactName}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-2xs text-ink-400">
                {r.items.slice(0, 4).map((i) => (
                  <Link key={i.id} href={`${hrefBase}/${i.id}`} className="hover:text-brand-700">
                    {i.number}{i.daysOverdue > 0 ? ` (${i.daysOverdue}d late)` : ""}
                  </Link>
                ))}
                {r.items.length > 4 && <span>+{r.items.length - 4} more</span>}
              </div>
            </td>
            <td className="table-td tnum text-right">{r.currentCents ? fmtEUR(r.currentCents) : ""}</td>
            <td className="table-td tnum text-right">{r.days1to30Cents ? fmtEUR(r.days1to30Cents) : ""}</td>
            <td className="table-td tnum text-right text-warn-600">{r.days31to60Cents ? fmtEUR(r.days31to60Cents) : ""}</td>
            <td className="table-td tnum text-right text-warn-700">{r.days61to90Cents ? fmtEUR(r.days61to90Cents) : ""}</td>
            <td className="table-td tnum text-right text-negative-600">{r.days90plusCents ? fmtEUR(r.days90plusCents) : ""}</td>
            <td className="table-td tnum text-right font-semibold">{fmtEUR(r.totalCents)}</td>
          </tr>
        ))}
        <tr className="bg-brand-25 font-bold">
          <td className="table-td">Totals</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.current)}</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.d30)}</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.d60)}</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.d90)}</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.d90p)}</td>
          <td className="table-td tnum text-right">{fmtEUR(totals.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}
