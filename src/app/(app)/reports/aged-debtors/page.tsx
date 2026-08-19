import { requireCompany } from "@/lib/auth";
import { agedDebtors } from "@/lib/engine/reports";
import { Card, PageHeader, fmtDate, EmptyState } from "@/components/ui";
import { AgedTable } from "@/components/aged-report";

export const dynamic = "force-dynamic";

export default async function AgedDebtorsPage() {
  const ctx = await requireCompany();
  const rows = agedDebtors(ctx.companyId);
  return (
    <div>
      <PageHeader breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Aged Debtors" }]} title="Aged Debtors" subtitle={`Who owes you money · as at ${fmtDate(new Date())}`} />
      <Card>
        {rows.length === 0 ? <EmptyState title="Nobody owes you anything" body="Every invoice is either paid or not yet issued." /> : <AgedTable rows={rows} hrefBase="/sales/invoices" />}
      </Card>
    </div>
  );
}
