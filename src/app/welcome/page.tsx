import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, Building2, PlayCircle, ArrowRight } from "lucide-react";
import { currentUser, userCompanies } from "@/lib/auth";
import { DemoLauncher } from "@/components/demo-launcher";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const companies = userCompanies(user.id, { includeArchived: true });

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-raised">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Welcome to Lúca, {user.name.split(" ")[0]}</h1>
          <p className="mt-1.5 max-w-md text-sm text-ink-500">
            Set up your first company to start keeping books, or take a look around a demo file first.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/companies/new" className="card group flex flex-col p-6 transition-colors hover:border-brand-300">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Building2 size={19} />
            </div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              Create a company
              <ArrowRight size={14} className="text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </h2>
            <p className="mt-1 flex-1 text-[13px] text-ink-500">
              A genuinely blank accounting file: Irish chart of accounts, VAT rates and invoice numbering ready to go — and
              no transactions at all until you enter them.
            </p>
            <span className="mt-3 text-2xs font-medium uppercase tracking-wider text-brand-700">Recommended</span>
          </Link>

          <div className="card flex flex-col p-6">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-ai-50 text-ai-600">
              <PlayCircle size={19} />
            </div>
            <h2 className="text-sm font-semibold text-ink-900">Explore a demo company</h2>
            <p className="mt-1 flex-1 text-[13px] text-ink-500">
              A fictional Kilkenny coffee roastery with eight months of trading, bank transactions to reconcile and two
              filed VAT returns. Clearly marked <strong>DEMO</strong> and completely separate from your real companies.
            </p>
            <div className="mt-3">
              <DemoLauncher />
            </div>
          </div>
        </div>

        {companies.length > 0 && (
          <div className="mt-6 card p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Your companies</p>
            <ul className="divide-y divide-ink-100/70">
              {companies.map((c) => (
                <li key={c.companyId}>
                  <Link href={`/dashboard?company=${c.companyId}`} className="flex items-center justify-between py-2 text-[13px] hover:text-brand-700">
                    <span className="font-medium text-ink-800">
                      {c.name}
                      {c.isDemo && <span className="ml-2 rounded bg-ai-50 px-1.5 py-0.5 text-2xs font-semibold text-ai-700">DEMO</span>}
                      {c.archived && <span className="ml-2 text-2xs text-ink-400">archived</span>}
                    </span>
                    <ArrowRight size={14} className="text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
