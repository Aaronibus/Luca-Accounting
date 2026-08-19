import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ArrowRight, AlertTriangle, Sparkles, CalendarClock } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { profitAndLoss } from "@/lib/engine/reports";
import { accountBalance } from "@/lib/engine/journal";
import { bankReconciliationStatus } from "@/lib/services/banking";
import { healthScore } from "@/lib/ai/insights";
import { companyEmptiness } from "@/lib/services/companies";
import { GettingStarted } from "@/components/getting-started";
import { detectAnomalies } from "@/lib/ai/anomalies";
import { fmtEUR } from "@/lib/money";
import { Card, Money, Stat, Badge, fmtDate, fmtDateShort } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await requireCompany();
  const { companyId } = ctx;
  const now = new Date();

  // A brand-new company shows onboarding, not a wall of meaningless zeros.
  const emptiness = companyEmptiness(companyId);
  if (emptiness.isEmpty) {
    return <GettingStarted companyName={ctx.company.name} emptiness={emptiness} />;
  }

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Cash
  const banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, companyId)).all();
  const bankBalances = banks.map((b) => ({ ...b, ledger: accountBalance(companyId, b.accountId), recon: bankReconciliationStatus(companyId, b.id) }));
  const cash = bankBalances.reduce((a, b) => a + b.recon.statementBalanceCents, 0);
  const unmatchedCount = bankBalances.reduce((a, b) => a + b.recon.unmatched.length, 0);

  // P&L: this month + 6-month trend
  const pnlMtd = profitAndLoss(companyId, monthStart, now);
  const trend: Array<{ label: string; revenue: number; expenses: number; profit: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));
    const p = profitAndLoss(companyId, from, to);
    trend.push({
      label: from.toLocaleDateString("en-IE", { month: "short", timeZone: "UTC" }),
      revenue: p.revenue.totalCents + p.otherIncome.totalCents,
      expenses: p.costOfSales.totalCents + p.operatingExpenses.totalCents + p.financeCosts.totalCents,
      profit: p.netProfitCents,
    });
  }
  const maxBar = Math.max(...trend.map((t) => Math.max(t.revenue, t.expenses)), 1);

  // Receivables / payables
  const openInvoices = db
    .select({
      n: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${tables.invoices.totalCents} - ${tables.invoices.paidCents}), 0)`,
      overdueN: sql<number>`coalesce(sum(case when ${tables.invoices.dueDate} < ${now.getTime()} then 1 else 0 end), 0)`,
      overdueTotal: sql<number>`coalesce(sum(case when ${tables.invoices.dueDate} < ${now.getTime()} then ${tables.invoices.totalCents} - ${tables.invoices.paidCents} else 0 end), 0)`,
    })
    .from(tables.invoices)
    .where(and(eq(tables.invoices.companyId, companyId), inArray(tables.invoices.status, ["APPROVED", "SENT"]), eq(tables.invoices.kind, "INVOICE")))
    .get()!;
  const openBills = db
    .select({
      n: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${tables.bills.totalCents} - ${tables.bills.paidCents}), 0)`,
    })
    .from(tables.bills)
    .where(and(eq(tables.bills.companyId, companyId), eq(tables.bills.status, "APPROVED"), eq(tables.bills.kind, "BILL")))
    .get()!;

  // VAT position
  const vatControl = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.systemKey, "VAT_CONTROL")))
    .get();
  const vatBalance = vatControl ? -accountBalance(companyId, vatControl.id) : 0; // credit balance = owed to Revenue
  const nextReturn = db
    .select()
    .from(tables.vatReturns)
    .where(and(eq(tables.vatReturns.companyId, companyId), inArray(tables.vatReturns.status, ["DRAFT", "REVIEW"])))
    .all()
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

  // AI
  const health = healthScore(companyId);
  const suggestions = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .all();
  const anomalies = detectAnomalies(companyId).slice(0, 3);

  const overdueList = db
    .select({ id: tables.invoices.id, number: tables.invoices.number, dueDate: tables.invoices.dueDate, name: tables.contacts.name, due: sql<number>`${tables.invoices.totalCents} - ${tables.invoices.paidCents}` })
    .from(tables.invoices)
    .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
    .where(and(eq(tables.invoices.companyId, companyId), inArray(tables.invoices.status, ["APPROVED", "SENT"]), sql`${tables.invoices.dueDate} < ${now.getTime()}`, sql`${tables.invoices.totalCents} > ${tables.invoices.paidCents}`))
    .orderBy(tables.invoices.dueDate)
    .limit(5)
    .all();

  const scoreColor = health.score >= 85 ? "text-positive-600" : health.score >= 70 ? "text-warn-600" : "text-negative-600";
  const ringColor = health.score >= 85 ? "stroke-positive-500" : health.score >= 70 ? "stroke-warn-500" : "stroke-negative-500";

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Good {now.getHours() < 12 ? "morning" : now.getHours() < 18 ? "afternoon" : "evening"}, {ctx.user.name.split(" ")[0]}</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Here's where {ctx.company.name} stands as of {fmtDate(now)}.
          </p>
        </div>
        <Link href="/inbox" className="btn-ai">
          <Sparkles size={15} />
          {suggestions.length > 0 ? `${suggestions.length} suggestions to review` : "AI inbox"}
        </Link>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cash position" value={<Money cents={cash} />} hint={`${banks.length} account${banks.length === 1 ? "" : "s"}`} />
        <Stat
          label="You're owed"
          value={<Money cents={openInvoices.total} />}
          hint={openInvoices.overdueN > 0 ? `${openInvoices.overdueN} overdue · ${fmtEUR(openInvoices.overdueTotal)}` : "Nothing overdue"}
          tone={openInvoices.overdueN > 0 ? "down" : "up"}
        />
        <Stat label="You owe suppliers" value={<Money cents={openBills.total} />} hint={`${openBills.n} open bill${openBills.n === 1 ? "" : "s"}`} />
        <Stat
          label="VAT set aside"
          value={<Money cents={vatBalance} />}
          hint={nextReturn ? `Next return due ${fmtDateShort(nextReturn.dueDate)}` : "No open period"}
          tone={nextReturn && new Date(nextReturn.dueDate).getTime() - Date.now() < 14 * 86_400_000 ? "down" : "neutral"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* P&L trend */}
        <Card title="Profit & loss — last 6 months" className="lg:col-span-2" action={<Link href="/reports/pnl" className="text-xs font-medium text-brand-700 hover:underline">Full report →</Link>}>
          <div className="px-4 pb-4">
            <div className="mb-3 flex items-baseline gap-4">
              <div>
                <span className="text-2xs uppercase tracking-wide text-ink-400">This month so far</span>
                <div className="text-lg font-semibold tnum">{fmtEUR(pnlMtd.netProfitCents)} <span className="text-xs font-normal text-ink-400">net profit</span></div>
              </div>
              <div className="ml-auto flex items-center gap-3 text-2xs text-ink-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand-500" /> Income</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ink-300" /> Spending</span>
              </div>
            </div>
            <div className="flex gap-3">
              {trend.map((t) => (
                <div key={t.label} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-1">
                    <div className="w-1/3 rounded-t bg-brand-500/90 transition-all" style={{ height: `${Math.max(2, (t.revenue / maxBar) * 112)}px` }} title={`Income ${fmtEUR(t.revenue)}`} />
                    <div className="w-1/3 rounded-t bg-ink-300 transition-all" style={{ height: `${Math.max(2, (t.expenses / maxBar) * 112)}px` }} title={`Spending ${fmtEUR(t.expenses)}`} />
                  </div>
                  <span className="text-2xs text-ink-400">{t.label}</span>
                  <span className={`tnum text-2xs font-medium ${t.profit >= 0 ? "text-positive-600" : "text-negative-600"}`}>{fmtEUR(t.profit, { compact: true })}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Health score */}
        <Card title="Accounting health">
          <div className="flex flex-col items-center px-4 pb-4">
            <div className="relative my-2 h-28 w-28">
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" className="fill-none stroke-ink-100" strokeWidth="9" />
                <circle
                  cx="50" cy="50" r="42"
                  className={`fill-none ${ringColor}`}
                  strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={`${(health.score / 100) * 264} 264`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-2xl font-bold tnum ${scoreColor}`}>{health.score}</span>
                <span className="text-2xs text-ink-400">grade {health.grade}</span>
              </div>
            </div>
            <ul className="w-full space-y-1.5">
              {health.factors.slice(0, 4).map((f, i) => (
                <li key={i}>
                  <Link href={f.href ?? "/inbox"} className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-xs text-ink-600 hover:bg-ink-50">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn-500" />
                    <span className="flex-1">{f.label}</span>
                    <span className="tnum text-negative-500">{f.impact}</span>
                  </Link>
                </li>
              ))}
              {health.factors.length === 0 && <li className="text-center text-xs text-ink-400">Everything is in order — nice books.</li>}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* AI recommendations */}
        <Card title="Lúca recommends" className="lg:col-span-2" action={<Link href="/inbox" className="text-xs font-medium text-ai-700 hover:underline">Open inbox →</Link>}>
          <div className="space-y-0.5 px-2 pb-3">
            {suggestions.length > 0 && (
              <Link href="/inbox" className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-ai-50/60">
                <Sparkles size={14} className="mt-0.5 text-ai-600" />
                <div className="text-[13px] text-ink-700">
                  <strong>{suggestions.length} bank transaction{suggestions.length === 1 ? "" : "s"}</strong> ready to explain — I've matched payments, spotted a likely transfer and categorised the rest with reasoning attached.
                </div>
                <ArrowRight size={14} className="ml-auto mt-0.5 shrink-0 text-ink-300" />
              </Link>
            )}
            {anomalies.map((a, i) => (
              <Link key={i} href={a.evidence[0]?.href ?? "/inbox"} className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-warn-50/60">
                <AlertTriangle size={14} className={`mt-0.5 ${a.severity === "critical" ? "text-negative-500" : "text-warn-500"}`} />
                <div className="text-[13px] text-ink-700">
                  <strong>{a.title}.</strong> {a.detail}
                </div>
                <ArrowRight size={14} className="ml-auto mt-0.5 shrink-0 text-ink-300" />
              </Link>
            ))}
            {nextReturn && (
              <Link href="/vat" className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-brand-50/60">
                <CalendarClock size={14} className="mt-0.5 text-brand-600" />
                <div className="text-[13px] text-ink-700">
                  <strong>VAT return due {fmtDate(nextReturn.dueDate)}.</strong> The draft is prepared — review the boxes and exceptions, then finalise when ready.
                </div>
                <ArrowRight size={14} className="ml-auto mt-0.5 shrink-0 text-ink-300" />
              </Link>
            )}
            {suggestions.length === 0 && anomalies.length === 0 && !nextReturn && (
              <p className="px-2 py-4 text-center text-sm text-ink-400">Nothing needs your attention right now.</p>
            )}
          </div>
        </Card>

        {/* Overdue customers */}
        <Card title="Overdue customers" action={<Link href="/reports/aged-debtors" className="text-xs font-medium text-brand-700 hover:underline">Aged debtors →</Link>}>
          <div className="px-4 pb-4">
            {overdueList.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-400">No one is overdue. 🎉</p>
            ) : (
              <ul className="divide-y divide-ink-100/70">
                {overdueList.map((o) => (
                  <li key={o.id}>
                    <Link href={`/sales/invoices/${o.id}`} className="flex items-center justify-between py-2 hover:bg-ink-50/50">
                      <div>
                        <div className="text-[13px] font-medium text-ink-800">{o.name}</div>
                        <div className="text-2xs text-ink-400">{o.number} · due {fmtDateShort(o.dueDate)}</div>
                      </div>
                      <Money cents={o.due} className="text-[13px] font-semibold" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Bank accounts + reconciliation status */}
      <Card title="Banking" action={<Link href="/banking" className="text-xs font-medium text-brand-700 hover:underline">Reconciliation centre →</Link>}>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          {bankBalances.map((b) => (
            <Link key={b.id} href={`/banking/${b.id}`} className="rounded-xl border border-ink-100 px-4 py-3 transition-colors hover:border-brand-200 hover:bg-brand-25">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-ink-800">{b.name}</div>
                  <div className="text-2xs text-ink-400">{b.ibanMasked}</div>
                </div>
                <Money cents={b.recon.statementBalanceCents} className="text-base font-semibold" />
              </div>
              <div className="mt-2">
                {b.recon.unmatched.length === 0 && b.recon.differenceCents === 0 ? (
                  <Badge tone="green">Fully reconciled</Badge>
                ) : (
                  <Badge tone="amber">
                    {b.recon.unmatched.length} to explain{b.recon.differenceCents !== 0 ? ` · ${fmtEUR(Math.abs(b.recon.differenceCents))} difference` : ""}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
