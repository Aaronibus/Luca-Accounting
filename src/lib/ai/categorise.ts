// Transaction intelligence — the suggestion pipeline for bank transactions.
// Tiers (highest precedence first):
//   1. RULE     — user-defined bank rules (deterministic, user-owned)
//   2. MATCH    — open invoices/bills or payments with matching amounts (evidence-based)
//   3. TRANSFER — equal-and-opposite transaction in another account
//   4. MEMORY   — how this merchant was categorised before (learned from history)
//   5. HEURISTIC— Irish merchant knowledge base
// Every suggestion carries an explanation + evidence and lands in the review
// queue: Suggested → Accepted (posts via the engine) → full audit trail.
// Nothing posts without a human unless the user runs "reconcile everything you
// can", which only auto-accepts high-confidence rule/match tiers and reports back.

import { db, tables } from "@/db";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { matchMerchant, normaliseDescription } from "./merchants";
import { vatFromGross, fmtEUR } from "@/lib/money";

export interface CategorisationProposal {
  action: "CATEGORISE";
  accountId: string;
  accountName: string;
  vatRateId?: string;
  vatCents: number;
  contactId?: string;
  contactName?: string;
}
export interface MatchProposal {
  action: "MATCH";
  allocations: Array<{ invoiceId?: string; billId?: string; amountCents: number; number: string }>;
  contactId?: string;
  contactName?: string;
}
export interface TransferProposal {
  action: "TRANSFER";
  outTransactionId: string;
  inTransactionId: string;
  otherAccountName: string;
}
export type Proposal = CategorisationProposal | MatchProposal | TransferProposal;

export interface GeneratedSuggestion {
  kind: "CATEGORISATION" | "MATCH" | "TRANSFER";
  bankTransactionId: string;
  payload: Proposal;
  explanation: string;
  confidence: number;
  source: "RULE" | "MEMORY" | "HEURISTIC" | "MATCH";
  evidence: Array<{ label: string; href: string }>;
}

interface TxnRow {
  id: string;
  bankAccountId: string;
  date: Date;
  description: string;
  amountCents: number;
}

/** Generate (and persist) suggestions for all unreconciled transactions of a company. */
export function generateBankSuggestions(companyId: string): { created: number } {
  const txns = db
    .select({
      id: tables.bankTransactions.id,
      bankAccountId: tables.bankTransactions.bankAccountId,
      date: tables.bankTransactions.date,
      description: tables.bankTransactions.description,
      amountCents: tables.bankTransactions.amountCents,
    })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(and(eq(tables.bankAccounts.companyId, companyId), eq(tables.bankTransactions.status, "UNRECONCILED")))
    .all();

  let created = 0;
  const pairedTransfers = new Set<string>();

  for (const txn of txns) {
    const t: TxnRow = { ...txn, date: new Date(txn.date) };
    // skip if a live suggestion already exists for this transaction
    const existing = db
      .select({ id: tables.suggestions.id })
      .from(tables.suggestions)
      .where(
        and(
          eq(tables.suggestions.companyId, companyId),
          eq(tables.suggestions.bankTransactionId, t.id),
          eq(tables.suggestions.status, "SUGGESTED")
        )
      )
      .get();
    if (existing) continue;
    if (pairedTransfers.has(t.id)) continue;

    const suggestion =
      applyRules(companyId, t) ??
      findDocumentMatch(companyId, t) ??
      findTransfer(companyId, t, txns as never, pairedTransfers) ??
      applyMemory(companyId, t) ??
      applyHeuristics(companyId, t);

    if (suggestion) {
      db.insert(tables.suggestions)
        .values({
          companyId,
          kind: suggestion.kind,
          entityType: "bank_transaction",
          entityId: t.id,
          bankTransactionId: t.id,
          payload: JSON.stringify(suggestion.payload),
          explanation: suggestion.explanation,
          confidence: suggestion.confidence,
          evidence: JSON.stringify(suggestion.evidence),
          source: suggestion.source === "MATCH" ? "HEURISTIC" : suggestion.source,
          status: "SUGGESTED",
        })
        .run();
      created++;
    }
  }
  return { created };
}

// ── Tier 1: user bank rules ──────────────────────────────────────────────

