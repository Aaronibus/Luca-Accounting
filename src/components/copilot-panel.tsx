"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, X, CornerDownLeft, Loader2 } from "lucide-react";

interface CopilotResponse {
  answer: string;
  details: string[];
  evidence: Array<{ label: string; href: string }>;
  actionsTaken?: string[];
}

interface Turn {
  question: string;
  response?: CopilotResponse;
  error?: string;
}

const CONTEXT_PROMPTS: Array<{ match: (p: string) => boolean; prompts: string[] }> = [
  { match: (p) => p.startsWith("/banking"), prompts: ["What's preventing reconciliation?", "Categorise this week's transactions", "Reconcile everything you can"] },
  { match: (p) => p.startsWith("/vat"), prompts: ["Why has my VAT changed?", "Prepare the VAT return for my review"] },
  { match: (p) => p.startsWith("/reports"), prompts: ["Why is my profit down this month?", "Which expenses increased the most?"] },
  { match: (p) => p.startsWith("/sales"), prompts: ["Who owes me money?", "Find anything that looks wrong"] },
  { match: () => true, prompts: ["What needs my attention?", "Find anything that looks wrong", "Reconcile everything you can"] },
];

export function CopilotPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const pathname = usePathname();
  const router = useRouter();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  const prompts = CONTEXT_PROMPTS.find((c) => c.match(pathname))?.prompts ?? [];

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setInput("");
    setTurns((t) => [...t, { question }]);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, page: pathname }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Something went wrong");
      const data = (await res.json()) as CopilotResponse;
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, response: data } : turn)));
      if (data.actionsTaken && data.actionsTaken.length > 0) router.refresh();
    } catch (e) {
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: e instanceof Error ? e.message : "Failed" } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ai-600 px-4 py-2.5 text-sm font-medium text-white shadow-overlay transition-transform hover:scale-105 hover:bg-ai-700"
        >
          <Sparkles size={16} />
          Ask Lúca
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[560px] w-[400px] flex-col overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-overlay animate-slide-up">
          <header className="flex items-center justify-between border-b border-ink-100 bg-ai-50/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-ai-600 text-white">
                <Sparkles size={13} />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink-900">Lúca Copilot</div>
                <div className="text-2xs text-ink-500">Answers come from your actual books — never invented</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-ink-400 hover:bg-white hover:text-ink-700">
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-ink-500">Try asking about this page:</p>
                {prompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => ask(p)}
                    className="block w-full rounded-lg border border-ink-100 bg-ink-50/50 px-3 py-2 text-left text-[13px] text-ink-700 hover:border-ai-200 hover:bg-ai-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className="space-y-2">
                <div className="ml-8 rounded-xl rounded-br-sm bg-brand-700 px-3 py-2 text-[13px] text-white">{turn.question}</div>
                {turn.response ? (
                  <div className="mr-4 rounded-xl rounded-bl-sm border border-ink-100 bg-ink-50/50 px-3 py-2.5 text-[13px] text-ink-800">
                    <p className="whitespace-pre-wrap">{turn.response.answer}</p>
                    {turn.response.details.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-ink-100 pt-2 text-xs text-ink-600">
                        {turn.response.details.map((d, j) => (
                          <li key={j} className="whitespace-pre-wrap">{d}</li>
                        ))}
                      </ul>
                    )}
                    {turn.response.actionsTaken && turn.response.actionsTaken.length > 0 && (
                      <div className="mt-2 rounded-md bg-positive-50 px-2 py-1.5 text-xs text-positive-700">
                        {turn.response.actionsTaken.length} action{turn.response.actionsTaken.length === 1 ? "" : "s"} applied — all reviewable in the audit trail.
                      </div>
                    )}
                    {turn.response.evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {turn.response.evidence.slice(0, 6).map((e, j) => (
                          <Link
                            key={j}
                            href={e.href}
                            onClick={() => setOpen(false)}
                            className="rounded-full border border-ai-200 bg-ai-50 px-2 py-0.5 text-2xs font-medium text-ai-700 hover:bg-ai-100"
                          >
                            {e.label} →
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : turn.error ? (
                  <div className="mr-4 rounded-xl border border-negative-100 bg-negative-50 px-3 py-2 text-xs text-negative-700">{turn.error}</div>
                ) : (
                  <div className="mr-4 flex items-center gap-2 rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2.5 text-xs text-ink-500">
                    <Loader2 size={13} className="animate-spin" /> Checking your books…
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="border-t border-ink-100 p-3"
          >
            <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 focus-within:border-ai-400 focus-within:ring-2 focus-within:ring-ai-500/20">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your accounts, or tell me what to do…"
                className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-400"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !input.trim()} className="text-ai-600 disabled:text-ink-300">
                <CornerDownLeft size={15} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
