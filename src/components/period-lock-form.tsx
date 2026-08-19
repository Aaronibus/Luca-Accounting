"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { setPeriodLockAction, ActionResult } from "@/app/actions";

export function PeriodLockForm() {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await setPeriodLockAction(date, reason);
          setResult(r);
          if (r.ok) { setDate(""); setReason(""); router.refresh(); }
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Lock through</span>
        <input type="date" className="input w-40" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Reason</span>
        <input className="input w-56" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Year-end close" />
      </label>
      <button className="btn-primary" disabled={pending}>
        {pending ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Lock period
      </button>
      {result && !result.ok && <p className="w-full text-2xs text-negative-600">{result.error}</p>}
    </form>
  );
}
