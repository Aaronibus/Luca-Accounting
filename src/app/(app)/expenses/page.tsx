import { desc, eq } from "drizzle-orm";
import { Camera } from "lucide-react";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { Card, Money, PageHeader, Table, statusBadge, fmtDate, EmptyState } from "@/components/ui";
import { ExpenseForm } from "@/components/expense-form";
import { DocumentUpload } from "@/components/document-upload";
import { ActionButton } from "@/components/action-button";
import { approveExpenseAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const ctx = await requireCompany();
  const expenses = db
    .select()
    .from(tables.expenses)
    .where(eq(tables.expenses.companyId, ctx.companyId))
    .orderBy(desc(tables.expenses.date))
    .limit(150)
    .all();

  const accounts = db
    .select()
    .from(tables.accounts)
    .where(eq(tables.accounts.companyId, ctx.companyId))
    .orderBy(tables.accounts.code)
    .all();
  const accountMap = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE" && !a.systemKey);
  const vatRates = db.select().from(tables.vatRates).where(eq(tables.vatRates.companyId, ctx.companyId)).all();
  const banks = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.companyId, ctx.companyId)).all();

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Out-of-pocket and card spending. Scan a receipt and Lúca extracts the merchant, VAT and category."
        actions={
          ctx.can("submit_expense") || ctx.can("edit") ? (
            <>
              <DocumentUpload docType="RECEIPT" label={<><Camera size={15} /> Scan receipt</>} />
              <ExpenseForm
                accounts={expenseAccounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
                vatRates={vatRates.map((r) => ({ id: r.id, label: r.name, rateBps: r.rateBps, category: r.category }))}
                banks={banks.map((b) => ({ id: b.id, label: b.name }))}
              />
            </>
          ) : undefined
        }
      />
      <Card>
        {expenses.length === 0 ? (
          <EmptyState title="No expenses yet" body="Add one manually or scan a receipt — drafts wait for approval before touching the books." />
        ) : (
          <Table
            head={
              <>
                <th className="table-th">Merchant</th>
                <th className="table-th">Category</th>
                <th className="table-th">Date</th>
                <th className="table-th">Paid via</th>
                <th className="table-th">Status</th>
                <th className="table-th text-right">VAT</th>
                <th className="table-th text-right">Gross</th>
                <th className="table-th" />
              </>
            }
          >
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-ink-50/50">
                <td className="table-td">
                  <div className="font-medium text-ink-800">{e.merchant}</div>
                  {e.description && <div className="text-2xs text-ink-400">{e.description}</div>}
                  {e.origin === "RECEIPT_SCAN" && <span className="text-2xs text-ai-600">from receipt scan</span>}
                </td>
                <td className="table-td text-xs text-ink-500">{accountMap.get(e.accountId)}</td>
                <td className="table-td whitespace-nowrap">{fmtDate(e.date)}</td>
                <td className="table-td text-xs">{e.paidVia === "PERSONAL" ? "Personal (owed back)" : e.paidVia === "BANK" ? "Bank" : "Cash"}</td>
                <td className="table-td">{statusBadge(e.status)}</td>
                <td className="table-td text-right"><Money cents={e.vatCents} muted={e.vatCents === 0} /></td>
                <td className="table-td text-right"><Money cents={e.grossCents} /></td>
                <td className="table-td">
                  {e.status === "DRAFT" && ctx.can("approve") && (
                    <ActionButton action={approveExpenseAction.bind(null, e.id)} variant="secondary" className="!px-2 !py-1 text-xs">Approve</ActionButton>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
