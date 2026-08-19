import { requireCompany } from "@/lib/auth";
import { agedCreditors } from "@/lib/engine/reports";
import { Card, PageHeader, fmtDate, EmptyState } from "@/components/ui";
import { AgedTable } from "@/components/aged-report";

export const dynamic = "force-dynamic";

export default async function AgedCreditorsPage() {
  const ctx = await requireCompany();
  const rows = agedCreditors(ctx.companyId);
  return (
    <div>
      <PageHeader breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Aged Creditors" }]} title="Aged Creditors" subtitle={`What you owe suppliers · as at ${fmtDate(new Date())}`} />
      <Card>
        {rows.length === 0 ? <EmptyState title="You owe nothing" body="All supplier bills are settled." /> : <AgedTable rows={rows} hrefBase="/purchases/bills" />}
      </Card>
    </div>
  );
}
