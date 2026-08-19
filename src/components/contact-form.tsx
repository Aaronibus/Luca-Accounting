"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { createContactAction, ActionResult } from "@/app/actions";

export function ContactForm({ type }: { type: "CUSTOMER" | "SUPPLIER" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [county, setCounty] = useState("");
  const [terms, setTerms] = useState("30");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus size={15} /> New {type === "CUSTOMER" ? "customer" : "supplier"}
      </button>
    );
  }
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await createContactAction({ type, name, email: email || undefined, county: county || undefined, paymentTermsDays: parseInt(terms) || 30 });
          setResult(r);
          if (r.ok) { setOpen(false); setName(""); setEmail(""); router.refresh(); }
        });
      }}
    >
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Name</span>
        <input className="input w-52" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Email</span>
        <input className="input w-52" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">County</span>
        <input className="input w-36" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Co. Kilkenny" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink-600">Terms (days)</span>
        <input className="input w-20 tnum" value={terms} onChange={(e) => setTerms(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn-primary" disabled={pending}>{pending && <Loader2 size={13} className="animate-spin" />} Save</button>
      </div>
      {result && !result.ok && <p className="w-full text-2xs text-negative-600">{result.error}</p>}
    </form>
  );
}