function applyRules(companyId: string, t: TxnRow): GeneratedSuggestion | null {
  const rules = db
    .select()
    .from(tables.bankRules)
    .where(and(eq(tables.bankRules.companyId, companyId), eq(tables.bankRules.enabled, true)))
    .orderBy(tables.bankRules.priority)
    .all();

  for (const rule of rules) {
    if (rule.direction === "IN" && t.amountCents < 0) continue;
    if (rule.direction === "OUT" && t.amountCents > 0) continue;
    const abs = Math.abs(t.amountCents);
    if (rule.minAmountCents != null && abs < rule.minAmountCents) continue;
    if (rule.maxAmountCents != null && abs > rule.maxAmountCents) continue;

    let hit = false;
    const desc = t.description.toLowerCase();
    const needle = rule.matchText.toLowerCase();
    if (rule.matchMode === "CONTAINS") hit = desc.includes(needle);
    else if (rule.matchMode === "STARTS_WITH") hit = desc.startsWith(needle);
    else if (rule.matchMode === "REGEX") {
      try { hit = new RegExp(rule.matchText, "i").test(t.description); } catch { hit = false; }
    }
    if (!hit || !rule.setAccountId) continue;

    const account = db.select().from(tables.accounts).where(eq(tables.accounts.id, rule.setAccountId)).get();
    if (!account) continue;
    const contact = rule.setContactId
      ? db.select().from(tables.contacts).where(eq(tables.contacts.id, rule.setContactId)).get()
      : undefined;
    const vat = resolveVat(companyId, rule.setVatRateId ?? account.defaultVatRateId, Math.abs(t.amountCents));

    return {
      kind: "CATEGORISATION",
      bankTransactionId: t.id,
      payload: {
        action: "CATEGORISE",
        accountId: account.id,
        accountName: `${account.code} ${account.name}`,
        vatRateId: vat?.rateId,
        vatCents: vat?.vatCents ?? 0,
        contactId: contact?.id,
        contactName: contact?.name,
      },
      explanation: `Matches your rule “${rule.name}” — categorise to ${account.name}${vat && vat.vatCents > 0 ? ` with ${fmtEUR(vat.vatCents)} VAT` : ""}.`,
      confidence: 96,
      source: "RULE",
      evidence: [{ label: `Rule: ${rule.name}`, href: `/banking/rules` }],
    };
  }
  return null;
}

// ── Tier 2: open invoice/bill matching ───────────────────────────────────

function findDocumentMatch(companyId: string, t: TxnRow): GeneratedSuggestion | null {
  const windowDays = 45;
  const from = new Date(t.date.getTime() - windowDays * 86_400_000);
  const to = new Date(t.date.getTime() + windowDays * 86_400_000);

  if (t.amountCents > 0) {
    // Money in → open invoices
    const candidates = db
      .select({
        id: tables.invoices.id, number: tables.invoices.number, totalCents: tables.invoices.totalCents,
        paidCents: tables.invoices.paidCents, contactId: tables.invoices.contactId,
        contactName: tables.contacts.name, date: tables.invoices.date,
      })
      .from(tables.invoices)
      .innerJoin(tables.contacts, eq(tables.invoices.contactId, tables.contacts.id))
      .where(
        and(
          eq(tables.invoices.companyId, companyId),
          inArray(tables.invoices.status, ["APPROVED", "SENT"]),
          eq(tables.invoices.kind, "INVOICE"),
          gte(tables.invoices.date, from),
          lte(tables.invoices.date, to)
        )
      )
      .all();

    // exact single match on outstanding amount
    const exact = candidates.filter((c) => c.totalCents - c.paidCents === t.amountCents);
    if (exact.length === 1) {
      const c = exact[0];
      const nameInDesc = surnameOverlap(t.description, c.contactName);
      return {
        kind: "MATCH",
        bankTransactionId: t.id,
        payload: {
          action: "MATCH",
          allocations: [{ invoiceId: c.id, amountCents: t.amountCents, number: c.number }],
          contactId: c.contactId,
          contactName: c.contactName,
        },
        explanation: `${fmtEUR(t.amountCents)} received matches the amount due on invoice ${c.number} for ${c.contactName}${nameInDesc ? " — and the bank narrative mentions them" : ""}.`,
        confidence: nameInDesc ? 95 : 84,
        source: "MATCH",
        evidence: [{ label: `Invoice ${c.number} — ${fmtEUR(c.totalCents - c.paidCents)} due`, href: `/sales/invoices/${c.id}` }],
      };
    }
    // combination of 2 invoices from the same customer
    const byContact = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const arr = byContact.get(c.contactId) ?? [];
      arr.push(c);
      byContact.set(c.contactId, arr);
    }
    for (const [, docs] of byContact) {
      if (docs.length < 2) continue;
      for (let i = 0; i < docs.length; i++) {
        for (let j = i + 1; j < docs.length; j++) {
          const a = docs[i], b = docs[j];
          if (a.totalCents - a.paidCents + (b.totalCents - b.paidCents) === t.amountCents) {
            return {
              kind: "MATCH",
              bankTransactionId: t.id,
              payload: {
                action: "MATCH",
                allocations: [
                  { invoiceId: a.id, amountCents: a.totalCents - a.paidCents, number: a.number },
                  { invoiceId: b.id, amountCents: b.totalCents - b.paidCents, number: b.number },
                ],
                contactId: a.contactId,
                contactName: a.contactName,
              },
              explanation: `${fmtEUR(t.amountCents)} received equals invoices ${a.number} + ${b.number} for ${a.contactName} paid together.`,
              confidence: 82,
              source: "MATCH",
              evidence: [
                { label: `Invoice ${a.number}`, href: `/sales/invoices/${a.id}` },
                { label: `Invoice ${b.number}`, href: `/sales/invoices/${b.id}` },
              ],
            };
          }
        }
      }
    }
  } else {
    // Money out → open bills
    const abs = Math.abs(t.amountCents);
    const candidates = db
      .select({
        id: tables.bills.id, number: tables.bills.number, totalCents: tables.bills.totalCents,
        paidCents: tables.bills.paidCents, contactId: tables.bills.contactId,
        contactName: tables.contacts.name,
      })
      .from(tables.bills)
      .innerJoin(tables.contacts, eq(tables.bills.contactId, tables.contacts.id))
      .where(
        and(
          eq(tables.bills.companyId, companyId),
          eq(tables.bills.status, "APPROVED"),
          eq(tables.bills.kind, "BILL"),
          gte(tables.bills.date, from),
          lte(tables.bills.date, to)
        )
      )
      .all();
    const exact = candidates.filter((c) => c.totalCents - c.paidCents === abs);
    if (exact.length === 1) {
      const c = exact[0];
      const nameInDesc = surnameOverlap(t.description, c.contactName);
      return {
        kind: "MATCH",
        bankTransactionId: t.id,
        payload: {
          action: "MATCH",
          allocations: [{ billId: c.id, amountCents: abs, number: c.number }],
          contactId: c.contactId,
          contactName: c.contactName,
        },
        explanation: `${fmtEUR(abs)} paid matches the amount due on bill ${c.number} from ${c.contactName}${nameInDesc ? " — the narrative mentions them too" : ""}.`,
        confidence: nameInDesc ? 95 : 84,
        source: "MATCH",
        evidence: [{ label: `Bill ${c.number} — ${fmtEUR(c.totalCents - c.paidCents)} due`, href: `/purchases/bills/${c.id}` }],
      };
    }
  }
  return null;
}

