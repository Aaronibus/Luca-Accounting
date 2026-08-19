import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { accountBalances, presentedBalance } from "@/lib/engine/reports";
import { AccountType } from "@/lib/types";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

const TYPE_ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses",
};

export default async function LedgerPage() {
  const ctx = await requireCompany();
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.archived, false)))
    .orderBy(tables.accounts.code)
    .all();
  const balances = new Map(accountBalances(ctx.companyId).map((b) => [b.accountId, b.netCents]));

  return (
    <div>
      <PageHeader
        title="General ledger"
        subtitle="The chart of accounts and every journal behind your numbers."
        actions={
          <>
            <Link href="/ledger/journals" className="btn-secondary">Journals</Link>
            {ctx.can("post") && <Link href="/ledger/journals/new" className="btn-primary"><Plus size={15} /> Manual journal</Link>}
          </>
        }
      />
      <div className="space-y-5">
        {TYPE_ORDER.map((type) => {
          const group = accounts.filter((a) => a.type === type);
          if (group.length === 0) return null;
          return (
            <Card key={type} title={TYPE_LABEL[type]}>
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {group.map((a) => {
                    const net = balances.get(a.id) ?? 0;
                    const presented = presentedBalance(type, net);
                    return (
                      <tr key={a.id} className="hover:bg-ink-50/50">
                        <td className="table-td w-16 tnum text-ink-400">{a.code}</td>
                        <td className="table-td">
                          <Link href={`/ledger/accounts/${a.id}`} className="font-medium text-ink-800 hover:text-brand-700">{a.name}</Link>
                          {a.isControl && <span className="ml-2"><Badge tone="blue">control</Badge></span>}
                          {a.description && <div className="text-2xs text-ink-400">{a.description}</div>}
                        </td>
                        <td className="table-td w-28 text-xs capitalize text-ink-400">{a.subtype.toLowerCase().replace(/_/g, " ")}</td>
                        <td className="table-td w-32 tnum text-right font-medium">{net === 0 ? <span className="text-ink-300">—</span> : fmtEUR(presented)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
