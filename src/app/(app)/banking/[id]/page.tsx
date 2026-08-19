import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Sparkles, CheckCheck } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { bankReconciliationStatus } from "@/lib/services/banking";
import { explainReconciliation } from "@/lib/ai/insights";
import { fmtEUR } from "@/lib/money";
import { Card, Money, PageHeader, statusBadge, fmtDate } from "@/components/ui";
import { CategoriseForm, CsvImportForm } from "@/components/banking-client";
import { ActionButton } from "@/components/action-button";
import { SuggestionCard, SuggestionView } from "@/components/suggestion-card";
import { reconcileMatchedAction, unmatchTransactionAction, generateSuggestionsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BankAccountPage({ params, searchParams }: { params: { id: string }; searchParams: { view?: string } }) {
  const ctx = await requireCompany();
  const bank = db
    .select()
    .from(tables.bankAccounts)
    .where(and(eq(tables.bankAccounts.id, params.id), eq(tables.bankAccounts.companyId, ctx.companyId)))
    .get();
  if (!bank) notFound();

  const recon = bankReconciliationStatus(ctx.companyId, bank.id);
  const aiExplanation = explainReconciliation(ctx.companyId, bank.id);

  const view = searchParams.view ?? "unexplained";
  const statusFilter = view === "all" ? ["UNRECONCILED", "MATCHED", "RECONCILED", "EXCLUDED"] : view === "matched" ? ["MATCHED"] : view === "reconciled" ? ["RECONCILED"] : ["UNRECONCILED"];

  const txns = db
    .select()
    .from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.bankAccountId, bank.id), inArray(tables.bankTransactions.status, statusFilter)))
    .orderBy(desc(tables.bankTransactions.date))
    .limit(120)
    .all();

  // suggestions per txn
  const sugg = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, ctx.companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .all();
  const suggByTxn = new Map(sugg.filter((s) => s.bankTransactionId).map((s) => [s.bankTransactionId!, s]));

  // form option data
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.archived, false)))
    .orderBy(tables.accounts.code)
    .all()
    .filter((a) => a.subtype !== "BANK")
    .map((a) => ({ id: a.id, label: `${a.code} · ${a.name}`, defaultVatRateId: a.defaultVatRateId }));
  const vatRates = db
    .select()
    .from(tables.vatRates)
    .where(eq(tables.vatRates.companyId, ctx.companyId))
    .all()
    .map((r) => ({ id: r.id, label: r.name, rateBps: r.rateBps, category: r.category }));
  const contacts = db
    .select({ id: tables.contacts.id, name: tables.contacts.name })
    .from(tables.contacts)
    .where(eq(tables.contacts.companyId, ctx.companyId))
    .orderBy(tables.contacts.name)
    .all();

  const matchedCount = db
    .select()
    .from(tables.bankTransactions)
    .where(and(eq(tables.bankTransactions.bankAccountId, bank.id), eq(tables.bankTransactions.status, "MATCHED")))
    .all().length;

  const tabs = [
    { key: "unexplained", label: `To explain (${recon.unmatched.length})` },
    { key: "matched", label: `Matched (${matchedCount})` },
    { key: "reconciled", label: "Reconciled" },
    { key: "all", label: "All" },
  ];

  const balanced = recon.differenceCents === 0 && recon.unmatched.length === 0;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Banking", href: "/banking" }, { label: bank.name }]}
        title={bank.name}
        subtitle={`${bank.bank} · ${bank.ibanMasked}`}
        actions={
          <>
            <CsvImportForm bankAccountId={bank.id} />
            <ActionButton action={generateSuggestionsAction} variant="ai">
              <Sparkles size={14} /> Suggest matches
            </ActionButton>
          </>
        }
      />

      {/* Reconciliation summary */}
      <Card className="mb-5 p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-2xs uppercase tracking-wide text-ink-400">Bank statement</div>
            <Money cents={recon.statementBalanceCents} className="text-lg font-semibold" />
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wide text-ink-400">In your ledger</div>
            <Money cents={recon.ledgerBalanceCents} className="text-lg font-semibold" />
          </div>
          <div>
            <div className="text-2xs uppercase tracking-wide text-ink-400">Difference</div>
            <span className={`tnum text-lg font-semibold ${balanced ? "text-positive-600" : "text-warn-600"}`}>
              {fmtEUR(recon.differenceCents)}
            </span>
          </div>
        </div>
        <div className={`mt-3 rounded-lg px-3 py-2.5 text-[13px] ${balanced ? "bg-positive-50 text-positive-700" : "bg-ai-50 text-ink-700"}`}>
          <span className="mr-1.5 inline-flex items-center gap-1 font-semibold text-ai-700">
            <Sparkles size={12} /> Lúca:
          </span>
          {aiExplanation.answer}
        </div>
        {matchedCount > 0 && ctx.can("reconcile") && (
          <div className="mt-3 flex justify-end">
            <ActionButton action={reconcileMatchedAction.bind(null, bank.id)} variant="primary">
              <CheckCheck size={14} /> Reconcile {matchedCount} matched
            </ActionButton>
          </div>
        )}
      </Card>

      {/* Tabs */}
      <div className="mb-3 flex gap-1 border-b border-ink-100">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/banking/${bank.id}?view=${t.key}`}
            className={`border-b-2 px-3 py-2 text-[13px] font-medium ${view === t.key ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Transactions */}
      <div className="space-y-2">
        {txns.length === 0 && (
          <Card>
            <div className="px-6 py-10 text-center text-sm text-ink-400">Nothing here.</div>
          </Card>
        )}
        {txns.map((t) => {
          const s = suggByTxn.get(t.id);
          const suggView: SuggestionView | null = s
            ? {
                id: s.id,
                kind: s.kind,
                explanation: s.explanation,
                confidence: s.confidence,
                source: s.source,
                evidence: s.evidence ? JSON.parse(s.evidence) : [],
                proposal: (() => {
                  const p = JSON.parse(s.payload);
                  if (p.action === "CATEGORISE") return `Post to ${p.accountName}${p.vatCents > 0 ? ` (incl. ${fmtEUR(p.vatCents)} VAT)` : ""}`;
                  if (p.action === "MATCH") return `Match to ${p.allocations.map((a: { number: string }) => a.number).join(" + ")}`;
                  if (p.action === "TRANSFER") return `Transfer to ${p.otherAccountName}`;
                  return null;
                })(),
                txn: null,
              }
            : null;

          return (
            <Card key={t.id} className="p-3.5">
              <div className="flex items-center gap-4">
                <div className="w-20 shrink-0 text-xs text-ink-400">{fmtDate(t.date)}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink-800">{t.description}</div>
                  {t.reference && <div className="text-2xs text-ink-400">{t.reference}</div>}
                </div>
                <Money cents={t.amountCents} signed className="w-28 shrink-0 text-right text-[13px] font-semibold" />
                <div className="w-28 shrink-0 text-right">{statusBadge(t.status)}</div>
                {t.status === "MATCHED" && ctx.can("post") && (
                  <ActionButton action={unmatchTransactionAction.bind(null, t.id)} variant="ghost" className="!px-2 !py-1 text-2xs">
                    Undo
                  </ActionButton>
                )}
              </div>
              {t.status === "UNRECONCILED" && (
                <div className="mt-2 border-t border-ink-100/70 pt-2">
                  {suggView ? (
                    <SuggestionCard s={suggView} canPost={ctx.can("post")} />
                  ) : null}
                  {ctx.can("post") && (
                    <div className={suggView ? "mt-1.5" : ""}>
                      <CategoriseForm txnId={t.id} grossCents={Math.abs(t.amountCents)} accounts={accounts} vatRates={vatRates} contacts={contacts} />
                    </div>
                  )}
                </div>
              )}
              {t.journalId && t.status !== "UNRECONCILED" && (
                <div className="mt-1.5 text-right">
                  <Link href={`/ledger/journals/${t.journalId}`} className="text-2xs text-ink-400 hover:text-brand-700">View journal →</Link>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
