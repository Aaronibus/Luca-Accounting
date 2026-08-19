import { requireCompany } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BankAccountForm } from "@/components/bank-account-form";

export const dynamic = "force-dynamic";

export default async function NewBankAccountPage() {
  await requireCompany("edit");
  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Banking", href: "/banking" }, { label: "New account" }]}
        title="Add a bank account"
        subtitle="Creates the bank record and its nominal ledger account, ready for statement imports."
      />
      <div className="max-w-3xl">
        <BankAccountForm />
      </div>
    </div>
  );
}
