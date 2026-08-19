import Link from "next/link";
import { eq } from "drizzle-orm";
import { Landmark, ArrowRight, Plus } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { bankReconciliationStatus } from "@/lib/services/banking";
import { fmtEUR } from "@/lib/money";
import { Card, Money, PageHeader, Badge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BankingPage() {
  const ctx = await requireCompany();
  const banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, ctx.companyId)).all();
  const withStatus = banks.map((b) => ({ bank: b, recon: bankReconciliationStatus(ctx.companyId, b.id) }));

  return (
    <div>
      <PageHeader
        title="Banking"
        subtitle="Import statements, let Lúca explain the transactions, and keep every account reconciled to the cent."
        actions={
          <>
            <Link href="/banking/rules" className="btn-secondary">Bank rules</Link>
            <Link href="/banking/new" className="btn-primary"><Plus size={15} /> Add bank account</Link>
          </>
        }
      />
      {withStatus.length === 0 && (
        <Card>
          <EmptyState
            icon={<Landmark size={26} />}
            title="No bank account connected yet"
            body="Add the account your business trades through, then import a statement — Lúca will match payments to invoices and bills and explain the rest."
            action={<Link href="/banking/new" className="btn-primary"><Plus size={15} /> Add bank account</Link>}
          />
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {withStatus.map(({ bank, recon }) => (
          <Link key={bank.id} href={`/banking/${bank.id}`} className="card group p-5 transition-colors hover:border-brand-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Landmark size={17} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink-900">{bank.name}</div>
                  <div className="text-2xs text-ink-400">{bank.bank} · {bank.ibanMasked}</div>
                </div>
              </div>
              <ArrowRight size={16} className="text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="text-2xs uppercase tracking-wide text-ink-400">Statement balance</div>
                <Money cents={recon.statementBalanceCents} className="text-xl font-semibold" />
              </div>
              <div className="text-right">
                {recon.unmatched.length === 0 && recon.differenceCents === 0 ? (
                  <Badge tone="green">Reconciled</Badge>
                ) : (
                  <div className="space-y-1">
                    {recon.unmatched.length > 0 && <div><Badge tone="amber">{recon.unmatched.length} to explain</Badge></div>}
                    {recon.differenceCents !== 0 && <div className="text-2xs text-ink-500">Ledger gap {fmtEUR(recon.differenceCents)}</div>}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
