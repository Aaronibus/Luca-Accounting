"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { uploadDocumentAction, ActionResult } from "@/app/actions";

export function DocumentUpload({ docType, label }: { docType: "INVOICE" | "RECEIPT" | "OTHER"; label: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <label className={`btn-ai cursor-pointer ${pending ? "opacity-60" : ""}`}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : null}
        {label}
        <input
          type="file"
          accept=".pdf,.txt,application/pdf,text/plain"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.set("file", file);
            fd.set("docType", docType);
            startTransition(async () => {
              const r = await uploadDocumentAction(fd);
              setResult(r);
              if (r.ok) router.refresh();
            });
            e.target.value = "";
          }}
        />
      </label>
      {result && (
        <span className={`max-w-xs text-2xs ${result.ok ? "text-positive-600" : "text-negative-600"}`}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </span>
  );
}
