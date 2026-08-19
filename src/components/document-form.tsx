"use client";

// Shared invoice/bill editor — line items with live VAT maths.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createInvoiceAction, createBillAction, ActionResult } from "@/app/actions";
import { fmtEUR, parseEUR, vatOnNet } from "@/lib/money";

interface Option { id: string; label: string }
interface VatOption extends Option { rateBps: number; category: string }
interface Line { description: string; quantity: string; unitPrice: string; accountId: string; vatRateId: string }

export function DocumentForm({
  mode,
  contacts,
  accounts,
  vatRates,
  defaultAccountId,
  defaultVatRateId,
}: {
  mode: "INVOICE" | "CREDIT_NOTE" | "BILL";
  contacts: Option[];
  accounts: Option[];
  vatRates: VatOption[];
  defaultAccountId: string;
  defaultVatRateId: string;
}) {
  const empty: Line = { description: "", quantity: "1", unitPrice: "", accountId: defaultAccountId, vatRateId: defaultVatRateId };
  const [contactId, setContactId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...empty }]);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const totals = useMemo(() => {
    let net = 0, vat = 0;
    for (const l of lines) {
      try {
        if (!l.unitPrice.trim()) continue;
        const lineNet = Math.round(parseFloat(l.quantity || "1") * parseEUR(l.unitPrice));
        const rate = vatRates.find((r) => r.id === l.vatRateId);
        net += lineNet;
        vat += rate && rate.category !== "EXEMPT" ? vatOnNet(lineNet, rate.rateBps) : 0;
      } catch { /* ignore while typing */ }
    }
    return { net, vat, gross: net + vat };
  }, [lines, vatRates]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function submit(approve: boolean) {
    startTransition(async () => {
      const base = { contactId, date, lines, approve };
      const r = mode === "BILL"
        ? await createBillAction({ ...base, supplierRef: reference || undefined })
        : await createInvoiceAction({ ...base, kind: mode, reference: reference || undefined });
      setResult(r);
      if (r.ok && r.id) {
        router.push(mode === "BILL" ? `/purchases/bills/${r.id}` : `/sales/invoices/${r.id}`);
        router.refresh();
      }
    });
  }

  const contactLabel = mode === "BILL" ? "Supplier" : "Customer";

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">{contactLabel}</span>
          <select className="input" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Choose…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Date</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">{mode === "BILL" ? "Supplier reference" : "Reference"}</span>
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </label>
      </div>

      <div className="mt-5">
        <div className="mb-1 grid grid-cols-[1fr_70px_100px_180px_150px_90px_28px] gap-2 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">
          <span>Description</span><span>Qty</span><span>Unit €</span><span>Account</span><span>VAT</span><span className="text-right">Amount</span><span />
        </div>
        {lines.map((l, i) => {
          let lineNet = 0;
          try { lineNet = l.unitPrice.trim() ? Math.round(parseFloat(l.quantity || "1") * parseEUR(l.unitPrice)) : 0; } catch {}
          return (
            <div key={i} className="mb-1.5 grid grid-cols-[1fr_70px_100px_180px_150px_90px_28px] items-center gap-2">
              <input className="input !py-1.5" value={l.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="What was sold / bought" />
              <input className="input !py-1.5 tnum" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
              <input className="input !py-1.5 tnum" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} placeholder="0.00" />
              <select className="input !py-1.5 text-xs" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select className="input !py-1.5 text-xs" value={l.vatRateId} onChange={(e) => set(i, { vatRateId: e.target.value })}>
                {vatRates.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <span className="tnum text-right text-[13px] text-ink-700">{lineNet ? fmtEUR(lineNet) : "—"}</span>
              <button type="button" className="text-ink-300 hover:text-negative-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setLines((ls) => [...ls, { ...empty }])}>
          <Plus size={13} /> Add line
        </button>
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-ink-100 pt-4">
        <div className="space-y-1 text-right text-[13px]">
          <div className="flex w-60 justify-between text-ink-500"><span>Subtotal</span><span className="tnum">{fmtEUR(totals.net)}</span></div>
          <div className="flex w-60 justify-between text-ink-500"><span>VAT</span><span className="tnum">{fmtEUR(totals.vat)}</span></div>
          <div className="flex w-60 justify-between font-semibold text-ink-900"><span>Total</span><span className="tnum">{fmtEUR(totals.gross)}</span></div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" disabled={pending || !contactId} onClick={() => submit(false)}>
            Save draft
          </button>
          <button className="btn-primary" disabled={pending || !contactId} onClick={() => submit(true)}>
            {pending && <Loader2 size={13} className="animate-spin" />} Approve & post
          </button>
        </div>
      </div>
      {result && !result.ok && <p className="mt-2 text-right text-xs text-negative-600">{result.error}</p>}
    </div>
  );
}
