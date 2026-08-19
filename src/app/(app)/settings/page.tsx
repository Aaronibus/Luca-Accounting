import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Building2, Plus, Sparkles } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany, userCompanies } from "@/lib/auth";
import { bpsToPercent } from "@/lib/money";
import { companyEmptiness } from "@/lib/services/companies";
import { llmConfigured } from "@/lib/ai/llm";
import { Card, PageHeader, Table, Badge, fmtDate } from "@/components/ui";
import { PeriodLockForm } from "@/components/period-lock-form";
import { CompanySettingsForm, ArchiveCompanyButton } from "@/components/company-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireCompany();
  const { company } = ctx;
  const canAdmin = ctx.can("admin");

  const members = db
    .select({ m: tables.memberships, name: tables.users.name, email: tables.users.email })
    .from(tables.memberships)
    .innerJoin(tables.users, eq(tables.memberships.userId, tables.users.id))
    .where(eq(tables.memberships.companyId, ctx.companyId))
    .all();

  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const accountCount = db.select().from(tables.accounts).where(eq(tables.accounts.companyId, ctx.companyId)).all().length;
  const sequences = db.select().from(tables.numberSequences).where(eq(tables.numberSequences.companyId, ctx.companyId)).all();
  const locks = db.select().from(tables.periodLocks).where(eq(tables.periodLocks.companyId, ctx.companyId)).orderBy(desc(tables.periodLocks.lockedThrough)).all();
  const emptiness = companyEmptiness(ctx.companyId);
  const allCompanies = userCompanies(ctx.user.id, { includeArchived: true });

  const audit = db
    .select({ a: tables.auditLogs, userName: tables.users.name })
    .from(tables.auditLogs)
    .leftJoin(tables.users, eq(tables.auditLogs.userId, tables.users.id))
    .where(eq(tables.auditLogs.companyId, ctx.companyId))
    .orderBy(desc(tables.auditLogs.createdAt))
    .limit(30)
    .all();

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle={`${company.name}${company.isDemo ? " · demo company" : ""} — company details, tax, team, numbering, locks and the audit trail.`}
        actions={<Link href="/companies/new" className="btn-secondary"><Plus size={15} /> New company</Link>}
      />

      <div className="space-y-5">
        <Card title="Company details">
          <div className="px-4 pb-4 pt-1">
            <CompanySettingsForm
              canEdit={canAdmin && !company.isDemo}
              initial={{
                name: company.name,
                tradingName: company.tradingName ?? "",
                croNumber: company.croNumber ?? "",
                vatNumber: company.vatNumber ?? "",
                entityType: company.entityType,
                industry: company.industry ?? "",
                addressLine1: company.addressLine1 ?? "",
                city: company.city ?? "",
                county: company.county ?? "",
                eircode: company.eircode ?? "",
                country: company.country,
                contactEmail: company.contactEmail ?? "",
                contactPhone: company.contactPhone ?? "",
                vatBasis: company.vatBasis,
                vatPeriodMonths: company.vatPeriodMonths,
                yearEndMonth: company.yearEndMonth,
                yearEndDay: company.yearEndDay,
                baseCurrency: company.baseCurrency,
              }}
            />
            {company.isDemo && (
              <p className="mt-3 rounded-lg bg-ai-50 px-3 py-2 text-xs text-ai-700">
                This is a demo company — its details are read-only. Create a real company to edit settings.
              </p>
            )}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Your companies">
            <ul className="divide-y divide-ink-100/70 px-4 pb-3">
              {allCompanies.map((c) => (
                <li key={c.companyId} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Building2 size={13} className="text-ink-400" />
                      <span className={`truncate text-[13px] ${c.companyId === ctx.companyId ? "font-semibold text-brand-700" : "text-ink-800"}`}>
                        {c.name}
                      </span>
                      {c.isDemo && <Badge tone="ai">DEMO</Badge>}
                      {c.archived && <Badge tone="grey">archived</Badge>}
                    </div>
                    <span className="text-2xs text-ink-400">{c.role.toLowerCase()}{c.city ? ` · ${c.city}` : ""}</span>
                  </div>
                  {c.companyId === ctx.companyId ? (
                    <span className="text-2xs uppercase tracking-wide text-ink-400">current</span>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="px-4 pb-4 text-2xs text-ink-400">
              Each company is a fully isolated accounting file — data, reports, documents and AI context never cross between them.
            </p>
          </Card>

          <Card title="Team & access" >
            <div id="team" />
            <Table
              head={
                <>
                  <th className="table-th">Person</th>
                  <th className="table-th">Role</th>
                  <th className="table-th">Since</th>
                </>
              }
            >
              {members.map(({ m, name, email }) => (
                <tr key={m.id}>
                  <td className="table-td">
                    <div className="font-medium">{name}</div>
                    <div className="text-2xs text-ink-400">{email}</div>
                  </td>
                  <td className="table-td"><Badge tone={m.role === "OWNER" ? "blue" : m.role === "ACCOUNTANT" ? "green" : "grey"}>{m.role.toLowerCase()}</Badge></td>
                  <td className="table-td text-xs text-ink-500">{m.createdAt ? fmtDate(m.createdAt) : ""}</td>
                </tr>
              ))}
            </Table>
            <p className="px-4 py-3 text-2xs text-ink-400">
              Roles map to capabilities enforced server-side: owners and admins manage settings, accountants file VAT and
              lock periods, bookkeepers post and reconcile, employees submit expenses, viewers read only.
            </p>
          </Card>

          <Card title="Chart of accounts & numbering">
            <div className="space-y-3 px-4 pb-4 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-600">Irish chart of accounts</span>
                <Link href="/ledger" className="font-medium text-brand-700 hover:underline">{accountCount} accounts →</Link>
              </div>
              <div className="border-t border-ink-100 pt-3">
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">Document numbering</p>
                <ul className="space-y-1">
                  {sequences.map((s) => (
                    <li key={s.id} className="flex justify-between text-ink-600">
                      <span className="capitalize">{s.key.toLowerCase().replace(/_/g, " ")}</span>
                      <span className="tnum text-ink-500">{s.prefix}{String(s.nextValue).padStart(4, "0")} next</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Card>

          <Card title="Irish VAT rates (date-effective)">
            <Table
              head={
                <>
                  <th className="table-th">Rate</th>
                  <th className="table-th">Category</th>
                  <th className="table-th text-right">%</th>
                  <th className="table-th">From</th>
                </>
              }
            >
              {vatRates.map((r) => (
                <tr key={r.id}>
                  <td className="table-td font-medium">{r.name}</td>
                  <td className="table-td text-xs capitalize text-ink-500">{r.category.toLowerCase().replace(/_/g, " ")}</td>
                  <td className="table-td tnum text-right">{bpsToPercent(r.rateBps)}</td>
                  <td className="table-td text-xs text-ink-500">{fmtDate(r.validFrom)}</td>
                </tr>
              ))}
            </Table>
            <p className="px-4 py-3 text-2xs text-ink-400">
              Rates are configuration, not code — when the Finance Act changes a rate, add a new date-effective row.
              Historic postings keep their original treatment.
            </p>
          </Card>

          <Card title="Period locks">
            <div className="px-4 pb-4">
              {locks.length > 0 ? (
                <ul className="mb-4 space-y-1.5">
                  {locks.map((l) => (
                    <li key={l.id} className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-[13px]">
                      <span className="font-medium">Locked through {fmtDate(l.lockedThrough)}</span>
                      <span className="text-xs text-ink-500">{l.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-[13px] text-ink-400">No period locks yet. VAT finalisation adds them automatically.</p>
              )}
              {ctx.can("lock") && <PeriodLockForm />}
            </div>
          </Card>

          <Card title="AI settings">
            <div className="space-y-2 px-4 pb-4 text-[13px] text-ink-600">
              <div className="flex items-center justify-between">
                <span>Language model tier</span>
                <Badge tone={llmConfigured() ? "green" : "grey"}>{llmConfigured() ? "enabled" : "not configured"}</Badge>
              </div>
              <p className="text-xs text-ink-500">
                Lúca is deterministic-first: rules, document matching, transfer detection, merchant memory and the Irish
                merchant knowledge base produce every accounting suggestion, scoped strictly to this company. Setting{" "}
                <code className="rounded bg-ink-50 px-1">ANTHROPIC_API_KEY</code> additionally lets the copilot phrase
                grounded answers in natural language and refine weak document-extraction fields. Figures always come from
                this company's ledger.
              </p>
              <div className="flex items-center justify-between border-t border-ink-100 pt-2">
                <span>Automatic posting threshold</span>
                <span className="tnum text-ink-800">92% confidence</span>
              </div>
              <p className="text-xs text-ink-500">
                Only rule matches and exact document matches at or above this confidence can be applied in bulk — and every
                one is posted through the normal engine with a full audit trail.
              </p>
            </div>
          </Card>
        </div>

        <Card title="This accounting file">
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-3">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Activity</p>
              <ul className="mt-1 space-y-0.5 text-[13px] text-ink-600">
                <li className="tnum">{emptiness.journals} journals</li>
                <li className="tnum">{emptiness.invoices} invoices · {emptiness.bills} bills</li>
                <li className="tnum">{emptiness.expenses} expenses</li>
                <li className="tnum">{emptiness.bankAccounts} bank accounts · {emptiness.bankTransactions} transactions</li>
                <li className="tnum">{emptiness.contacts} contacts</li>
              </ul>
            </div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Set up</p>
              <ul className="mt-1 space-y-1 text-[13px]">
                <li><Link href="/ledger/opening-balances" className="text-brand-700 hover:underline">Opening balances →</Link></li>
                <li><Link href="/banking/new" className="text-brand-700 hover:underline">Add a bank account →</Link></li>
                <li><Link href="/banking/rules" className="text-brand-700 hover:underline">Bank rules →</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wider text-ink-400">Danger zone</p>
              <p className="mb-2 mt-1 text-xs text-ink-500">
                Archiving hides a company from the switcher. Accounting records are never deleted — the audit trail is permanent.
              </p>
              {canAdmin && <ArchiveCompanyButton companyId={ctx.companyId} name={company.name} />}
            </div>
          </div>
        </Card>

        <Card title="Audit trail (latest 30 events)">
          <Table
            head={
              <>
                <th className="table-th">When</th>
                <th className="table-th">Who</th>
                <th className="table-th">Action</th>
                <th className="table-th">Entity</th>
              </>
            }
            dense
          >
            {audit.map(({ a, userName }) => (
              <tr key={a.id}>
                <td className="table-td whitespace-nowrap text-ink-500">{a.createdAt ? new Date(a.createdAt).toLocaleString("en-IE") : ""}</td>
                <td className="table-td">{userName ?? "System"}</td>
                <td className="table-td"><code className="rounded bg-ink-50 px-1.5 py-0.5 text-2xs">{a.action}</code></td>
                <td className="table-td text-ink-500">{a.entityType}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <p className="flex items-center gap-1.5 text-2xs text-ink-400">
          <Sparkles size={12} /> Every action on this page is scoped to {company.name} and recorded in its audit trail.
        </p>
      </div>
    </div>
  );
}
