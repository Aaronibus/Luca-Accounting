"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Simple period selector: month / quarter / YTD / last year, driven by query params. */
export function PeriodPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("range") ?? "month";

  const options = [
    { key: "month", label: "This month" },
    { key: "lastmonth", label: "Last month" },
    { key: "quarter", label: "This quarter" },
    { key: "ytd", label: "Year to date" },
  ];

  return (
    <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => router.push(`${pathname}?range=${o.key}`)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${current === o.key ? "bg-brand-700 text-white" : "text-ink-500 hover:bg-ink-50"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
