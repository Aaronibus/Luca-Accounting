// Document intelligence — turn invoice/receipt text into structured fields.
// Pipeline: PDF text layer (pdf-parse) or raw text → deterministic field
// extraction (with arithmetic cross-checks) → optional LLM refinement when
// configured → draft bill/expense for human approval. Extraction never posts
// anything; it creates drafts.

import { db, tables } from "@/db";
import { and, eq, like } from "drizzle-orm";
import { matchMerchant } from "./merchants";
import { getLlm, llmConfigured } from "./llm";

export interface ExtractedField<T> {
  value: T | null;
  confidence: number; // 0-100
  evidence?: string; // the text snippet it came from
}

export interface ExtractedInvoice {
  supplierName: ExtractedField<string>;
  invoiceNumber: ExtractedField<string>;
  date: ExtractedField<string>; // ISO
  dueDate: ExtractedField<string>;
  netCents: ExtractedField<number>;
  vatCents: ExtractedField<number>;
  grossCents: ExtractedField<number>;
  vatRateBps: ExtractedField<number>;
  description: ExtractedField<string>;
  suggestedAccountCode: ExtractedField<string>;
  arithmeticOk: boolean;
  source: "DETERMINISTIC" | "LLM_ASSISTED";
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

const AMOUNT = /(?:€|EUR\s?)?\s?([\d.,]+\.\d{2})\b/;

function toCents(raw: string): number | null {
  const cleaned = raw.replace(/[€,\s]/g, "");
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}

function findAmount(lines: string[], keywords: string[]): { cents: number; line: string } | null {
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (keywords.some((k) => lower.includes(k))) {
      const m = line.match(AMOUNT);
      if (m) {
        const cents = toCents(m[1]);
        if (cents != null) return { cents, line: line.trim() };
      }
    }
  }
  return null;
}

