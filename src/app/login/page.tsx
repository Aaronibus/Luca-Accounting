"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Sparkles, Loader2 } from "lucide-react";
import { Suspense } from "react";

function LoginForm() {
  const [email, setEmail] = useState("aaron@caracoffee.ie");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      router.push(params.get("next") ?? "/dashboard");
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Sign in failed");
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
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Lúca</h1>
          <p className="mt-1 text-sm text-ink-500">AI-native accounting for Irish business</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-600">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <p className="rounded-lg bg-negative-50 px-3 py-2 text-xs text-negative-700">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          New to Lúca? <Link href="/signup" className="font-medium text-brand-700 hover:underline">Create an account</Link>
        </p>

        <div className="mt-4 rounded-lg border border-brand-100 bg-brand-25 px-4 py-3 text-xs text-brand-800">
          <strong>Demo workspace:</strong> Cara Coffee Roasters Ltd (Kilkenny).<br />
          Owner: aaron@caracoffee.ie · Accountant: maire@kellyaccountants.ie · password <code>demo1234</code>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
