// Irish merchant knowledge base for transaction intelligence.
// Maps bank-statement text patterns to account codes + VAT treatment.
// This is the deterministic heuristic tier — bank rules and merchant memory
// take precedence, and an LLM tier can refine ambiguous cases.

export interface MerchantPattern {
  pattern: RegExp;
  merchant: string;
  accountCode: string;
  vatCategory: "STANDARD" | "REDUCED" | "SECOND_REDUCED" | "ZERO" | "EXEMPT";
  confidence: number; // 0-100
  note?: string;
}

export const IRISH_MERCHANT_PATTERNS: MerchantPattern[] = [
  // Utilities — 9% second reduced rate on electricity & gas
  { pattern: /\b(electric ireland|esb|bord gais|bord gáis|energia|sse airtricity|flogas|pinergy)\b/i, merchant: "Electric Ireland", accountCode: "6100", vatCategory: "SECOND_REDUCED", confidence: 92, note: "Electricity/gas is 9% VAT in Ireland" },
  // Telecoms
  { pattern: /\b(vodafone|three ireland|eir\b|virgin media|sky ireland|blacknight|magnet)\b/i, merchant: "Telecoms", accountCode: "6200", vatCategory: "STANDARD", confidence: 90 },
  // Software & SaaS
  { pattern: /\b(aws|amazon web services|google cloud|gsuite|google workspace|microsoft|msft|adobe|slack|zoom|dropbox|github|atlassian|shopify|stripe fee|xero|canva|mailchimp|hubspot|notion|figma|openai|anthropic)\b/i, merchant: "Software", accountCode: "6300", vatCategory: "STANDARD", confidence: 85, note: "EU/overseas SaaS may involve reverse-charge VAT — review if supplier is outside Ireland" },
  // Fuel & motor
  { pattern: /\b(applegreen|circle k|maxol|topaz|texaco|emo|amber|inver)\b/i, merchant: "Fuel", accountCode: "6500", vatCategory: "STANDARD", confidence: 88, note: "VAT on petrol is generally not reclaimable; diesel is — confirm fuel type" },
  { pattern: /\b(motor tax|ncts|nct\b|applus)\b/i, merchant: "Motor admin", accountCode: "6500", vatCategory: "EXEMPT", confidence: 85 },
  // Travel — public transport zero/exempt
  { pattern: /\b(irish rail|iarnrod|dublin bus|bus eireann|luas|leap card|aircoach|citylink|go[- ]?ahead)\b/i, merchant: "Public transport", accountCode: "6510", vatCategory: "EXEMPT", confidence: 88, note: "Passenger transport is VAT-exempt in Ireland" },
  { pattern: /\b(ryanair|aer lingus|aerlingus)\b/i, merchant: "Flights", accountCode: "6510", vatCategory: "ZERO", confidence: 85 },
  { pattern: /\b(freenow|free now|uber|bolt\b|lynk)\b/i, merchant: "Taxis", accountCode: "6510", vatCategory: "EXEMPT", confidence: 82 },
  // Insurance — exempt
  { pattern: /\b(axa|aviva|fbd|zurich|allianz|laya|vhi|irish life|liberty insurance|axa insurance)\b/i, merchant: "Insurance", accountCode: "6020", vatCategory: "EXEMPT", confidence: 88, note: "Insurance is VAT-exempt" },
  // Office & stationery
  { pattern: /\b(easons|eason|viking|office ?works|codex|paperclip)\b/i, merchant: "Stationery", accountCode: "6600", vatCategory: "STANDARD", confidence: 82 },
  { pattern: /\b(ikea|woodies|b&q|screwfix|chadwicks|heiton|grafton)\b/i, merchant: "Hardware/office fit-out", accountCode: "6700", vatCategory: "STANDARD", confidence: 70, note: "Could be repairs or a fixed asset if large — review amount" },
  // Marketing
  { pattern: /\b(facebook|facebk|meta ads|google ads|adwords|linkedin|twitter|tiktok|indeed)\b/i, merchant: "Online advertising", accountCode: "6400", vatCategory: "STANDARD", confidence: 85, note: "EU-supplied ad services are usually reverse-charge — check the invoice" },
  // Bank charges
  { pattern: /\b(fees?\b.*(quarterly|maintain)|bank charges|maintenance fee|account fee|stamp duty|govt duty|government duty)\b/i, merchant: "Bank charges", accountCode: "6900", vatCategory: "EXEMPT", confidence: 90 },
  { pattern: /\b(sepa (dd|debit) charge|transaction fees)\b/i, merchant: "Bank charges", accountCode: "6900", vatCategory: "EXEMPT", confidence: 85 },
  // Payroll & Revenue
  { pattern: /\b(payroll|salaries|salary|wages|net pay)\b/i, merchant: "Payroll", accountCode: "7000", vatCategory: "EXEMPT", confidence: 80 },
  { pattern: /\b(revenue.*(paye|prsi)|paye\/prsi|ros\b.*paye|p30)\b/i, merchant: "Revenue — PAYE/PRSI", accountCode: "2200", vatCategory: "EXEMPT", confidence: 88, note: "Payment of a payroll-tax liability, not an expense" },
  // Accountancy & legal
  { pattern: /\b(accountants?|accounting|audit|solicitors?|legal fees|law\b)\b/i, merchant: "Professional fees", accountCode: "6800", vatCategory: "STANDARD", confidence: 75 },
  // Rent — usually exempt unless landlord opted to tax
  { pattern: /\b(rent\b|lease payment|property mgmt|estates)\b/i, merchant: "Rent", accountCode: "6000", vatCategory: "EXEMPT", confidence: 72, note: "Commercial rent is exempt unless the landlord has opted to tax — check the lease" },
  // Rates
  { pattern: /\b(county council|city council|commercial rates|rates\b)\b/i, merchant: "Commercial rates", accountCode: "6010", vatCategory: "EXEMPT", confidence: 85 },
  // Cleaning — 13.5%
  { pattern: /\b(cleaning|cleaners|hygiene)\b/i, merchant: "Cleaning", accountCode: "7200", vatCategory: "REDUCED", confidence: 78, note: "Cleaning services are 13.5% VAT" },
  // Couriers / postage
  { pattern: /\b(an post|dpd|fastway|gls|ups|fedex|dhl)\b/i, merchant: "Postage & couriers", accountCode: "6600", vatCategory: "STANDARD", confidence: 80, note: "An Post universal postal services are exempt; courier services are 23%" },
  // Subsistence / meals (9% from 1 July 2026)
  { pattern: /\b(costa|starbucks|insomnia|butlers|mcdonalds|supermacs|subway|centra|spar|deli|cafe|café|restaurant)\b/i, merchant: "Meals & subsistence", accountCode: "6510", vatCategory: "SECOND_REDUCED", confidence: 68, note: "VAT on food/drink is generally not reclaimable — often better treated as subsistence with no VAT claim" },
];

export function matchMerchant(description: string): MerchantPattern | null {
  for (const p of IRISH_MERCHANT_PATTERNS) {
    if (p.pattern.test(description)) return p;
  }
  return null;
}

/** Normalise a bank description for memory lookups: strip dates, card refs, amounts. */
export function normaliseDescription(description: string): string {
  return description
    .toUpperCase()
    .replace(/\b\d{2}[/.-]\d{2}([/.-]\d{2,4})?\b/g, "") // dates
    .replace(/\b(POS|VDP|VDC|DD|SO|ATM|POC|CT|MOBI|IE\d+|REF[.:]?\s*\S+)\b/g, "") // bank codes
    .replace(/\*\d+/g, "")
    .replace(/\d{4,}/g, "") // long numbers
    .replace(/\s+/g, " ")
    .trim();
}