// ── Tier 3: transfer detection ───────────────────────────────────────────

function findTransfer(
  companyId: string,
  t: TxnRow,
  all: TxnRow[],
  paired: Set<string>
): GeneratedSuggestion | null {
  if (t.amountCents >= 0) return null; // suggest from the OUT side to avoid double suggestions
  const counterpart = all.find(
    (o) =>
      o.id !== t.id &&
      !paired.has(o.id) &&
      o.bankAccountId !== t.bankAccountId &&
      o.amountCents === -t.amountCents &&
      Math.abs(new Date(o.date).getTime() - t.date.getTime()) <= 3 * 86_400_000
  );
  if (!counterpart) return null;
  const otherBank = db.select().from(tables.bankAccounts).where(eq(tables.bankAccounts.id, counterpart.bankAccountId)).get();
  paired.add(counterpart.id);
  paired.add(t.id);
  return {
    kind: "TRANSFER",
    bankTransactionId: t.id,
    payload: {
      action: "TRANSFER",
      outTransactionId: t.id,
      inTransactionId: counterpart.id,
      otherAccountName: otherBank?.name ?? "another account",
    },
    explanation: `${fmtEUR(Math.abs(t.amountCents))} out on ${t.date.toISOString().slice(0, 10)} has an equal and opposite lodgement in ${otherBank?.name ?? "another account"} within 3 days — this looks like an internal transfer, not income or spending.`,
    confidence: 90,
    source: "HEURISTIC",
    evidence: [{ label: `Matching lodgement in ${otherBank?.name ?? "other account"}`, href: `/banking/${counterpart.bankAccountId}` }],
  };
}

// ── Tier 4: merchant memory ──────────────────────────────────────────────

