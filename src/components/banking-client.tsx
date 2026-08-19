"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, ChevronDown, ChevronUp } from "lucide-react";
import { categoriseTransactionAction, importBankCsvAction } from "@/app/actions";
import type { ActionResult } from "@/app/actions";
import { fmtEUR, vatFromGross } from "@/lib/money";

export interface AccountOption {
  id: string;
  label: string;
  defaultVatRateId: string | null;
}
export interface VatRateOption {
  id: string;
  label: string;
  rateBps: number;
  category: string;
}
export interface ContactOption {
  id: string;
  name: string;
}

/** Inline "explain this transaction" form. */
export function CategoriseForm({
  txnId,
  grossCents,
  accounts,
  vatRates,
  contacts,
}: {
  txnId: string;
  grossCents: number;
  accounts: AccountOption[];
  vatRates: VatRateOption[];
  contacts: ContactOption[];
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [vatRateId, setVatRateId] = useState("");
  const [contactId, setContactId] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const vatCents = useMemo(() => {
    const rate = vatRates.find((r) => r.id === vatRateId);
    if (!rate || rate.rateBps === 0 || rate.category === "EXEMPT") return 0;
    return vatFromGross(grossCents, rate.rateBps).vatCents;
  }, [vatRateId, grossCents, vatRates]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost !px-2 !py-1 text-xs">
        Explain manually <ChevronDown size={12} />
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-0.5 block text-2xs font-medium text-ink-500">Account</span>
          <select className="input !py-1.5 text-xs" value={accountId} onChange={(e) => {
            setAccountId(e.target.value);
            const acc = accounts.find((a) => a.id === e.target.value);
            if (acc?.defaultVatRateId) setVatRateId(acc.defaultVatRateId);
          }}>
            <option value="">Choose…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-2xs font-medium text-ink-500">VAT treatment</span>
          <select className="input !py-1.5 text-xs" value={vatRateId} onChange={(e) => setVatRateId(e.target.value)}>
            <option value="">No VAT</option>
            {vatRates.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-2xs font-medium text-ink-500">Contact (optional)</span>
          <select className="input !py-1.5 text-xs" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">—</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-2xs text-ink-500">
          {vatCents > 0 ? `VAT portion: ${fmtEUR(vatCents)} (reclaimed via VAT control)` : "No VAT will be claimed"}
        </span>
        <div className="flex gap-2">
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setOpen(false)}>
            Cancel <ChevronUp size={12} />
          </button>
          <button
            className="btn-primary !px-3 !py-1 text-xs"
            disabled={!accountId || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await categoriseTransactionAction({
                  bankTransactionId: txnId,
                  accountId,
                  vatRateId: vatRateId || undefined,
                  vat: vatCents ? (vatCents / 100).toFixed(2) : undefined,
                  contactId: contactId || undefined,
                });
                setResult(r);
                if (r.ok) router.refresh();
              })
            }
          >
            {pending && <Loader2 size={11} className="animate-spin" />} Post
          </button>
        </div>
      </div>
      {result && !result.ok && <p className="mt-1 text-2xs text-negative-600">{result.error}</p>}
    </div>
  );
}

export function CsvImportForm({ bankAccountId }: { bankAccountId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("bankAccountId", bankAccountId);
        startTransition(async () => {
          const r = await importBankCsvAction(fd);
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
      className="flex items-center gap-2"
    >
      <label className="btn-secondary cursor-pointer !py-1.5 text-xs">
        <Upload size={13} />
        <span>Import CSV</span>
        <input type="file" name="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.form?.requestSubmit()} />
      </label>
      {pending && <Loader2 size={13} className="animate-spin text-ink-400" />}
      {result && (
        <span className={`text-2xs ${result.ok ? "text-positive-600" : "text-negative-600"}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </form>
  );
}
