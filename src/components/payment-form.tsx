"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { recordPaymentAction, ActionResult } from "@/app/actions";

export function PaymentForm({
  direction,
  invoiceId,
  billId,
  contactId,
  banks,
  remaining,
}: {
  direction: "RECEIVE" | "SPEND";
  invoiceId?: string;
  billId?: string;
  contactId?: string;
  banks: Array<{ id: string; name: string }>;
  remaining: string; // "123.45"
}) {
  const [open, setOpen] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(remaining);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        {direction === "RECEIVE" ? "Record payment received" : "Record payment made"}
      </button>
    );
  }

  return (
    <div className="card w-full max-w-md p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-1">
          <span className="mb-1 block text-xs font-medium text-ink-600">Amount €</span>
          <input className="input tnum" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Date</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Bank account</span>
          <select className="input" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await recordPaymentAction({ direction, invoiceId, billId, contactId, bankAccountId, date, amount });
              setResult(r);
              if (r.ok) { setOpen(false); router.refresh(); }
            })
          }
        >
          {pending && <Loader2 size={13} className="animate-spin" />} Post payment
        </button>
      </div>
      {result && !result.ok && <p className="mt-1 text-right text-2xs text-negative-600">{result.error}</p>}
    </div>
  );
}
