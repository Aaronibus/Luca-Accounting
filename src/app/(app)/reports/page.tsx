import Link from "next/link";
import { BarChart3, Scale, ListOrdered, Users, Truck, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireCompany } from "@/lib/auth";

export const dynamic = "force-dynamic";

const reports = [
  { href: "/reports/pnl", icon: <BarChart3 size={18} />, title: "Profit & Loss", body: "Income and spending for any period, with comparatives and drill-down to every transaction." },
  { href: "/reports/balance-sheet", icon: <Scale size={18} />, title: "Balance Sheet", body: "Assets, liabilities and equity at a date — always balanced, straight from the ledger." },
  { href: "/reports/trial-balance", icon: <ListOrdered size={18} />, title: "Trial Balance", body: "Every account's debit or credit balance. The accountant's starting point." },
  { href: "/reports/aged-debtors", icon: <Users size={18} />, title: "Aged Debtors", body: "Who owes you money and how overdue it is, bucketed by age." },
  { href: "/reports/aged-creditors", icon: <Truck size={18} />, title: "Aged Creditors", body: "What you owe suppliers, by ageing bucket." },
];

export default async function ReportsPage() {
  await requireCompany();
  return (
    <div>
      <PageHeader title="Reports" subtitle="Every figure is drillable back to the journals that produced it." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link key={r.href} href={r.href} className="card group p-5 transition-colors hover:border-brand-200">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{r.icon}</div>
            <h3 className="flex items-center gap-1 text-sm font-semibold text-ink-900">
              {r.title}
              <ArrowRight size={13} className="text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </h3>
            <p className="mt-1 text-[13px] text-ink-500">{r.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
