import { NextResponse } from "next/server";
import { requireCompany, AuthError } from "@/lib/auth";
import { trialBalance } from "@/lib/engine/reports";

export async function GET() {
  try {
    const ctx = await requireCompany("view");
    const tb = trialBalance(ctx.companyId, new Date());
    const lines = [
      "Code,Account,Type,Debit,Credit",
      ...tb.rows.map((r) =>
        [r.code, `"${r.name.replace(/"/g, '""')}"`, r.type, (r.debitCents / 100).toFixed(2), (r.creditCents / 100).toFixed(2)].join(",")
      ),
      `,,TOTALS,${(tb.totalDebit / 100).toFixed(2)},${(tb.totalCredit / 100).toFixed(2)}`,
    ];
    return new NextResponse(lines.join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="trial-balance-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
