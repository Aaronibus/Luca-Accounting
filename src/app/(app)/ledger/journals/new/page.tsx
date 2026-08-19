import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { JournalForm } from "@/components/journal-form";

export const dynamic = "force-dynamic";

export default async function NewJournalPage() {
  const ctx = await requireCompany("post");
  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.archived, false)))
    .orderBy(tables.accounts.code)
    .all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Ledger", href: "/ledger" }, { label: "Journals", href: "/ledger/journals" }, { label: "New" }]}
        title="Manual journal"
        subtitle="For adjustments, accruals and corrections. Debits must equal credits — the engine will not accept anything else."
      />
      <JournalForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} />
    </div>
  );
}
