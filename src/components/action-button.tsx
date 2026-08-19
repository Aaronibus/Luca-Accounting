"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { clsx } from "clsx";
import type { ActionResult } from "@/app/actions";

/** Button that runs a server action and surfaces the outcome inline. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
  className,
  onDone,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "ai" | "danger";
  confirm?: string;
  className?: string;
  onDone?: (r: ActionResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const cls = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    ghost: "btn-ghost",
    ai: "btn-ai",
    danger: "btn-danger",
  }[variant];

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        className={clsx(cls, className)}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const r = await action();
            setResult(r);
            onDone?.(r);
            if (r.ok) router.refresh();
            if (r.ok && r.message) setTimeout(() => setResult(null), 5000);
          });
        }}
      >
        {pending && <Loader2 size={13} className="animate-spin" />}
        {children}
      </button>
      {result && !result.ok && <span className="text-2xs text-negative-600">{result.error}</span>}
      {result && result.ok && result.message && <span className="text-2xs text-positive-600">{result.message}</span>}
    </span>
  );
}