function applyMemory(companyId: string, t: TxnRow): GeneratedSuggestion | null {
  const norm = normaliseDescription(t.description);
  if (norm.length < 4) return null;

  // Find previously explained transactions with the same normalised narrative
  const history = db
    .select({
      id: tables.bankTransactions.id,
      description: tables.bankTransactions.description,
      journalId: tables.bankTransactions.journalId,
      contactId: tables.bankTransactions.contactId,
      amountCents: tables.bankTransactions.amountCents,
    })
    .from(tables.bankTransactions)
    .innerJoin(tables.bankAccounts, eq(tables.bankTransactions.bankAccountId, tables.bankAccounts.id))
    .where(
      and(
        eq(tables.bankAccounts.companyId, companyId),
        inArray(tables.bankTransactions.status, ["MATCHED", "RECONCILED"]),
        eq(tables.bankTransactions.matchType, "DIRECT"),
        ne(tables.bankTransactions.id, t.id)
      )
    )
    .all()
    .filter((h) => normaliseDescription(h.description) === norm);

  if (history.length === 0) return null;

  // What account did those journals hit? (take the non-bank line of the most recent)
  const past = history[history.length - 1];
  if (!past.journalId) return null;
  const lines = db
    .select({
      accountId: tables.journalLines.accountId,
      debitCents: tables.journalLines.debitCents,
      creditCents: tables.journalLines.creditCents,
      code: tables.accounts.code,
      name: tables.accounts.name,
      subtype: tables.accounts.subtype,
      vatRateId: tables.journalLines.vatRateId,
    })
    .from(tables.journalLines)
    .innerJoin(tables.accounts, eq(tables.journalLines.accountId, tables.accounts.id))
    .where(eq(tables.journalLines.journalId, past.journalId))
    .all();
  const target = lines.find((l) => l.subtype !== "BANK" && l.subtype !== "VAT");
  if (!target) return null;

  const vat = resolveVat(companyId, target.vatRateId, Math.abs(t.amountCents));
  const contact = past.contactId
    ? db.select().from(tables.contacts).where(eq(tables.contacts.id, past.contactId)).get()
    : undefined;

  const times = history.length;
  return {
    kind: "CATEGORISATION",
    bankTransactionId: t.id,
    payload: {
      action: "CATEGORISE",
      accountId: target.accountId,
      accountName: `${target.code} ${target.name}`,
      vatRateId: vat?.rateId,
      vatCents: vat?.vatCents ?? 0,
      contactId: contact?.id,
      contactName: contact?.name,
    },
    explanation: `You've categorised “${norm}” to ${target.name} ${times === 1 ? "before" : `${times} times before`} — same treatment suggested${vat && vat.vatCents > 0 ? `, including ${fmtEUR(vat.vatCents)} VAT` : ""}.`,
    confidence: Math.min(94, 80 + times * 3),
    source: "MEMORY",
    evidence: [{ label: `Previous example (${fmtEUR(past.amountCents)})`, href: `/ledger/journals/${past.journalId}` }],
  };
}

// ── Tier 5: Irish merchant heuristics ────────────────────────────────────

function applyHeuristics(companyId: string, t: TxnRow): GeneratedSuggestion | null {
  const m = matchMerchant(t.description);
  if (!m) return null;
  if (t.amountCents > 0) return null; // heuristic KB is spend-side

  const account = db
    .select()
    .from(tables.accounts)
    .where(and(eq(tables.accounts.companyId, companyId), eq(tables.accounts.code, m.accountCode)))
    .get();
  if (!account) return null;

  const rate = db
    .select()
    .from(tables.vatRates)
    .where(and(eq(tables.vatRates.companyId, companyId), eq(tables.vatRates.category, m.vatCategory)))
    .get();
  const gross = Math.abs(t.amountCents);
  const vatCents = rate && rate.rateBps > 0 && m.vatCategory !== "EXEMPT" ? vatFromGross(gross, rate.rateBps).vatCents : 0;

  return {
    kind: "CATEGORISATION",
    bankTransactionId: t.id,
    payload: {
      action: "CATEGORISE",
      accountId: account.id,
      accountName: `${account.code} ${account.name}`,
      vatRateId: rate?.id,
      vatCents,
      contactName: m.merchant,
    },
    explanation: `“${t.description.trim()}” looks like ${m.merchant.toLowerCase()} — suggested ${account.name}${vatCents > 0 ? ` with ${fmtEUR(vatCents)} VAT (${m.vatCategory === "SECOND_REDUCED" ? "9%" : m.vatCategory === "REDUCED" ? "13.5%" : "23%"})` : " (no VAT to reclaim)"}.${m.note ? ` ${m.note}.` : ""}`,
    confidence: m.confidence - 10,
    source: "HEURISTIC",
    evidence: [{ label: `Account ${account.code} — ${account.name}`, href: `/ledger/accounts/${account.id}` }],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

function resolveVat(companyId: string, rateId: string | null | undefined, grossCents: number) {
  if (!rateId) return null;
  const rate = db
    .select()
    .from(tables.vatRates)
    .where(and(eq(tables.vatRates.id, rateId), eq(tables.vatRates.companyId, companyId)))
    .get();
  if (!rate) return null;
  if (rate.rateBps === 0 || rate.category === "EXEMPT" || rate.category === "OUTSIDE_SCOPE") {
    return { rateId: rate.id, vatCents: 0 };
  }
  return { rateId: rate.id, vatCents: vatFromGross(grossCents, rate.rateBps).vatCents };
}

function surnameOverlap(description: string, contactName: string): boolean {
  const words = contactName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["ltd", "limited", "the"].includes(w));
  const desc = description.toLowerCase();
  return words.some((w) => desc.includes(w));
}
