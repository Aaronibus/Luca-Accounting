import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ShieldCheck, AlertTriangle, Lock, Percent } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { vatPeriodsForYear, computeVatReturn, VatException } from "@/lib/engine/vat";
import { accountBalance, systemAccount } from "@/lib/engine/journal";
import { fmtEUR } from "@/lib/money";
import { Card, Money, PageHeader, statusBadge, fmtDate, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { prepareVatAction, finaliseVatAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function VatPage({ searchParams }: { searchParams: { period?: string } }) {
  const ctx = await requireCompany();
  const { companyId, company } = ctx;
  const year = 2026;
  const periods = vatPeriodsForYear(year, company.vatPeriodMonths);

  const returns = db.select().from(tables.vatReturns).where(eq(tables.vatReturns.companyId, companyId)).all();
  const returnByStart = new Map(returns.map((r) => [new Date(r.periodStart).toISOString().slice(0, 10), r]));

  // pick the selected period: query param or the latest with a return or last completed
  const now = new Date();
  const selectedKey =
    searchParams.period ??
    periods.filter((p) => p.start < now).map((p) => p.start.toISOString().slice(0, 10)).filter((k) => returnByStart.has(k)).pop() ??
    periods[0].start.toISOString().slice(0, 10);
  const selected = periods.find((p) => p.start.toISOString().slice(0, 10) === selectedKey) ?? periods[0];
  const selectedReturn = returnByStart.get(selected.start.toISOString().slice(0, 10));

  // live computation for the selected period (unless finalised — then show stored)
  const live = selectedReturn?.status === "FINALISED"
    ? null
    : computeVatReturn(companyId, selected.start, selected.end);
  const t1 = selectedReturn?.status === "FINALISED" ? selectedReturn.t1Cents : live!.t1Cents;
  const t2 = selectedReturn?.status === "FINALISED" ? selectedReturn.t2Cents : live!.t2Cents;
  const t3 = selectedReturn?.status === "FINALISED" ? selectedReturn.t3Cents : live!.t3Cents;
  const t4 = selectedReturn?.status === "FINALISED" ? selectedReturn.t4Cents : live!.t4Cents;
  const exceptions: VatException[] = selectedReturn?.status === "FINALISED"
    ? JSON.parse(selectedReturn.exceptions ?? "[]")
    : live!.exceptions;

  const vatControlBalance = -accountBalance(companyId, systemAccount(companyId, "VAT_CONTROL").id);
  const vatPayableBalance = -accountBalance(companyId, systemAccount(companyId, "VAT_PAYABLE").id);

  const noVatActivity =
    returns.length === 0 && vatControlBalance === 0 && vatPayableBalance === 0 && t1 === 0 && t2 === 0;

  if (noVatActivity) {
    return (
      <div>
        <PageHeader
          title="VAT"
          subtitle={`${company.vatNumber ?? "No VAT number set"} · ${company.vatBasis === "INVOICE" ? "invoice basis" : "cash receipts basis"} · ${company.vatPeriodMonths === 2 ? "bi-monthly" : `${company.vatPeriodMonths}-monthly`} periods`}
        />
        <Card>
          <EmptyState
            icon={<Percent size={26} />}
            title="No VAT activity yet"
            body="Once you approve invoices, bills or expenses carrying VAT, the VAT3 boxes are calculated here from the VAT control account — with exception checks before you file."
            action={<Link href="/sales/invoices/new" className="btn-primary">Create your first invoice</Link>}
          />
        </Card>
        <Card title="Irish VAT rates configured for this company" className="mt-5">
          <p className="px-4 py-3 text-[13px] text-ink-600">
            23% standard · 13.5% reduced · 9% second reduced · 4.8% livestock · 0% zero · exempt. Rates are
            date-effective, so historic postings keep their original treatment when legislation changes.
          </p>
        </Card>
      </div>
    );
  }

  const boxes = [
    { code: "T1", label: "VAT on sales", value: t1 },
    { code: "T2", label: "VAT on purchases", value: t2 },
    { code: "T3", label: "VAT payable", value: t3, strong: true },
    { code: "T4", label: "VAT repayable", value: t4 },
  ];

  return (
    <div>
      <PageHeader
        title="VAT"
        subtitle={`${company.vatNumber ?? "No VAT number"} · invoice basis · ${company.vatPeriodMonths === 2 ? "bi-monthly" : `${company.vatPeriodMonths}-monthly`} periods · VAT3 due the 23rd via ROS`}
      />

      <div className="mb-5 grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-2xs uppercase tracking-wide text-ink-400">VAT control (open periods)</div>
          <Money cents={vatControlBalance} className="text-xl font-semibold" />
          <p className="mt-1 text-xs text-ink-500">VAT charged less VAT reclaimed since the last finalised return.</p>
        </Card>
        <Card className="p-4">
          <div className="text-2xs uppercase tracking-wide text-ink-400">Owed to Revenue (finalised)</div>
          <Money cents={vatPayableBalance} className="text-xl font-semibold" />
          <p className="mt-1 text-xs text-ink-500">Finalised returns not yet paid show here until the bank payment is matched.</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Periods */}
        <Card title={`${year} taxable periods`}>
          <ul className="px-2 pb-3">
            {periods.map((p) => {
              const key = p.start.toISOString().slice(0, 10);
              const ret = returnByStart.get(key);
              const isSelected = key === selectedKey;
              const isFuture = p.start > now;
              return (
                <li key={key}>
                  <Link
                    href={`/vat?period=${key}`}
                    className={`mb-0.5 flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px] ${isSelected ? "bg-brand-50 font-semibold text-brand-800" : "text-ink-600 hover:bg-ink-50"} ${isFuture ? "opacity-50" : ""}`}
                  >
                    <span>{p.label}</span>
                    {ret ? statusBadge(ret.status) : <span className="text-2xs text-ink-400">{isFuture ? "upcoming" : "not prepared"}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Selected return */}
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={`VAT3 — ${selected.label}`}
            action={
              <div className="flex items-center gap-2">
                {selectedReturn?.status === "FINALISED" ? (
                  <span className="flex items-center gap-1 text-xs text-positive-700"><Lock size={12} /> finalised {selectedReturn.finalisedAt ? fmtDate(selectedReturn.finalisedAt) : ""} · period locked</span>
                ) : ctx.can("vat") ? (
                  <>
                    <ActionButton action={prepareVatAction.bind(null, selected.start.toISOString(), selected.end.toISOString())} variant="secondary" className="!py-1 text-xs">
                      {selectedReturn ? "Recalculate" : "Prepare draft"}
                    </ActionButton>
                    {selectedReturn && (
                      <ActionButton
                        action={finaliseVatAction.bind(null, selectedReturn.id)}
                        variant="primary"
                        className="!py-1 text-xs"
                        confirm={`Finalise the ${selected.label} return? The net VAT moves to “VAT payable to Revenue” and the period locks — no back-posting into a filed return.`}
                      >
                        Finalise
                      </ActionButton>
                    )}
                  </>
                ) : null}
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-card bg-ink-100 sm:grid-cols-4">
              {boxes.map((b) => (
                <div key={b.code} className={`bg-white px-4 py-3 ${b.strong && b.value > 0 ? "bg-brand-25" : ""}`}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="rounded bg-ink-100 px-1 py-0.5 text-2xs font-bold text-ink-500">{b.code}</span>
                    <span className="text-2xs text-ink-400">{b.label}</span>
                  </div>
                  <div className="mt-1 tnum text-lg font-semibold text-ink-900">{fmtEUR(b.value)}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 text-xs text-ink-500">
              Due {fmtDate(selected.due)} via ROS. Every figure comes from the VAT control account — drill into the detail below.
            </div>
          </Card>

          {/* Exceptions */}
          <Card title="Exception checks">
            <div className="px-4 pb-4">
              {exceptions.length === 0 ? (
                <p className="flex items-center gap-2 py-2 text-[13px] text-positive-700"><ShieldCheck size={15} /> No exceptions — the return looks clean.</p>
              ) : (
                <ul className="space-y-2">
                  {exceptions.map((ex, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-ink-700">
                      <AlertTriangle size={14} className={`mt-0.5 shrink-0 ${ex.severity === "REVIEW" ? "text-negative-500" : "text-warn-500"}`} />
                      <span>
                        {ex.message}
                        {ex.entityType === "invoice" && ex.entityId && <Link href={`/sales/invoices/${ex.entityId}`} className="ml-1 text-brand-700 hover:underline">Open →</Link>}
                        {ex.entityType === "bill" && ex.entityId && <Link href={`/purchases/bills/${ex.entityId}`} className="ml-1 text-brand-700 hover:underline">Open →</Link>}
                        {ex.entityType === "journal" && ex.entityId && <Link href={`/ledger/journals/${ex.entityId}`} className="ml-1 text-brand-700 hover:underline">Open →</Link>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* Detail drill-down */}
          {live && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title={`Sales VAT detail (${live.salesDetail.length})`}>
                <ul className="max-h-64 divide-y divide-ink-100/70 overflow-y-auto px-4 pb-3">
                  {live.salesDetail.map((dd, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <Link href={`/ledger/journals/${dd.journalId}`} className="truncate text-ink-600 hover:text-brand-700">{dd.description}</Link>
                      <Money cents={dd.vatCents} className="text-xs" />
                    </li>
                  ))}
                  {live.salesDetail.length === 0 && <li className="py-2 text-xs text-ink-400">No sales VAT this period.</li>}
                </ul>
              </Card>
              <Card title={`Purchase VAT detail (${live.purchaseDetail.length})`}>
                <ul className="max-h-64 divide-y divide-ink-100/70 overflow-y-auto px-4 pb-3">
                  {live.purchaseDetail.map((dd, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <Link href={`/ledger/journals/${dd.journalId}`} className="truncate text-ink-600 hover:text-brand-700">{dd.description}</Link>
                      <Money cents={dd.vatCents} className="text-xs" />
                    </li>
                  ))}
                  {live.purchaseDetail.length === 0 && <li className="py-2 text-xs text-ink-400">No purchase VAT this period.</li>}
                </ul>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
