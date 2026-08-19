"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { updateCompanySettingsAction, archiveCompanyAction } from "@/app/company-actions";
import type { ActionResult } from "@/app/actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CompanyFormValues {
  name: string;
  tradingName: string;
  croNumber: string;
  vatNumber: string;
  entityType: string;
  industry: string;
  addressLine1: string;
  city: string;
  county: string;
  eircode: string;
  country: string;
  contactEmail: string;
  contactPhone: string;
  vatBasis: string;
  vatPeriodMonths: number;
  yearEndMonth: number;
  yearEndDay: number;
  baseCurrency: string;
}

export function CompanySettingsForm({ initial, canEdit }: { initial: CompanyFormValues; canEdit: boolean }) {
  const [form, setForm] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const set = (patch: Partial<CompanyFormValues>) => setForm((f) => ({ ...f, ...patch }));
  const dis = !canEdit;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateCompanySettingsAction(form as unknown as Record<string, string | number>);
          setResult(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Company details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Company name</span>
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Trading name</span>
            <input className="input" value={form.tradingName} onChange={(e) => set({ tradingName: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Business type</span>
            <select className="input" value={form.entityType} onChange={(e) => set({ entityType: e.target.value })} disabled={dis}>
              <option value="LIMITED_COMPANY">Limited company</option>
              <option value="SOLE_TRADER">Sole trader</option>
              <option value="PARTNERSHIP">Partnership</option>
              <option value="CHARITY">Charity / CLG</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Industry</span>
            <input className="input" value={form.industry} onChange={(e) => set({ industry: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Address</span>
            <input className="input" value={form.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Town / city</span>
            <input className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">County</span>
            <input className="input" value={form.county} onChange={(e) => set({ county: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Eircode</span>
            <input className="input" value={form.eircode} onChange={(e) => set({ eircode: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Contact email</span>
            <input className="input" type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Contact phone</span>
            <input className="input" value={form.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} disabled={dis} />
          </label>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Tax & accounting</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">CRO number</span>
            <input className="input" value={form.croNumber} onChange={(e) => set({ croNumber: e.target.value })} disabled={dis} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">VAT number</span>
            <input className="input" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} disabled={dis} placeholder="Not registered" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">VAT basis</span>
            <select className="input" value={form.vatBasis} onChange={(e) => set({ vatBasis: e.target.value })} disabled={dis}>
              <option value="INVOICE">Invoice basis (accrual)</option>
              <option value="CASH">Cash receipts basis</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">VAT taxable period</span>
            <select className="input" value={form.vatPeriodMonths} onChange={(e) => set({ vatPeriodMonths: parseInt(e.target.value) })} disabled={dis}>
              <option value={2}>Bi-monthly (standard)</option>
              <option value={4}>Four-monthly</option>
              <option value={6}>Half-yearly</option>
              <option value={12}>Annual</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Financial year end</span>
            <div className="flex gap-2">
              <select className="input" value={form.yearEndMonth} onChange={(e) => set({ yearEndMonth: parseInt(e.target.value) })} disabled={dis}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
              <input className="input w-20 tnum" type="number" min={1} max={31} value={form.yearEndDay} onChange={(e) => set({ yearEndDay: parseInt(e.target.value) || 31 })} disabled={dis} />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Base currency</span>
            <select className="input" value={form.baseCurrency} onChange={(e) => set({ baseCurrency: e.target.value })} disabled={dis}>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — Pound sterling</option>
              <option value="USD">USD — US dollar</option>
            </select>
          </label>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-3 border-t border-ink-100 pt-4">
          {result && (
            <span className={`text-xs ${result.ok ? "text-positive-600" : "text-negative-600"}`}>
              {result.ok ? result.message : result.error}
            </span>
          )}
          <button className="btn-primary" disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
          </button>
        </div>
      )}
    </form>
  );
}

export function ArchiveCompanyButton({ companyId, name }: { companyId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <button
        className="btn-danger"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Archive ${name}? All accounting data is retained, but the company is hidden from the switcher. You can restore it later.`)) return;
          startTransition(async () => {
            const r = await archiveCompanyAction(companyId);
            if (r.ok) {
              router.push("/dashboard");
              router.refresh();
            } else setError(r.error);
          });
        }}
      >
        {pending && <Loader2 size={13} className="animate-spin" />} Archive this company
      </button>
      {error && <p className="mt-1 text-2xs text-negative-600">{error}</p>}
    </div>
  );
}
