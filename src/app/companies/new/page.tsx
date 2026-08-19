import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { currentUser, userCompanies } from "@/lib/auth";
import { CompanyWizard } from "@/components/company-wizard";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const companies = userCompanies(user.id);

  return (
    <div className="min-h-screen bg-surface px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Sparkles size={16} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">New company</h1>
            <p className="text-xs text-ink-500">A blank accounting file, configured for Ireland.</p>
          </div>
        </div>
        <CompanyWizard hasCompanies={companies.length > 0} />
      </div>
    </div>
  );
}
