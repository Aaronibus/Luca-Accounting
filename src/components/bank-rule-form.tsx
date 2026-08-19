"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createBankRuleAction, ActionResult } from "@/app/actions";

export function BankRuleForm({ accounts, vatRates }: { accounts: Array<{ id: string; label: string }>; vatRates: Array<{ id: string; label: string }> }) {
  const [name, setName] = useState("");
  const [matchText, setMatchText] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT" | "ANY">("ANY");
  const [accountId, setAccountId] = useState("");
  const [vatRateId, setVatRateId] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await createBankRuleAction({ name, matchText, direction, setAccountId: accountId, setVatRateId: vatRateId || undefined });
          setResult(r);
          if (r.ok) {
            setName(""); setMatchText(""); setAccountId(""); setVatRateId("");
            router.refresh();
          }
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Rule name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="SumUp payouts → Sales" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Narrative contains</span>
        <input className="input" value={matchText} onChange={(e) => setMatchText(e.target.value)} placeholder="SUMUP PAYOUT" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Direction</span>
        <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as never)}>
          <option value="ANY">Either direction</option>
          <option value="IN">Money in</option>
          <option value="OUT">Money out</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Categorise to</span>
        <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
          <option value="">Choose account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">VAT treatment</span>
        <select className="input" value={vatRateId} onChange={(e) => setVatRateId(e.target.value)}>
          <option value="">No VAT</option>
          {vatRates.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <button className="btn-primary w-full" disabled={pending}>
        {pending && <Loader2 size={13} className="animate-spin" />} Create rule
      </button>
      {result && !result.ok && <p className="text-2xs text-negative-600">{result.error}</p>}
      {result && result.ok && <p className="text-2xs text-positive-600">{result.message}</p>}
    </form>
  );
}
