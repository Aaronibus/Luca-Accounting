import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ScanText } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { fmtEUR } from "@/lib/money";
import { Card, Money, PageHeader, Table, statusBadge, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { PaymentForm } from "@/components/payment-form";
import { approveBillAction, voidBillAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const ctx = await requireCompany();
  const row = db
    .select({ bill: tables.bills, contactName: tables.contacts.name, contactId: tables.contacts.id })
    .from(tables.bills)
    .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
    .where(and(eq(tables.bills.id, params.id), eq(tables.bills.companyId, ctx.companyId)))
    .get();
  if (!row) notFound();
  const { bill } = row;

  const lines = db.select().from(tables.billLines).where(eq(tables.billLines.billId, bill.id)).orderBy(tables.billLines.sortOrder).all();
  const accounts = db.select().from(tables.accounts).where(eq(tables.accounts.companyId, ctx.companyId)).all();
  const accountMap = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const rateMap = new Map(vatRates.map((r) => [r.id, r.name]));
  const documents = db.select().from(tables.documents).where(eq(tables.documents.billId, bill.id)).all();

  const allocations = db
    .select({ alloc: tables.paymentAllocations, payment: tables.payments })
    .from(tables.paymentAllocations)
    .innerJoin(tables.payments, eq(tables.paymentAllocations.paymentId, tables.payments.id))
    .where(eq(tables.paymentAllocations.billId, bill.id))
    .all();

  const banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, ctx.companyId)).all();
  const remaining = bill.totalCents - bill.paidCents;
  const isDraft = ["DRAFT", "AWAITING_APPROVAL"].includes(bill.status);
  const isOpen = bill.status === "APPROVED" && remaining > 0;

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: bill.number }]}
        title={`Bill ${bill.number}`}
        subtitle={<span>{row.contactName} · dated {fmtDate(bill.date)} · due {fmtDate(bill.dueDate)}{bill.supplierRef ? ` · ref ${bill.supplierRef}` : ""}</span>}
        actions={
          <>
            {statusBadge(bill.status)}
            {isDraft && ctx.can("approve") && <ActionButton action={approveBillAction.bind(null, bill.id)} variant="primary">Approve & post</ActionButton>}
            {!isDraft && bill.status !== "VOID" && bill.paidCents === 0 && ctx.can("post") && (
              <ActionButton action={voidBillAction.bind(null, bill.id, "Voided from bill page")} variant="danger" confirm="Void this bill via a reversal journal?">Void</ActionButton>
            )}
          </>
        }
      />

      {bill.origin === "DOCUMENT_EXTRACTION" && isDraft && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-ai-200 bg-ai-50 px-4 py-3 text-[13px] text-ink-700">
          <ScanText size={15} className="mt-0.5 text-ai-600" />
          <span>This draft was extracted from an uploaded document. Check the supplier, amounts and VAT before approving — nothing has been posted yet.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <Table
              head={
                <>
                  <th className="table-th">Description</th>
                  <th className="table-th">Account</th>
                  <th className="table-th">VAT</th>
                  <th className="table-th text-right">Net</th>
                  <th className="table-th text-right">VAT €</th>
                </>
              }
            >
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="table-td">{l.description}</td>
                  <td className="table-td text-xs text-ink-500">{accountMap.get(l.accountId)}</td>
                  <td className="table-td text-xs text-ink-500">{rateMap.get(l.vatRateId)}</td>
                  <td className="table-td text-right"><Money cents={l.netCents} /></td>
                  <td className="table-td text-right"><Money cents={l.vatCents} /></td>
                </tr>
              ))}
            </Table>
            <div className="flex justify-end px-4 py-3">
              <div className="w-64 space-y-1 text-[13px]">
                <div className="flex justify-between text-ink-500"><span>Subtotal</span><Money cents={bill.subtotalCents} /></div>
                <div className="flex justify-between text-ink-500"><span>VAT reclaimable</span><Money cents={bill.vatCents} /></div>
                <div className="flex justify-between border-t border-ink-100 pt-1 font-semibold"><span>Total</span><Money cents={bill.totalCents} /></div>
                {bill.paidCents > 0 && (
                  <>
                    <div className="flex justify-between text-positive-600"><span>Paid</span><span className="tnum">-{fmtEUR(bill.paidCents)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Still owing</span><Money cents={remaining} /></div>
                  </>
                )}
              </div>
            </div>
          </Card>
          {isOpen && ctx.can("post") && (
            <PaymentForm direction="SPEND" billId={bill.id} contactId={row.contactId} banks={banks.map((b) => ({ id: b.id, name: b.name }))} remaining={(remaining / 100).toFixed(2)} />
          )}
        </div>

        <div className="space-y-5">
          <Card title="Payments">
            <div className="px-4 pb-4">
              {allocations.length === 0 ? (
                <p className="text-xs text-ink-400">Not paid yet.</p>
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
          {documents.length > 0 && (
            <Card title="Source documents">
              <ul className="space-y-1.5 px-4 pb-4 text-[13px]">
                {documents.map((doc) => (
                  <li key={doc.id} className="text-ink-600">
                    📄 {doc.filename}
                    {doc.extractionStatus === "EXTRACTED" && <span className="ml-1.5 text-2xs text-ai-600">fields extracted</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Accounting">
            <div className="space-y-2 px-4 pb-4 text-[13px]">
              {bill.journalId ? (
                <>
                  <p className="text-ink-600">Posted: expenses and input VAT debited, creditors credited {fmtEUR(bill.totalCents)}.</p>
                  <Link href={`/ledger/journals/${bill.journalId}`} className="font-medium text-brand-700 hover:underline">View journal →</Link>
                </>
              ) : (
                <p className="text-ink-500">Drafts have no ledger effect — approving posts the journal.</p>
              )}
              {bill.voidJournalId && <Link href={`/ledger/journals/${bill.voidJournalId}`} className="block font-medium text-brand-700 hover:underline">View reversal →</Link>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
