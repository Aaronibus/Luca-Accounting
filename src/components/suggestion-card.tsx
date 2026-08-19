"use client";

import Link from "next/link";
import { Sparkles, Check, X } from "lucide-react";
import { Badge } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { acceptSuggestionAction, rejectSuggestionAction } from "@/app/actions";

export interface SuggestionView {
  id: string;
  kind: string;
  explanation: string;
  confidence: number;
  source: string;
  evidence: Array<{ label: string; href: string }>;
  txn?: { date: string; description: string; amountFormatted: string; negative: boolean } | null;
  proposal?: string | null;
}

const sourceLabel: Record<string, string> = {
  RULE: "Your rule",
  MEMORY: "Learned from history",
  HEURISTIC: "Pattern intelligence",
  LLM: "AI model",
};

export function SuggestionCard({ s, canPost }: { s: SuggestionView; canPost: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ai-50 text-ai-600">
          <Sparkles size={14} />
        </div>
        <div className="min-w-0 flex-1">
          {s.txn && (
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-medium text-ink-900">{s.txn.description}</span>
              <span className={`tnum text-sm font-semibold ${s.txn.negative ? "text-negative-600" : "text-positive-600"}`}>{s.txn.amountFormatted}</span>
              <span className="text-xs text-ink-400">{s.txn.date}</span>
            </div>
          )}
          {s.proposal && (
            <div className="mb-1 text-[13px] font-medium text-ink-800">
              → {s.proposal}
            </div>
          )}
          <p className="text-[13px] leading-relaxed text-ink-600">{s.explanation}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="ai">{s.confidence}% confident</Badge>
            <Badge tone="grey">{sourceLabel[s.source] ?? s.source}</Badge>
            {s.evidence.map((e, i) => (
              <Link key={i} href={e.href} className="rounded-full border border-ink-200 px-2 py-0.5 text-2xs text-ink-500 hover:border-brand-300 hover:text-brand-700">
                {e.label} →
              </Link>
            ))}
          </div>
        </div>
        {canPost && (
          <div className="flex shrink-0 gap-1.5">
            <ActionButton action={acceptSuggestionAction.bind(null, s.id)} variant="primary" className="!px-2.5">
              <Check size={14} /> Approve
            </ActionButton>
            <ActionButton action={rejectSuggestionAction.bind(null, s.id)} variant="ghost" className="!px-2">
              <X size={14} />
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
