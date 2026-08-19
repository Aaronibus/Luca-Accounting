"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, LogOut, Building2, Search, Plus, Settings, Users, Archive, Check, Loader2 } from "lucide-react";
import { useState, useRef, useEffect, useMemo, useTransition } from "react";
import { switchCompanyAction, archiveCompanyAction } from "@/app/company-actions";

export interface CompanyOption {
  companyId: string;
  name: string;
  tradingName: string | null;
  role: string;
  isDemo: boolean;
  archived: boolean;
  city: string | null;
}

export function CompanySwitcher({
  current,
  companies,
}: {
  current: { id: string; name: string; isDemo: boolean };
  companies: CompanyOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.tradingName, c.city].filter(Boolean).some((v) => v!.toLowerCase().includes(q))
    );
  }, [companies, query]);

  function switchTo(companyId: string) {
    if (companyId === current.id) {
      setOpen(false);
      return;
    }
    setBusyId(companyId);
    startTransition(async () => {
      const r = await switchCompanyAction(companyId);
      setBusyId(null);
      if (r.ok) {
        setOpen(false);
        router.push("/dashboard");
        router.refresh();
      }
    });
  }

  function archive(companyId: string, name: string) {
    if (!window.confirm(`Archive ${name}? Its data is kept but the company is hidden from the switcher.`)) return;
    setBusyId(companyId);
    startTransition(async () => {
      await archiveCompanyAction(companyId);
      setBusyId(null);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-ink-900 hover:bg-ink-50"
      >
        <Building2 size={15} className="text-brand-600" />
        <span className="max-w-[240px] truncate">{current.name}</span>
        {current.isDemo && (
          <span className="rounded bg-ai-100 px-1.5 py-0.5 text-2xs font-bold tracking-wide text-ai-700">DEMO</span>
        )}
        <ChevronDown size={14} className="text-ink-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-overlay animate-fade-in">
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
            <Search size={14} className="text-ink-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search companies…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-400"
            />
          </div>

          <div className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-ink-400">No companies match “{query}”.</p>
            )}
            {filtered.map((c) => (
              <div key={c.companyId} className="group flex items-center gap-1 rounded-lg hover:bg-ink-50">
                <button onClick={() => switchTo(c.companyId)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-2xs font-bold text-brand-700">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={`truncate text-[13px] ${c.companyId === current.id ? "font-semibold text-brand-700" : "text-ink-800"}`}>
                        {c.name}
                      </span>
                      {c.isDemo && <span className="rounded bg-ai-100 px-1 text-2xs font-bold text-ai-700">DEMO</span>}
                    </span>
                    <span className="block truncate text-2xs text-ink-400">
                      {c.role.toLowerCase()}{c.city ? ` · ${c.city}` : ""}
                    </span>
                  </span>
                  {busyId === c.companyId && pending ? (
                    <Loader2 size={13} className="animate-spin text-ink-400" />
                  ) : c.companyId === current.id ? (
                    <Check size={14} className="text-brand-600" />
                  ) : null}
                </button>
                {["OWNER", "ADMIN"].includes(c.role) && c.companyId !== current.id && (
                  <button
                    title="Archive company"
                    onClick={() => archive(c.companyId, c.name)}
                    className="mr-1 hidden rounded p-1 text-ink-300 hover:bg-white hover:text-negative-500 group-hover:block"
                  >
                    <Archive size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-ink-100 p-1">
            <Link href="/companies/new" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-brand-700 hover:bg-brand-25">
              <Plus size={14} /> Create a new company
            </Link>
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-600 hover:bg-ink-50">
              <Settings size={14} /> Company settings
            </Link>
            <Link href="/settings#team" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-600 hover:bg-ink-50">
              <Users size={14} /> Users & access
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <div className="text-[13px] font-medium text-ink-800">{name}</div>
        <div className="text-2xs uppercase tracking-wide text-ink-400">{role.toLowerCase()}</div>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
        {name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
      </div>
      <button onClick={logout} title="Sign out" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700">
        <LogOut size={15} />
      </button>
    </div>
  );
}
