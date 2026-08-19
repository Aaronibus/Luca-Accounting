// Company provisioning: Irish chart of accounts + date-effective Irish VAT rates.
// VAT rates verified against Revenue guidance (Aug 2026): 23% standard, 13.5% reduced,
// 9% second reduced (extended to restaurant/catering, takeaway food and hairdressing
// from 1 July 2026 under Budget 2026), 4.8% livestock, 0% zero rate, plus exempt.
// Rates are stored date-effective per company so future Finance Act changes are
// configuration, not code.

import { db, tables } from "@/db";
import { AccountSubtype, AccountType, SystemKey } from "@/lib/types";

interface CoaTemplateRow {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  systemKey?: SystemKey;
  isControl?: boolean;
  /** VAT category key to link the default rate after rates are created */
  defaultVat?: "STANDARD" | "REDUCED" | "SECOND_REDUCED" | "ZERO" | "EXEMPT";
  description?: string;
}

export const IRISH_COA: CoaTemplateRow[] = [
  // Assets
  { code: "1000", name: "Business Current Account", type: "ASSET", subtype: "BANK" },
  { code: "1100", name: "Accounts Receivable", type: "ASSET", subtype: "ACCOUNTS_RECEIVABLE", systemKey: "ACCOUNTS_RECEIVABLE", isControl: true, description: "Amounts owed to you by customers (debtors control)" },
  { code: "1200", name: "Inventory", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1300", name: "Prepayments", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1400", name: "Equipment", type: "ASSET", subtype: "FIXED_ASSET", defaultVat: "STANDARD" },
  { code: "1410", name: "Accumulated Depreciation — Equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1450", name: "Motor Vehicles", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1460", name: "Accumulated Depreciation — Vehicles", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1900", name: "Suspense", type: "ASSET", subtype: "CURRENT_ASSET", systemKey: "SUSPENSE", description: "Temporary holding account for unexplained items — should be zero" },

  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "LIABILITY", subtype: "ACCOUNTS_PAYABLE", systemKey: "ACCOUNTS_PAYABLE", isControl: true, description: "Amounts you owe suppliers (creditors control)" },
  { code: "2100", name: "VAT Control", type: "LIABILITY", subtype: "VAT", systemKey: "VAT_CONTROL", isControl: true, description: "VAT charged on sales less VAT reclaimed on purchases, for the open period" },
  { code: "2110", name: "VAT Payable to Revenue", type: "LIABILITY", subtype: "VAT", systemKey: "VAT_PAYABLE", description: "Finalised VAT returns awaiting payment" },
  { code: "2200", name: "PAYE / PRSI Payable", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2300", name: "Business Credit Card", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2400", name: "Accruals", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  { code: "2500", name: "Directors' Loan Account", type: "LIABILITY", subtype: "CURRENT_LIABILITY", systemKey: "DIRECTORS_LOAN" },
  { code: "2600", name: "Bank Loan", type: "LIABILITY", subtype: "LONG_TERM_LIABILITY" },

  // Equity
  { code: "3000", name: "Share Capital", type: "EQUITY", subtype: "EQUITY" },
  { code: "3100", name: "Retained Earnings", type: "EQUITY", subtype: "EQUITY", systemKey: "RETAINED_EARNINGS" },
  { code: "3200", name: "Owner Drawings", type: "EQUITY", subtype: "EQUITY", systemKey: "OWNER_DRAWINGS" },

  // Income
  { code: "4000", name: "Sales", type: "INCOME", subtype: "REVENUE", defaultVat: "STANDARD" },
  { code: "4100", name: "Sales — Services", type: "INCOME", subtype: "REVENUE", defaultVat: "STANDARD" },
  { code: "4900", name: "Other Income", type: "INCOME", subtype: "OTHER_INCOME", defaultVat: "STANDARD" },
  { code: "4910", name: "Interest Income", type: "INCOME", subtype: "OTHER_INCOME", defaultVat: "EXEMPT" },

  // Cost of sales
  { code: "5000", name: "Purchases", type: "EXPENSE", subtype: "COST_OF_SALES", defaultVat: "STANDARD" },
  { code: "5100", name: "Direct Labour", type: "EXPENSE", subtype: "COST_OF_SALES", defaultVat: "EXEMPT" },
  { code: "5200", name: "Carriage & Freight", type: "EXPENSE", subtype: "COST_OF_SALES", defaultVat: "STANDARD" },

  // Operating expenses
  { code: "6000", name: "Rent", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "6010", name: "Commercial Rates", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "6020", name: "Insurance", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "6100", name: "Light & Heat", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "SECOND_REDUCED", description: "Electricity and gas — 9% VAT" },
  { code: "6200", name: "Telephone & Internet", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6300", name: "Software & Subscriptions", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6400", name: "Marketing & Advertising", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6500", name: "Motor Expenses", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6510", name: "Travel & Subsistence", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "ZERO" },
  { code: "6600", name: "Office Supplies & Stationery", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6700", name: "Repairs & Maintenance", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "REDUCED" },
  { code: "6800", name: "Professional Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "6900", name: "Bank Fees & Charges", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "7000", name: "Wages & Salaries", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "7010", name: "Employer PRSI", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "EXEMPT" },
  { code: "7100", name: "Staff Training & Welfare", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "7200", name: "Cleaning", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "REDUCED" },
  { code: "7300", name: "Sundry Expenses", type: "EXPENSE", subtype: "OPERATING_EXPENSE", defaultVat: "STANDARD" },
  { code: "7500", name: "Depreciation", type: "EXPENSE", subtype: "DEPRECIATION", defaultVat: "EXEMPT" },
  { code: "7900", name: "Loan Interest", type: "EXPENSE", subtype: "FINANCE_COST", defaultVat: "EXEMPT" },
  { code: "9999", name: "Rounding", type: "EXPENSE", subtype: "OPERATING_EXPENSE", systemKey: "ROUNDING" },
];

/** Irish VAT rates, date-effective. */
export const IRISH_VAT_RATES = [
  { name: "Standard 23%", rateBps: 2300, category: "STANDARD", validFrom: new Date("2012-01-01") },
  { name: "Reduced 13.5%", rateBps: 1350, category: "REDUCED", validFrom: new Date("2003-01-01") },
  { name: "Second Reduced 9%", rateBps: 900, category: "SECOND_REDUCED", validFrom: new Date("2011-07-01") },
  { name: "Livestock 4.8%", rateBps: 480, category: "LIVESTOCK", validFrom: new Date("2005-01-01") },
  { name: "Zero 0%", rateBps: 0, category: "ZERO", validFrom: new Date("1972-11-01") },
  { name: "Exempt", rateBps: 0, category: "EXEMPT", validFrom: new Date("1972-11-01") },
] as const;

export interface ProvisionCompanyOptions {
  organisationId: string;
  name: string;
  ownerUserId: string;
  tradingName?: string;
  vatNumber?: string;
  croNumber?: string;
  vatBasis?: "INVOICE" | "CASH";
  vatPeriodMonths?: number;
  yearEndMonth?: number;
  yearEndDay?: number;
  baseCurrency?: string;
  entityType?: string;
  industry?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  county?: string;
  eircode?: string;
  country?: string;
  contactEmail?: string;
  contactPhone?: string;
  isDemo?: boolean;
}

/**
 * Create a company with CONFIGURATION ONLY — Irish chart of accounts, VAT rates
 * and numbering sequences. No contacts, no documents, no journals, no bank
 * accounts: a genuinely blank accounting file.
 */
export function provisionCompany(opts: ProvisionCompanyOptions): { companyId: string } {
  return db.transaction(() => {
    const company = db
      .insert(tables.companies)
      .values({
        organisationId: opts.organisationId,
        name: opts.name,
        tradingName: opts.tradingName,
        vatNumber: opts.vatNumber,
        croNumber: opts.croNumber,
        vatBasis: opts.vatBasis ?? "INVOICE",
        vatPeriodMonths: opts.vatPeriodMonths ?? 2,
        yearEndMonth: opts.yearEndMonth ?? 12,
        yearEndDay: opts.yearEndDay ?? 31,
        baseCurrency: opts.baseCurrency ?? "EUR",
        entityType: opts.entityType ?? "LIMITED_COMPANY",
        industry: opts.industry,
        addressLine1: opts.addressLine1,
        addressLine2: opts.addressLine2,
        city: opts.city,
        county: opts.county,
        eircode: opts.eircode,
        country: opts.country ?? "IE",
        contactEmail: opts.contactEmail,
        contactPhone: opts.contactPhone,
        isDemo: opts.isDemo ?? false,
      })
      .returning({ id: tables.companies.id })
      .get();

    db.insert(tables.memberships)
      .values({ userId: opts.ownerUserId, companyId: company.id, role: "OWNER" })
      .run();

    // VAT rates first so accounts can reference default rates
    const rateIds = new Map<string, string>();
    for (const r of IRISH_VAT_RATES) {
      const row = db
        .insert(tables.vatRates)
        .values({ companyId: company.id, name: r.name, rateBps: r.rateBps, category: r.category, validFrom: r.validFrom })
        .returning({ id: tables.vatRates.id })
        .get();
      rateIds.set(r.category, row.id);
    }

    for (const a of IRISH_COA) {
      db.insert(tables.accounts)
        .values({
          companyId: company.id,
          code: a.code,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          systemKey: a.systemKey,
          isControl: a.isControl ?? false,
          description: a.description,
          defaultVatRateId: a.defaultVat ? rateIds.get(a.defaultVat) : undefined,
        })
        .run();
    }

    // Document number sequences
    const seqs: Array<{ key: string; prefix: string }> = [
      { key: "INVOICE", prefix: "INV-" },
      { key: "CREDIT_NOTE", prefix: "CN-" },
      { key: "BILL", prefix: "BILL-" },
      { key: "EXPENSE", prefix: "EXP-" },
      { key: "PAYMENT", prefix: "PAY-" },
      { key: "JOURNAL", prefix: "" },
    ];
    for (const s of seqs) {
      db.insert(tables.numberSequences).values({ companyId: company.id, key: s.key, prefix: s.prefix }).run();
    }

    return { companyId: company.id };
  });
}
