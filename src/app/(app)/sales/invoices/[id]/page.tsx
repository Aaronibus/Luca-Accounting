import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { fmtEUR } from "@/lib/money";
import { Card, Money, PageHeader, Table, statusBadge, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { PaymentForm } from "@/components/payment-form";
import { approveInvoiceAction, voidInvoiceAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCompany();
  const row = db
    .select({ inv: tables.invoices, contactName: tables.contacts.name, contactId: tables.contacts.id, county: tables.contacts.county, email: tables.contacts.email })
    .from(tables.invoices)
    .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
    .where(and(eq(tables.invoices.id, params.id), eq(tables.invoices.companyId, ctx.companyId)))
    .get();
  if (!row) notFound();
  const { inv } = row;

  const lines = db.select().from(tables.invoiceLines).where(eq(tables.invoiceLines.invoiceId, inv.id)).orderBy(tables.invoiceLines.sortOrder).all();
  const accounts = db.select().from(tables.accounts).where(eq(tables.accounts.companyId, ctx.companyId)).all();
  const accountMap = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const rateMap = new Map(vatRates.map((r) => [r.id, r.name]));

  const allocations = db
    .select({ alloc: tables.paymentAllocations, payment: tables.payments })
    .from(tables.paymentAllocations)
    .innerJoin(tables.payments, eq(tables.paymentAllocations.paymentId, tables.payments.id))
    .where(eq(tables.paymentAllocations.invoiceId, inv.id))
    .all();

  const banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, ctx.companyId)).all();
  const remaining = inv.totalCents - inv.paidCents;
  const isDraft = ["DRAFT", "AWAITING_APPROVAL"].includes(inv.status);
  const isOpen = ["APPROVED", "SENT"].includes(inv.status) && remaining > 0;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: inv.number }]}
        title={`${inv.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice"} ${inv.number}`}
        subtitle={<span>{row.contactName}{row.county ? ` · ${row.county}` : ""} · issued {fmtDate(inv.date)} · due {fmtDate(inv.dueDate)}</span>}
        actions={
          <>
            {statusBadge(inv.status)}
            {isDraft && ctx.can("approve") && (
              <ActionButton action={approveInvoiceAction.bind(null, inv.id)} variant="primary">Approve & post</ActionButton>
            )}
            {!isDraft && inv.status !== "VOID" && inv.paidCents === 0 && ctx.can("post") && (
              <ActionButton action={voidInvoiceAction.bind(null, inv.id, "Voided from invoice page")} variant="danger" confirm="Void this invoice? A reversal journal will be posted — history is preserved.">
                Void
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <Table
              head={
                <>
                  <th className="table-th">Description</th>
                  <th className="table-th">Account</th>
                  <th className="table-th">VAT</th>
                  <th className="table-th text-right">Qty</th>
                  <th className="table-th text-right">Unit</th>
                  <th className="table-th text-right">Net</th>
                </>
              }
            >
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="table-td">{l.description}</td>
                  <td className="table-td text-xs text-ink-500">{accountMap.get(l.accountId)}</td>
                  <td className="table-td text-xs text-ink-500">{rateMap.get(l.vatRateId)}</td>
                  <td className="table-td text-right tnum">{l.quantity}</td>
                  <td className="table-td text-right"><Money cents={l.unitPriceCents} /></td>
                  <td className="table-td text-right"><Money cents={l.netCents} /></td>
                </tr>
              ))}
            </Table>
            <div className="flex justify-end px-4 py-3">
              <div className="w-64 space-y-1 text-[13px]">
                <div className="flex justify-between text-ink-500"><span>Subtotal</span><Money cents={inv.subtotalCents} /></div>
                <div className="flex justify-between text-ink-500"><span>VAT</span><Money cents={inv.vatCents} /></div>
                <div className="flex justify-between border-t border-ink-100 pt-1 font-semibold"><span>Total</span><Money cents={inv.totalCents} /></div>
                {inv.paidCents > 0 && (
                  <>
                    <div className="flex justify-between text-positive-600"><span>Paid</span><span className="tnum">-{fmtEUR(inv.paidCents)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Amount due</span><Money cents={remaining} /></div>
                  </>
                )}
              </div>
            </div>
          </Card>

          {isOpen && ctx.can("post") && (
            <PaymentForm direction="RECEIVE" invoiceId={inv.id} contactId={row.contactId} banks={banks.map((b) => ({ id: b.id, name: b.name }))} remaining={(remaining / 100).toFixed(2)} />
          )}
        </div>

        <div className="space-y-5">
          <Card title="Payments">
            <div className="px-4 pb-4">
              {allocations.length === 0 ? (
                <p className="text-xs text-ink-400">No payments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {allocations.map(({ alloc, payment }) => (
                    <li key={alloc.id} className="flex justify-between text-[13px]">
                      <span className="text-ink-600">{fmtDate(payment.date)}</span>
                      <Money cents={alloc.amountCents} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card title="Accounting">
            <div className="space-y-2 px-4 pb-4 text-[13px]">
              {inv.journalId ? (
                <>
                  <p className="text-ink-600">Posted as a balanced journal: debtors {inv.kind === "CREDIT_NOTE" ? "credited" : "debited"} {fmtEUR(inv.totalCents)}, income and VAT control on the other side.</p>
                  <Link href={`/ledger/journals/${inv.journalId}`} className="font-medium text-brand-700 hover:underline">View journal →</Link>
                </>
              ) : (
                <p className="text-ink-500">Drafts have no ledger effect — approving posts the journal.</p>
              )}
              {inv.voidJournalId && (
                <Link href={`/ledger/journals/${inv.voidJournalId}`} className="block font-medium text-brand-700 hover:underline">View reversal journal →</Link>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
