"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createJournalAction, ActionResult } from "@/app/actions";
import { fmtEUR, parseEUR } from "@/lib/money";

interface Line { accountId: string; debit: string; credit: string; description: string }

export function JournalForm({ accounts }: { accounts: Array<{ id: string; label: string }> }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { accountId: "", debit: "", credit: "", description: "" },
    { accountId: "", debit: "", credit: "", description: "" },
  ]);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) {
      try { if (l.debit.trim()) d += parseEUR(l.debit); } catch {}
      try { if (l.credit.trim()) c += parseEUR(l.credit); } catch {}
    }
    return { d, c, balanced: d === c && d > 0 };
  }, [lines]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="card p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Date</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-ink-600">Narrative</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this journal for?" />
        </label>
      </div>

      <div className="mt-5">
        <div className="mb-1 grid grid-cols-[1fr_1fr_110px_110px_28px] gap-2 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">
          <span>Account</span><span>Line description</span><span className="text-right">Debit €</span><span className="text-right">Credit €</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[1fr_1fr_110px_110px_28px] items-center gap-2">
            <select className="input !py-1.5 text-xs" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <input className="input !py-1.5" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
            <input className="input !py-1.5 tnum text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: "" })} placeholder="0.00" />
            <input className="input !py-1.5 tnum text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: "" })} placeholder="0.00" />
            <button type="button" className="text-ink-300 hover:text-negative-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "", description: "" }])}>
          <Plus size={13} /> Add line
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-4">
        <div className={`text-[13px] ${totals.balanced ? "text-positive-600" : "text-warn-600"}`}>
          Debits {fmtEUR(totals.d)} · Credits {fmtEUR(totals.c)} {totals.balanced ? "· balanced ✓" : totals.d + totals.c > 0 ? "· must balance before posting" : ""}
        </div>
        <button
          className="btn-primary"
          disabled={pending || !totals.balanced || !description.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await createJournalAction({ date, description, lines });
              setResult(r);
              if (r.ok) { router.push("/ledger/journals"); router.refresh(); }
            })
          }
        >
          {pending && <Loader2 size={13} className="animate-spin" />} Post journal
        </button>
      </div>
      {result && !result.ok && <p className="mt-2 text-right text-xs text-negative-600">{result.error}</p>}
    </div>
  );
}
