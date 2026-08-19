import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, Sparkles, RefreshCcw, Zap, History } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { detectAnomalies } from "@/lib/ai/anomalies";
import { fmtEUR } from "@/lib/money";
import { Card, PageHeader, EmptyState, Badge, fmtDate, statusBadge } from "@/components/ui";
import { SuggestionCard, SuggestionView } from "@/components/suggestion-card";
import { ActionButton } from "@/components/action-button";
import { generateSuggestionsAction, bulkReconcileAction, approveBillAction, approveExpenseAction, approveInvoiceAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const ctx = await requireCompany();
  const { companyId } = ctx;

  const suggestions = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, companyId), eq(tables.suggestions.status, "SUGGESTED")))
    .orderBy(desc(tables.suggestions.confidence))
    .all();

  const txnIds = suggestions.map((s) => s.bankTransactionId).filter(Boolean) as string[];
  const txns = txnIds.length
    ? db.select().from(tables.bankTransactions).where(inArray(tables.bankTransactions.id, txnIds)).all()
    : [];
  const txnMap = new Map(txns.map((t) => [t.id, t]));

  const views: SuggestionView[] = suggestions.map((s) => {
    const t = s.bankTransactionId ? txnMap.get(s.bankTransactionId) : null;
    const payload = JSON.parse(s.payload);
    let proposal: string | null = null;
    if (payload.action === "CATEGORISE") proposal = `Post to ${payload.accountName}${payload.vatCents > 0 ? ` (incl. ${fmtEUR(payload.vatCents)} VAT)` : ""}${payload.contactName ? ` · ${payload.contactName}` : ""}`;
    if (payload.action === "MATCH") proposal = `Match to ${payload.allocations.map((a: { number: string }) => a.number).join(" + ")}${payload.contactName ? ` — ${payload.contactName}` : ""}`;
    if (payload.action === "TRANSFER") proposal = `Record as transfer to ${payload.otherAccountName}`;
    return {
      id: s.id,
      kind: s.kind,
      explanation: s.explanation,
      confidence: s.confidence,
      source: s.source,
      evidence: s.evidence ? JSON.parse(s.evidence) : [],
      proposal,
      txn: t
        ? { date: fmtDate(t.date), description: t.description, amountFormatted: fmtEUR(t.amountCents, { sign: true }), negative: t.amountCents < 0 }
        : null,
    };
  });

  const anomalies = detectAnomalies(companyId);

  const draftInvoices = db
    .select({ inv: tables.invoices, name: tables.contacts.name })
    .from(tables.invoices)
    .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
    .where(and(eq(tables.invoices.companyId, companyId), inArray(tables.invoices.status, ["DRAFT", "AWAITING_APPROVAL"])))
    .all();
  const draftBills = db
    .select({ bill: tables.bills, name: tables.contacts.name })
    .from(tables.bills)
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .where(and(eq(tables.bills.companyId, companyId), inArray(tables.bills.status, ["DRAFT", "AWAITING_APPROVAL"])))
    .all();
  const draftExpenses = db
    .select()
    .from(tables.expenses)
    .where(and(eq(tables.expenses.companyId, companyId), eq(tables.expenses.status, "DRAFT")))
    .all();

  const recentActivity = db
    .select()
    .from(tables.suggestions)
    .where(and(eq(tables.suggestions.companyId, companyId), inArray(tables.suggestions.status, ["ACCEPTED", "REJECTED"])))
    .orderBy(desc(tables.suggestions.actedAt))
    .limit(10)
    .all();

  const canPost = ctx.can("post");

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Everything Lúca has prepared, spotted or queued for your judgement. Nothing posts without approval."
        actions={
          <>
            <ActionButton action={generateSuggestionsAction} variant="secondary">
              <RefreshCcw size={14} /> Re-analyse
            </ActionButton>
            {canPost && (
              <ActionButton action={bulkReconcileAction} variant="ai" confirm="Apply all suggestions with ≥92% confidence? Each one posts through the normal engine with a full audit trail, and can be reversed.">
                <Zap size={14} /> Apply high-confidence
              </ActionButton>
            )}
          </>
        }
      />

      <div className="space-y-6">
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800">
            <Sparkles size={15} className="text-ai-600" /> Suggested by Lúca
            {views.length > 0 && <Badge tone="ai">{views.length}</Badge>}
          </h2>
          {views.length === 0 ? (
            <Card>
              <EmptyState title="Nothing waiting for review" body="When new bank transactions arrive, Lúca will match, categorise and explain them here." />
            </Card>
          ) : (
            <div className="space-y-2.5">
              {views.map((v) => (
                <SuggestionCard key={v.id} s={v} canPost={canPost} />
              ))}
            </div>
          )}
        </section>

        {anomalies.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800">
              <AlertTriangle size={15} className="text-warn-500" /> Worth checking
              <Badge tone="amber">{anomalies.length}</Badge>
            </h2>
            <div className="space-y-2.5">
              {anomalies.map((a, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${a.severity === "critical" ? "text-negative-500" : a.severity === "warning" ? "text-warn-500" : "text-ink-400"}`} />
                    <div>
                      <div className="text-[13px] font-semibold text-ink-800">{a.title}</div>
                      <p className="mt-0.5 text-[13px] text-ink-600">{a.detail}</p>
                      {a.evidence.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {a.evidence.map((e, j) => (
                            <Link key={j} href={e.href} className="rounded-full border border-ink-200 px-2 py-0.5 text-2xs text-ink-500 hover:border-brand-300 hover:text-brand-700">
                              {e.label} →
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {(draftInvoices.length > 0 || draftBills.length > 0 || draftExpenses.length > 0) && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-800">Drafts awaiting approval</h2>
            <Card>
              <ul className="divide-y divide-ink-100/70 px-4 py-1">
                {draftInvoices.map(({ inv, name }) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <Link href={`/sales/invoices/${inv.id}`} className="text-[13px] font-medium text-ink-800 hover:text-brand-700">
                        Invoice {inv.number} — {name}
                      </Link>
                      <div className="text-2xs text-ink-400">{fmtDate(inv.date)} · {fmtEUR(inv.totalCents)}</div>
                    </div>
                    {ctx.can("approve") && (
                      <ActionButton action={approveInvoiceAction.bind(null, inv.id)} variant="secondary">Approve & post</ActionButton>
                    )}
                  </li>
                ))}
                {draftBills.map(({ bill, name }) => (
                  <li key={bill.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <Link href={`/purchases/bills/${bill.id}`} className="text-[13px] font-medium text-ink-800 hover:text-brand-700">
                        Bill {bill.number} — {name}
                      </Link>
                      <div className="text-2xs text-ink-400">
                        {fmtDate(bill.date)} · {fmtEUR(bill.totalCents)}{bill.origin === "DOCUMENT_EXTRACTION" && " · extracted from document"}
                      </div>
                    </div>
                    {ctx.can("approve") && (
                      <ActionButton action={approveBillAction.bind(null, bill.id)} variant="secondary">Approve & post</ActionButton>
                    )}
                  </li>
                ))}
                {draftExpenses.map((exp) => (
                  <li key={exp.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <span className="text-[13px] font-medium text-ink-800">Expense — {exp.merchant}</span>
                      <div className="text-2xs text-ink-400">
                        {fmtDate(exp.date)} · {fmtEUR(exp.grossCents)}{exp.origin === "RECEIPT_SCAN" && " · from receipt scan"}
                      </div>
                    </div>
                    {ctx.can("approve") && (
                      <ActionButton action={approveExpenseAction.bind(null, exp.id)} variant="secondary">Approve & post</ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        {recentActivity.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-800">
              <History size={15} className="text-ink-400" /> Recent AI decisions
            </h2>
            <Card>
              <ul className="divide-y divide-ink-100/70 px-4 py-1">
                {recentActivity.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                    <p className="text-[13px] text-ink-600">{s.explanation}</p>
                    {statusBadge(s.status)}
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
