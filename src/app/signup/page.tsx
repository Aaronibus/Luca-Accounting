"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (res.ok) {
      router.push("/welcome");
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Could not create your account");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-raised">
            <Sparkles size={22} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your Lúca account</h1>
          <p className="mt-1 text-sm text-ink-500">Then set up your first company — it starts completely empty.</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600">Your name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
            <p className="mt-1 text-2xs text-ink-400">At least 8 characters.</p>
          </div>
          {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-xs text-negative-700">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Already have an account? <Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
