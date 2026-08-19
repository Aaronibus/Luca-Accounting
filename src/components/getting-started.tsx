import Link from "next/link";
import { Landmark, FileText, ShoppingCart, Receipt, Scale, ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { EmptinessReport } from "@/lib/services/companies";

/**
 * The onboarding dashboard for a company with no accounting activity yet.
 * No fake zeros, no pretend charts — just the real next steps.
 */
export function GettingStarted({ companyName, emptiness }: { companyName: string; emptiness: EmptinessReport }) {
  const steps = [
    {
      done: emptiness.bankAccounts > 0,
      icon: <Landmark size={17} />,
      title: "Add a bank account",
      body: "Set up the account your business trades through, then import a statement to start reconciling.",
      href: "/banking/new",
      cta: "Add bank account",
    },
    {
      done: emptiness.journals > 0,
      icon: <Scale size={17} />,
      title: "Enter opening balances",
      body: "Moving from another system or a spreadsheet? Bring across your closing trial balance so your reports start from the right place.",
      href: "/ledger/opening-balances",
      cta: "Add opening balances",
    },
    {
      done: emptiness.invoices > 0,
      icon: <FileText size={17} />,
      title: "Raise your first invoice",
      body: "Add a customer and invoice them — Lúca handles the VAT and posts the double-entry underneath.",
      href: "/sales/invoices/new",
      cta: "Create invoice",
    },
    {
      done: emptiness.bills > 0,
      icon: <ShoppingCart size={17} />,
      title: "Record a supplier bill",
      body: "Type it in, or upload a PDF invoice and let Lúca extract the supplier, amounts and VAT for your approval.",
      href: "/purchases/bills/new",
      cta: "Add bill",
    },
    {
      done: emptiness.expenses > 0,
      icon: <Receipt size={17} />,
      title: "Capture an expense",
      body: "Photograph or upload a receipt — the merchant, category and VAT are read for you.",
      href: "/expenses",
      cta: "Add expense",
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-5">
      <div className="card overflow-hidden">
        <div className="border-b border-ink-100 bg-brand-25 px-6 py-5">
          <h2 className="text-lg font-semibold tracking-tight text-ink-900">{companyName} is ready</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-600">
            Your Irish chart of accounts, VAT rates and invoice numbering are set up. There are no transactions yet —
            every figure you see from here will come from what you enter or import.
          </p>
          <p className="mt-2 text-2xs font-medium uppercase tracking-wider text-brand-700">
            {completed} of {steps.length} steps done
          </p>
        </div>

        <ul className="divide-y divide-ink-100/70">
          {steps.map((s) => (
            <li key={s.title} className="flex items-start gap-4 px-6 py-4">
              <span className={`mt-0.5 shrink-0 ${s.done ? "text-positive-500" : "text-ink-300"}`}>
                {s.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={`flex items-center gap-2 text-sm font-semibold ${s.done ? "text-ink-400 line-through" : "text-ink-900"}`}>
                  <span className="text-brand-600">{s.icon}</span>
                  {s.title}
                </h3>
                <p className="mt-0.5 text-[13px] text-ink-500">{s.body}</p>
              </div>
              {!s.done && (
                <Link href={s.href} className="btn-secondary shrink-0 !py-1.5 text-xs">
                  {s.cta} <ArrowRight size={13} />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Banking", body: "No bank account connected yet.", href: "/banking", cta: "Connect a bank account" },
          { label: "Sales", body: "No invoices yet.", href: "/sales/invoices/new", cta: "Create your first invoice" },
          { label: "VAT", body: "No VAT activity yet.", href: "/vat", cta: "Review VAT settings" },
        ].map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-2xs font-semibold uppercase tracking-wider text-ink-400">{c.label}</div>
            <p className="mt-1 text-[13px] text-ink-600">{c.body}</p>
            <Link href={c.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              {c.cta} <ArrowRight size={12} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
