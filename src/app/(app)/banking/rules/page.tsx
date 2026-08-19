import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, PageHeader, Table, Badge, EmptyState } from "@/components/ui";
import { BankRuleForm } from "@/components/bank-rule-form";

export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const ctx = await requireCompany();
  const rules = db.select().from(tables.bankRules).where(eq(tables.bankRules.companyId, ctx.companyId)).orderBy(tables.bankRules.priority).all();
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(eq(tables.accounts.companyId, ctx.companyId))
    .orderBy(tables.accounts.code)
    .all();
  const accountMap = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Banking", href: "/banking" }, { label: "Rules" }]}
        title="Bank rules"
        subtitle="Your own deterministic rules — they outrank every other AI tier and fire with 96% confidence."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            {rules.length === 0 ? (
              <EmptyState title="No rules yet" body="Rules teach Lúca exactly how you want recurring bank lines treated — e.g. 'SUMUP PAYOUT' → Sales at 23%." />
            ) : (
              <Table
                head={
                  <>
                    <th className="table-th">Rule</th>
                    <th className="table-th">When narrative contains</th>
                    <th className="table-th">Direction</th>
                    <th className="table-th">Categorise to</th>
                    <th className="table-th">Fired</th>
                  </>
                }
              >
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="table-td font-medium">{r.name}</td>
                    <td className="table-td"><code className="rounded bg-ink-50 px-1.5 py-0.5 text-xs">{r.matchText}</code></td>
                    <td className="table-td">{r.direction === "IN" ? <Badge tone="green">Money in</Badge> : r.direction === "OUT" ? <Badge tone="red">Money out</Badge> : <Badge>Any</Badge>}</td>
                    <td className="table-td">{r.setAccountId ? accountMap.get(r.setAccountId) : "—"}</td>
                    <td className="table-td tnum">{r.hitCount}×</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
        <div>
          <Card title="New rule">
            <div className="px-4 pb-4">
              <BankRuleForm
                accounts={accounts.filter((a) => a.subtype !== "BANK").map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
                vatRates={vatRates.map((r) => ({ id: r.id, label: r.name }))}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
