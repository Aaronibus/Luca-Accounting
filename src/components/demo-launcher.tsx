"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import { createDemoCompanyAction } from "@/app/company-actions";

export function DemoLauncher() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <button
        className="btn-secondary w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await createDemoCompanyAction();
            if (r.ok) {
              router.push("/dashboard");
              router.refresh();
            } else {
              setError(r.error);
            }
          })
        }
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
        {pending ? "Building demo file…" : "Open demo company"}
      </button>
      {error && <p className="mt-1 text-2xs text-negative-600">{error}</p>}
    </div>
  );
}
