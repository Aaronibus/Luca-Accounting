import { clsx } from "clsx";
import Link from "next/link";
import { fmtEUR } from "@/lib/money";

export function Card({ children, className, title, action }: { children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }) {
  return (
    <section className={clsx("card", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between px-4 pt-3.5 pb-1">
          {title && <h3 className="text-sm font-semibold text-ink-800">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Money({ cents, signed, className, muted }: { cents: number; signed?: boolean; className?: string; muted?: boolean }) {
  const negative = cents < 0;
  return (
    <span className={clsx("tnum", negative ? "text-negative-600" : muted ? "text-ink-500" : "text-ink-900", className)}>
      {fmtEUR(cents, { sign: signed })}
    </span>
  );
}

const badgeTones = {
  green: "bg-positive-50 text-positive-700 ring-positive-500/20",
  red: "bg-negative-50 text-negative-700 ring-negative-500/20",
  amber: "bg-warn-50 text-warn-700 ring-warn-500/20",
  grey: "bg-ink-100 text-ink-600 ring-ink-300/30",
  blue: "bg-brand-50 text-brand-700 ring-brand-500/20",
  ai: "bg-ai-50 text-ai-700 ring-ai-500/20",
} as const;

export function Badge({ tone = "grey", children }: { tone?: keyof typeof badgeTones; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset whitespace-nowrap", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function statusBadge(status: string) {
  const map: Record<string, { tone: keyof typeof badgeTones; label: string }> = {
    DRAFT: { tone: "grey", label: "Draft" },
    AWAITING_APPROVAL: { tone: "amber", label: "Awaiting approval" },
    APPROVED: { tone: "blue", label: "Awaiting payment" },
    SENT: { tone: "blue", label: "Sent" },
    PAID: { tone: "green", label: "Paid" },
    VOID: { tone: "grey", label: "Void" },
    UNRECONCILED: { tone: "amber", label: "Unexplained" },
    MATCHED: { tone: "blue", label: "Matched" },
    RECONCILED: { tone: "green", label: "Reconciled" },
    EXCLUDED: { tone: "grey", label: "Excluded" },
    POSTED: { tone: "green", label: "Posted" },
    REVERSED: { tone: "grey", label: "Reversed" },
    FINALISED: { tone: "green", label: "Finalised" },
    REVIEW: { tone: "amber", label: "In review" },
    SUGGESTED: { tone: "ai", label: "Suggested" },
    ACCEPTED: { tone: "green", label: "Accepted" },
    REJECTED: { tone: "grey", label: "Rejected" },
    OVERDUE: { tone: "red", label: "Overdue" },
  };
  const cfg = map[status] ?? { tone: "grey" as const, label: status };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: Array<{ label: string; href?: string }> }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {breadcrumb && (
          <nav className="mb-1 flex items-center gap-1.5 text-xs text-ink-400">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span>/</span>}
                {b.href ? <Link className="hover:text-ink-600" href={b.href}>{b.label}</Link> : <span>{b.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-300">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink-700">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ head, children, dense }: { head: React.ReactNode; children: React.ReactNode; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full border-collapse text-sm", dense && "text-xs")}>
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "up" | "down" | "neutral" }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-2xs font-semibold uppercase tracking-wider text-ink-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tnum tracking-tight text-ink-900">{value}</div>
      {hint && (
        <div className={clsx("mt-0.5 text-xs", tone === "up" ? "text-positive-600" : tone === "down" ? "text-negative-600" : "text-ink-500")}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function fmtDate(dt: Date | number | string): string {
  return new Date(dt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}
export function fmtDateShort(dt: Date | number | string): string {
  return new Date(dt).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}
