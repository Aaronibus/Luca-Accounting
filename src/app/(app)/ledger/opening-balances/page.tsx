import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCompany } from "@/lib/auth";
import { NORMAL_SIDE, AccountType } from "@/lib/types";
import { PageHeader, Card } from "@/components/ui";
import { OpeningBalancesForm } from "@/components/opening-balances-form";

export const dynamic = "force-dynamic";

export default async function OpeningBalancesPage() {
  const ctx = await requireCompany("post");

  const accounts = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, ctx.companyId), eq(tables.accounts.archived, false)))
    .orderBy(tables.accounts.code)
    .all();

  // Sensible starting rows: bank accounts, debtors, creditors, VAT, equity
  const suggested = accounts
    .filter((a) => ["BANK", "ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE"].includes(a.subtype) || a.systemKey === "RETAINED_EARNINGS")
    .slice(0, 4)
    .map((a) => a.id);

  const existing = db
    .select({ id: tables.journals.id, number: tables.journals.journalNumber, date: tables.journals.date })
    .from(tables.journals)
    .where(and(eq(tables.journals.companyId, ctx.companyId), eq(tables.journals.sourceType, "OPENING_BALANCE")))
    .all();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Ledger", href: "/ledger" }, { label: "Opening balances" }]}
        title="Opening balances"
        subtitle="Bring across the closing position from your previous system. Nothing is assumed — every figure is one you enter."
      />

      {existing.length > 0 && (
        <Card className="mb-4 p-4">
          <p className="text-[13px] text-ink-600">
            This company already has {existing.length} opening-balance journal{existing.length === 1 ? "" : "s"}
            {" "}(#{existing.map((e) => e.number).join(", #")}). Posting again adds a further journal rather than replacing
            them — reverse the earlier one first if you need to correct it.
          </p>
        </Card>
      )}

      <div className="max-w-4xl">
        <OpeningBalancesForm
          accounts={accounts.map((a) => ({
            id: a.id,
            label: `${a.code} · ${a.name}`,
            normalSide: NORMAL_SIDE[a.type as AccountType],
          }))}
          suggested={suggested}
        />
      </div>
    </div>
  );
}
