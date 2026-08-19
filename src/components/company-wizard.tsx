"use client";

// Three-step company creation wizard. Step 3 is explicit about what the new
// company will and will not contain — configuration yes, data no.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, ArrowRight, ArrowLeft, ListChecks } from "lucide-react";
import { createCompanyAction, NewCompanyForm } from "@/app/company-actions";

const ENTITY_TYPES = [
  { value: "LIMITED_COMPANY", label: "Limited company (Ltd / DAC)" },
  { value: "SOLE_TRADER", label: "Sole trader" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "CHARITY", label: "Charity / CLG" },
  { value: "OTHER", label: "Other" },
];

const INDUSTRIES = [
  "Professional services", "Construction & trades", "Retail", "Hospitality & food",
  "Food & beverage production", "Technology & software", "Healthcare", "Transport & logistics",
  "Agriculture", "Property & letting", "Creative & media", "Education & training", "Other",
];

const COUNTIES = [
  "Co. Carlow", "Co. Cavan", "Co. Clare", "Co. Cork", "Co. Donegal", "Dublin", "Co. Galway",
  "Co. Kerry", "Co. Kildare", "Co. Kilkenny", "Co. Laois", "Co. Leitrim", "Co. Limerick",
  "Co. Longford", "Co. Louth", "Co. Mayo", "Co. Meath", "Co. Monaghan", "Co. Offaly",
  "Co. Roscommon", "Co. Sligo", "Co. Tipperary", "Co. Waterford", "Co. Westmeath",
  "Co. Wexford", "Co. Wicklow",
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function CompanyWizard({ hasCompanies }: { hasCompanies: boolean }) {
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [form, setForm] = useState<NewCompanyForm>({
    name: "",
    tradingName: "",
    croNumber: "",
    entityType: "LIMITED_COMPANY",
    industry: "",
    addressLine1: "",
    city: "",
    county: "",
    eircode: "",
    country: "IE",
    contactEmail: "",
    contactPhone: "",
    yearEndMonth: 12,
    yearEndDay: 31,
    baseCurrency: "EUR",
    vatRegistered: true,
    vatNumber: "",
    vatBasis: "INVOICE",
    vatPeriodMonths: 2,
  });

  const set = (patch: Partial<NewCompanyForm>) => setForm((f) => ({ ...f, ...patch }));

  const steps = [
    { n: 1, label: "Company details" },
    { n: 2, label: "Accounting setup" },
    { n: 3, label: "Chart of accounts" },
  ];

  function submit() {
    startTransition(async () => {
      const r = await createCompanyAction(form);
      if (r.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setError(r.error);
        setStep(1);
      }
    });
  }

  return (
    <div>
      {/* Stepper */}
      <ol className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ${
                step > s.n ? "bg-positive-500 text-white" : step === s.n ? "bg-brand-700 text-white" : "bg-ink-100 text-ink-400"
              }`}
            >
              {step > s.n ? <Check size={12} /> : s.n}
            </span>
            <span className={`text-xs font-medium ${step >= s.n ? "text-ink-800" : "text-ink-400"}`}>{s.label}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-ink-100" />}
          </li>
        ))}
      </ol>

      <div className="card p-6">
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-ink-600">Company name *</span>
                <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Byrne Consulting Ltd" autoFocus />
                <span className="mt-1 block text-2xs text-ink-400">The legal or registered name as it should appear on invoices.</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Trading name</span>
                <input className="input" value={form.tradingName} onChange={(e) => set({ tradingName: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Business type</span>
                <select className="input" value={form.entityType} onChange={(e) => set({ entityType: e.target.value })}>
                  {ENTITY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">CRO number</span>
                <input className="input" value={form.croNumber} onChange={(e) => set({ croNumber: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Industry</span>
                <select className="input" value={form.industry} onChange={(e) => set({ industry: e.target.value })}>
                  <option value="">Not specified</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-ink-600">Address</span>
                <input className="input" value={form.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Town / city</span>
                <input className="input" value={form.city} onChange={(e) => set({ city: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">County</span>
                <select className="input" value={form.county} onChange={(e) => set({ county: e.target.value })}>
                  <option value="">Not specified</option>
                  {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Eircode</span>
                <input className="input" value={form.eircode} onChange={(e) => set({ eircode: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Country</span>
                <select className="input" value={form.country} onChange={(e) => set({ country: e.target.value })}>
                  <option value="IE">Ireland</option>
                  <option value="GB">United Kingdom</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Contact email</span>
                <input className="input" type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-600">Contact phone</span>
                <input className="input" value={form.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} placeholder="Optional" />
              </label>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-800">Financial year</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-600">Year end month</span>
                  <select className="input" value={form.yearEndMonth} onChange={(e) => set({ yearEndMonth: parseInt(e.target.value) })}>
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-600">Year end day</span>
                  <input className="input tnum" type="number" min={1} max={31} value={form.yearEndDay} onChange={(e) => set({ yearEndDay: parseInt(e.target.value) || 31 })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-600">Currency</span>
                  <select className="input" value={form.baseCurrency} onChange={(e) => set({ baseCurrency: e.target.value })}>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">GBP — Pound sterling</option>
                    <option value="USD">USD — US dollar</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="border-t border-ink-100 pt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink-800">VAT</h3>
              <label className="mb-3 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-700 focus:ring-brand-500/30"
                  checked={form.vatRegistered}
                  onChange={(e) => set({ vatRegistered: e.target.checked })}
                />
                <span className="text-[13px] text-ink-700">
                  This business is registered for VAT
                  <span className="block text-2xs text-ink-400">Irish VAT rates are configured either way — you can register later.</span>
                </span>
              </label>
              {form.vatRegistered && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-600">VAT number</span>
                    <input className="input" value={form.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} placeholder="IE1234567AB" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-600">Basis of accounting</span>
                    <select className="input" value={form.vatBasis} onChange={(e) => set({ vatBasis: e.target.value as "INVOICE" | "CASH" })}>
                      <option value="INVOICE">Invoice basis (accrual)</option>
                      <option value="CASH">Cash receipts basis</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink-600">Taxable period</span>
                    <select className="input" value={form.vatPeriodMonths} onChange={(e) => set({ vatPeriodMonths: parseInt(e.target.value) })}>
                      <option value={2}>Bi-monthly (standard)</option>
                      <option value={4}>Four-monthly</option>
                      <option value={6}>Half-yearly</option>
                      <option value={12}>Annual</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-brand-200 bg-brand-25 p-4">
              <div className="flex items-start gap-3">
                <ListChecks size={18} className="mt-0.5 shrink-0 text-brand-700" />
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">Recommended Irish chart of accounts</h3>
                  <p className="mt-1 text-[13px] text-ink-600">
                    Assets, liabilities, equity, income and expenses laid out for an Irish business, with VAT control,
                    debtors and creditors control accounts wired into the posting engine. You can rename, add or archive
                    accounts at any time.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-ink-100 p-3">
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-positive-600">Your company will have</p>
                <ul className="space-y-1 text-[13px] text-ink-600">
                  <li>✓ Irish chart of accounts</li>
                  <li>✓ VAT rates: 23% · 13.5% · 9% · 4.8% · 0% · exempt</li>
                  <li>✓ Invoice, bill and journal numbering</li>
                  <li>✓ Your accounting settings above</li>
                </ul>
              </div>
              <div className="rounded-lg border border-ink-100 p-3">
                <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-400">And will start with none of</p>
                <ul className="space-y-1 text-[13px] text-ink-500">
                  <li>· Customers, suppliers or invoices</li>
                  <li>· Bills, expenses or receipts</li>
                  <li>· Bank accounts or transactions</li>
                  <li>· Journals, VAT returns or history</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-ink-500">
              Configuration exists. Data does not — every figure in this company will come from what you enter or import.
            </p>
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-negative-50 px-3 py-2 text-xs text-negative-700">{error}</p>}

        <div className="mt-6 flex items-center justify-between border-t border-ink-100 pt-4">
          <button
            className="btn-ghost"
            onClick={() => (step > 1 ? setStep(step - 1) : history.back())}
            disabled={pending}
          >
            <ArrowLeft size={14} /> {step > 1 ? "Back" : hasCompanies ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button className="btn-primary" disabled={step === 1 && form.name.trim().length < 2} onClick={() => setStep(step + 1)}>
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn-primary" disabled={pending} onClick={submit}>
              {pending && <Loader2 size={14} className="animate-spin" />} Create company
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
