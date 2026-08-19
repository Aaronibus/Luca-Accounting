"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { postOpeningBalancesAction } from "@/app/company-actions";
import type { ActionResult } from "@/app/actions";
import { fmtEUR, parseEUR } from "@/lib/money";

interface Line { accountId: string; debit: string; credit: string }

export function OpeningBalancesForm({
  accounts,
  suggested,
}: {
  accounts: Array<{ id: string; label: string; normalSide: "DEBIT" | "CREDIT" }>;
  suggested: string[];
}) {
  const [date, setDate] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [balanceToRetained, setBalanceToRetained] = useState(true);
  const [lines, setLines] = useState<Line[]>(
    suggested.length
      ? suggested.map((accountId) => ({ accountId, debit: "", credit: "" }))
      : [
          { accountId: "", debit: "", credit: "" },
          { accountId: "", debit: "", credit: "" },
        ]
  );
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const totals = useMemo(() => {
    let d = 0, c = 0;
    for (const l of lines) {
      try { if (l.debit.trim()) d += parseEUR(l.debit); } catch {}
      try { if (l.credit.trim()) c += parseEUR(l.credit); } catch {}
    }
    return { d, c, diff: d - c };
  }, [lines]);

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-600">Opening balances as at</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="mt-1 block text-2xs text-ink-400">Usually the day before your first transaction in Lúca.</span>
        </label>
      </div>

      <div className="mt-5">
        <div className="mb-1 grid grid-cols-[1fr_130px_130px_28px] gap-2 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">
          <span>Account</span><span className="text-right">Debit €</span><span className="text-right">Credit €</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[1fr_130px_130px_28px] items-center gap-2">
            <select className="input !py-1.5 text-xs" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
              <option value="">Choose account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <input className="input !py-1.5 tnum text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: "" })} placeholder="0.00" />
            <input className="input !py-1.5 tnum text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: "" })} placeholder="0.00" />
            <button type="button" className="text-ink-300 hover:text-negative-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length <= 2}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "" }])}>
          <Plus size={13} /> Add line
        </button>
      </div>

      <label className="mt-4 flex items-start gap-2.5 border-t border-ink-100 pt-4">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-700 focus:ring-brand-500/30"
          checked={balanceToRetained}
          onChange={(e) => setBalanceToRetained(e.target.checked)}
        />
        <span className="text-[13px] text-ink-700">
          Post any difference to retained earnings
          <span className="block text-2xs text-ink-400">
            Standard when entering a partial opening trial balance. Untick to require your figures to balance exactly.
          </span>
        </span>
      </label>

      <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-4">
        <div className="text-[13px] text-ink-600">
          Debits {fmtEUR(totals.d)} · Credits {fmtEUR(totals.c)}
          {totals.diff !== 0 && (
            <span className={balanceToRetained ? "text-ink-500" : "text-warn-600"}>
              {" "}· difference {fmtEUR(Math.abs(totals.diff))}
              {balanceToRetained ? " → retained earnings" : " must be zero"}
            </span>
          )}
          {totals.diff === 0 && totals.d > 0 && <span className="text-positive-600"> · balanced ✓</span>}
        </div>
        <button
          className="btn-primary"
          disabled={pending || (totals.d === 0 && totals.c === 0)}
          onClick={() =>
            startTransition(async () => {
              const r = await postOpeningBalancesAction({ date, lines, balanceToRetainedEarnings: balanceToRetained });
              setResult(r);
              if (r.ok) {
                router.push("/reports/trial-balance");
                router.refresh();
              }
            })
          }
        >
          {pending && <Loader2 size={13} className="animate-spin" />} Post opening balances
        </button>
      </div>
      {result && !result.ok && <p className="mt-2 text-right text-xs text-negative-600">{result.error}</p>}
    </div>
  );
}