function findDate(text: string, keywords: string[]): { iso: string; evidence: string } | null {
  const lines = text.split("\n");
  const patterns: Array<{ re: RegExp; parse: (m: RegExpMatchArray) => string | null }> = [
    { re: /(\d{4})-(\d{2})-(\d{2})/, parse: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/, parse: (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` },
    {
      re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
      parse: (m) => {
        const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const mo = months.indexOf(m[2].toLowerCase().slice(0, 3)) + 1;
        return mo ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
      },
    },
  ];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!keywords.some((k) => lower.includes(k))) continue;
    for (const p of patterns) {
      const m = line.match(p.re);
      if (m) {
        const iso = p.parse(m);
        if (iso) return { iso, evidence: line.trim() };
      }
    }
  }
  // fallback: first date anywhere
  if (keywords.includes("*")) {
    for (const p of patterns) {
      const m = text.match(p.re);
      if (m) {
        const iso = p.parse(m);
        if (iso) return { iso, evidence: m[0] };
      }
    }
  }
  return null;
}

/** Deterministic extraction with arithmetic cross-checks. */
export function extractInvoiceFields(text: string): ExtractedInvoice {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const empty = <T,>(): ExtractedField<T> => ({ value: null, confidence: 0 });

  const result: ExtractedInvoice = {
    supplierName: empty(),
    invoiceNumber: empty(),
    date: empty(),
    dueDate: empty(),
    netCents: empty(),
    vatCents: empty(),
    grossCents: empty(),
    vatRateBps: empty(),
    description: empty(),
    suggestedAccountCode: empty(),
    arithmeticOk: false,
    source: "DETERMINISTIC",
  };

  // Supplier: first non-numeric prominent line
  const supplierLine = lines.find(
    (l) => l.trim().length > 2 && !/invoice|receipt|statement|vat|date|total/i.test(l) && !/\d{3,}/.test(l)
  );
  if (supplierLine) {
    result.supplierName = { value: supplierLine.trim(), confidence: 60, evidence: supplierLine.trim() };
  }

  // Invoice number — labelled first, else any invoice-adjacent token containing a digit
  const invNo =
    text.match(/invoice\s*(?:no|number|#|num)[.:\s]*([A-Z0-9][A-Z0-9\-\/]{2,20})/i) ??
    text.match(/invoice[.:\s#]*((?=[A-Z0-9\-\/]*\d)[A-Z0-9\-\/]{3,20})/i);
  if (invNo) result.invoiceNumber = { value: invNo[1], confidence: 85, evidence: invNo[0].trim() };

  // Dates
  const date = findDate(text, ["invoice date", "date", "*"]);
  if (date) result.date = { value: date.iso, confidence: 75, evidence: date.evidence };
  const due = findDate(text, ["due", "payment date", "pay by"]);
  if (due) result.dueDate = { value: due.iso, confidence: 70, evidence: due.evidence };

  // Amounts
  const gross =
    findAmount(lines, ["total due", "amount due", "grand total", "total incl", "total (incl", "balance due"]) ??
    findAmount(lines, ["total"]);
  const net = findAmount(lines, ["subtotal", "sub-total", "net", "total excl", "total (excl"]);
  const vat = findAmount(lines, ["vat", "tax"]);

  if (gross) result.grossCents = { value: gross.cents, confidence: 80, evidence: gross.line };
  if (net) result.netCents = { value: net.cents, confidence: 75, evidence: net.line };
  if (vat) result.vatCents = { value: vat.cents, confidence: 75, evidence: vat.line };

  // Arithmetic reconciliation — the strongest signal we have
  if (net && vat && gross) {
    result.arithmeticOk = net.cents + vat.cents === gross.cents;
    if (result.arithmeticOk) {
      result.netCents.confidence = 95;
      result.vatCents.confidence = 95;
      result.grossCents.confidence = 95;
    }
  } else if (gross && vat && !net) {
    result.netCents = { value: gross.cents - vat.cents, confidence: 85, evidence: "derived: gross − VAT" };
    result.arithmeticOk = true;
  } else if (gross && net && !vat) {
    result.vatCents = { value: gross.cents - net.cents, confidence: 85, evidence: "derived: gross − net" };
    result.arithmeticOk = gross.cents - net.cents >= 0;
  }

  // VAT rate: stated, or inferred from net/vat
  const rateMatch = text.match(/(\d{1,2}(?:\.\d)?)\s?%/);
  if (rateMatch) {
    const bps = Math.round(parseFloat(rateMatch[1]) * 100);
    if ([2300, 1350, 900, 480, 0].includes(bps)) {
      result.vatRateBps = { value: bps, confidence: 85, evidence: rateMatch[0] };
    }
  }
  if (result.vatRateBps.value == null && result.netCents.value && result.vatCents.value != null && result.netCents.value > 0) {
    const implied = Math.round((result.vatCents.value / result.netCents.value) * 10000);
    const candidates = [2300, 1350, 900, 480, 0];
    const nearest = candidates.reduce((best, c) => (Math.abs(c - implied) < Math.abs(best - implied) ? c : best), 2300);
    if (Math.abs(nearest - implied) <= 30) {
      result.vatRateBps = { value: nearest, confidence: 80, evidence: `implied ${(implied / 100).toFixed(1)}%` };
    }
  }

  // Description: line items area (between header and totals) — take the longest text line
  const descLine = lines
    .filter((l) => !/total|vat|subtotal|invoice|date|due|iban|bic/i.test(l) && /[a-zA-Z]{4,}/.test(l))
    .sort((a, b) => b.trim().length - a.trim().length)[0];
  if (descLine) result.description = { value: descLine.trim().slice(0, 120), confidence: 50, evidence: descLine.trim() };

  // Suggested account from the merchant KB
  const merchant = matchMerchant(text);
  if (merchant) {
    result.suggestedAccountCode = { value: merchant.accountCode, confidence: merchant.confidence - 15 };
  }

  return result;
}

/** Full extraction: deterministic + optional LLM refinement of weak fields. */
export async function extractInvoice(text: string): Promise<ExtractedInvoice> {
  const det = extractInvoiceFields(text);
  const weak = [det.supplierName, det.invoiceNumber, det.date, det.grossCents].filter((f) => f.confidence < 70);
  if (weak.length === 0 || !llmConfigured()) return det;

  const llm = getLlm();
  const response = await llm.complete({
    system:
      "You extract fields from invoice text. Respond ONLY with JSON: {supplierName, invoiceNumber, date (ISO), dueDate (ISO), netCents, vatCents, grossCents, vatRateBps, description}. Use null for anything not clearly present. Amounts in integer euro cents. Never guess amounts that are not in the text.",
    user: text.slice(0, 6000),
  });
  if (!response) return det;
  try {
    const jsonStart = response.indexOf("{");
    const parsed = JSON.parse(response.slice(jsonStart, response.lastIndexOf("}") + 1));
    const merge = <T,>(field: ExtractedField<T>, llmValue: T | null | undefined): ExtractedField<T> =>
      field.confidence >= 70 || llmValue == null ? field : { value: llmValue, confidence: 72, evidence: "LLM extraction" };
    const merged: ExtractedInvoice = {
      ...det,
      supplierName: merge(det.supplierName, parsed.supplierName),
      invoiceNumber: merge(det.invoiceNumber, parsed.invoiceNumber),
      date: merge(det.date, parsed.date),
      dueDate: merge(det.dueDate, parsed.dueDate),
      netCents: merge(det.netCents, parsed.netCents),
      vatCents: merge(det.vatCents, parsed.vatCents),
      grossCents: merge(det.grossCents, parsed.grossCents),
      description: merge(det.description, parsed.description),
      source: "LLM_ASSISTED",
    };
    // arithmetic must still hold after merging
    if (merged.netCents.value != null && merged.vatCents.value != null && merged.grossCents.value != null) {
      merged.arithmeticOk = merged.netCents.value + merged.vatCents.value === merged.grossCents.value;
    }
    return merged;
  } catch {
    return det;
  }
}

/** Find or create a supplier contact matching an extracted name. */
export function resolveSupplier(companyId: string, name: string): { id: string; created: boolean } {
  const trimmed = name.trim();
  const existing = db
    .select()
    .from(tables.contacts)
    .where(and(eq(tables.contacts.companyId, companyId), like(tables.contacts.name, `%${trimmed.split(" ")[0]}%`)))
    .all()
    .find((c) => c.name.toLowerCase() === trimmed.toLowerCase() || similar(c.name, trimmed));
  if (existing) return { id: existing.id, created: false };
  const created = db
    .insert(tables.contacts)
    .values({ companyId, type: "SUPPLIER", name: trimmed })
    .returning({ id: tables.contacts.id })
    .get();
  return { id: created.id, created: true };
}

function similar(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\b(ltd|limited|dac|plc)\b|[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/\b(ltd|limited|dac|plc)\b|[^a-z0-9]/g, "");
  return na.length > 3 && (na.includes(nb) || nb.includes(na));
}
