"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { createExpenseAction, ActionResult } from "@/app/actions";
import { fmtEUR, parseEUR, vatFromGross } from "@/lib/money";

interface Option { id: string; label: string }
interface VatOption extends Option { rateBps: number; category: string }

export function ExpenseForm({ accounts, vatRates, banks }: { accounts: Option[]; vatRates: VatOption[]; banks: Option[] }) {
  const [open, setOpen] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [vatRateId, setVatRateId] = useState(vatRates[0]?.id ?? "");
  const [gross, setGross] = useState("");
  const [paidVia, setPaidVia] = useState<"BANK" | "PERSONAL">("PERSONAL");
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const vatPreview = useMemo(() => {
    try {
      const rate = vatRates.find((r) => r.id === vatRateId);
      if (!rate || !gross.trim() || rate.rateBps === 0 || rate.category === "EXEMPT") return 0;
      return vatFromGross(parseEUR(gross), rate.rateBps).vatCents;
    } catch { return 0; }
  }, [gross, vatRateId, vatRates]);

  if (!open) {
    return <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={15} /> New expense</button>;
  }

  return (
    <form
      className="card w-full space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await createExpenseAction({
            merchant, description: description || undefined, date, accountId, vatRateId, gross,
            paidVia, bankAccountId: paidVia === "BANK" ? bankAccountId : undefined,
          });
          setResult(r);
          if (r.ok) { setOpen(false); setMerchant(""); setGross(""); router.refresh(); }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Merchant</span>
          <input className="input" value={merchant} onChange={(e) => setMerchant(e.target.value)} required placeholder="Easons" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Date</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Gross amount €</span>
          <input className="input tnum" value={gross} onChange={(e) => setGross(e.target.value)} required placeholder="45.99" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Category</span>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">VAT treatment</span>
          <select className="input" value={vatRateId} onChange={(e) => setVatRateId(e.target.value)}>
            {vatRates.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Paid from</span>
          <select className="input" value={paidVia} onChange={(e) => setPaidVia(e.target.value as never)}>
            <option value="PERSONAL">Personal money (owed back)</option>
            <option value="BANK">Business bank account</option>
          </select>
        </label>
        {paidVia === "BANK" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Bank account</span>
            <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-600">Note (optional)</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-2xs text-ink-500">{vatPreview > 0 ? `VAT portion ${fmtEUR(vatPreview)} will be reclaimable` : "No VAT will be claimed"}</span>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" disabled={pending}>{pending && <Loader2 size={13} className="animate-spin" />} Save draft</button>
        </div>
      </div>
      {result && !result.ok && <p className="text-2xs text-negative-600">{result.error}</p>}
    </form>
  );
}
