"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBankAccountAction } from "@/app/company-actions";
import type { ActionResult } from "@/app/actions";

export function BankAccountForm() {
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [iban, setIban] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await createBankAccountAction({
            name,
            bank: bank || undefined,
            ibanMasked: iban || undefined,
            openingBalance: openingBalance || undefined,
            openingBalanceDate: openingBalance ? openingDate : undefined,
          });
          setResult(r);
          if (r.ok) {
            router.push("/banking");
            router.refresh();
          }
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Account name *</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Business Current Account" required autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Bank</span>
          <input className="input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="AIB, Bank of Ireland, Revolut…" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">IBAN (last digits only)</span>
          <input className="input" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IE29 AIBK •••• 1234" />
          <span className="mt-1 block text-2xs text-ink-400">Shown for identification — never store full account credentials here.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Opening balance €</span>
            <input className="input tnum" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0.00" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">As at</span>
            <input type="date" className="input" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </label>
        </div>
      </div>

      <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
        The opening balance is the statement balance the day before your first imported transaction. It's used for the
        reconciliation comparison — post the matching ledger entry through <strong>opening balances</strong> so your
        books and the bank agree.
      </p>

      {result && !result.ok && <p className="text-xs text-negative-600">{result.error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancel</button>
        <button className="btn-primary" disabled={pending || !name.trim()}>
          {pending && <Loader2 size={14} className="animate-spin" />} Add bank account
        </button>
      </div>
    </form>
  );
}
