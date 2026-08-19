import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import {
  LayoutDashboard, Inbox, Landmark, FileText, ShoppingCart, Receipt,
  Percent, BarChart3, BookOpenText, FolderOpen, Settings, Sparkles,
} from "lucide-react";
import { db, tables } from "@/db";
import { currentUser, requireCompany, userCompanies, NoCompanyError } from "@/lib/auth";
import { CopilotPanel } from "@/components/copilot-panel";
import { CompanySwitcher, UserMenu } from "@/components/topbar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  let ctx;
  try {
    ctx = await requireCompany();
  } catch (e) {
    // A signed-in user with no company goes to onboarding, not an error page.
    if (e instanceof NoCompanyError) redirect("/welcome");
    redirect("/login");
  }

  const pendingSuggestions = db
    .select({ n: sql<number>`count(*)` })
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, ctx.companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .get();
  const inboxCount = pendingSuggestions?.n ?? 0;
  const companies = userCompanies(user.id);

  const nav = [
    {
      section: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
        { href: "/inbox", label: "Inbox", icon: <Inbox size={16} />, badge: inboxCount || undefined },
      ],
    },
    {
      section: "Money",
      items: [
        { href: "/banking", label: "Banking", icon: <Landmark size={16} /> },
        { href: "/sales", label: "Sales", icon: <FileText size={16} /> },
        { href: "/purchases", label: "Purchases", icon: <ShoppingCart size={16} /> },
        { href: "/expenses", label: "Expenses", icon: <Receipt size={16} /> },
      ],
    },
    {
      section: "Compliance",
      items: [
        { href: "/vat", label: "VAT", icon: <Percent size={16} /> },
        { href: "/reports", label: "Reports", icon: <BarChart3 size={16} /> },
        { href: "/ledger", label: "Ledger", icon: <BookOpenText size={16} /> },
      ],
    },
    {
      section: "Workspace",
      items: [
        { href: "/documents", label: "Documents", icon: <FolderOpen size={16} /> },
        { href: "/settings", label: "Settings", icon: <Settings size={16} /> },
      ],
    },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-ink-100 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-ink-100 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Sparkles size={15} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-ink-900">Lúca</span>
          <span className="ml-auto rounded bg-brand-50 px-1.5 py-0.5 text-2xs font-medium text-brand-700">IE</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {nav.map((group) => (
            <div key={group.section} className="mb-4">
              <div className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">{group.section}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
                >
                  <span className="text-ink-400 group-hover:text-brand-600">{item.icon}</span>
                  {item.label}
                  {"badge" in item && item.badge ? (
                    <span className="ml-auto rounded-full bg-ai-100 px-1.5 py-0.5 text-2xs font-semibold text-ai-700">{item.badge}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-ink-100 p-3 text-2xs text-ink-400">
          Correct accounting first.<br />AI does the heavy lifting.
        </div>
      </aside>

      <div className="ml-56 flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-ink-100 bg-white/85 px-6 backdrop-blur">
          <CompanySwitcher
            current={{ id: ctx.companyId, name: ctx.company.name, isDemo: ctx.company.isDemo }}
            companies={companies}
          />
          <UserMenu name={user.name} role={ctx.role} />
        </header>
        {ctx.company.isDemo && (
          <div className="border-b border-ai-200 bg-ai-50 px-6 py-2 text-center text-xs text-ai-700">
            <strong>Demo company</strong> — every customer, invoice and bank transaction here is fictional sample data.
            Your real companies are completely separate.
          </div>
        )}
        <main className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      <CopilotPanel />
    </div>
  );
}
