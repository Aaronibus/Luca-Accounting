# Lúca — AI-native accounting for Irish business

Lúca is a production-grade accounting platform built for Ireland: proper double-entry
underneath, an AI accountant on top. It is designed around one idea — **AI should remove
accounting complexity, not add a chatbot** — and one rule:

> Correct accounting > automation > convenience > visual polish.

Named for Luca Pacioli, the father of double-entry bookkeeping.

## Quick start

```bash
npm install
npm run db:push      # create the SQLite schema
npm run db:seed      # optional: create the demo login + demo company
npm run dev          # http://localhost:3000
```

**Start clean:** go to `/signup`, create an account, and you land on a welcome screen offering
*Create a company* (a genuinely blank accounting file) or *Open demo company* (isolated, clearly
labelled sample data). New companies never inherit demo data.

**Or use the seeded demo** (password `demo1234`):

| User | Role |
|---|---|
| aaron@caracoffee.ie | Owner of the DEMO company |
| maire@kellyaccountants.ie | Accountant on the DEMO company |

Run the test suite (44 tests covering the engine, VAT, AI, extraction and multi-company isolation):

```bash
npm test
```

Optional: set `ANTHROPIC_API_KEY` in `.env` to enable the LLM tier (natural-language
rephrasing of grounded answers + refinement of weak document-extraction fields). Everything
works without it — the intelligence tiers below are deterministic-first by design.

## What's inside

**Core accounting engine** (`src/lib/engine/`)
- `journal.ts` — the single posting path. Enforces: ≥2 lines, exactly one positive side per
  line (integer cents only), debits = credits, no posting into locked periods, accounts must
  belong to the company. Posted journals are immutable; corrections are reversal journals.
- `posting.ts` — documents → journals: invoices (DR debtors / CR income + VAT), bills,
  payments with allocations, expenses (incl. paid-personally → directors' loan), bank
  categorisation, transfers, void-via-reversal.
- `reports.ts` — trial balance, P&L, balance sheet, aged debtors/creditors, account activity
  with running balances. Every figure is computed from journal lines and drills back to them.
- `vat.ts` — Irish VAT3 preparation (T1/T2/T3/T4 + E1/E2/ES1/ES2/PA1 boxes) computed from the
  VAT control account, exception checks (draft documents in period, manual VAT postings,
  unexplained bank items), finalisation that transfers VAT control → VAT payable and locks the
  period. Bi-monthly periods, due the 23rd via ROS.
- `setup.ts` — Irish chart of accounts + **date-effective VAT rates** (23% standard, 13.5%
  reduced, 9% second reduced — including catering/takeaway/hairdressing from 1 July 2026 per
  Budget 2026 — 4.8% livestock, 0%, exempt). Legislation changes are configuration, not code.

**The AI accountant** (`src/lib/ai/`) — deterministic-first, five tiers in strict precedence:
1. **RULE** — user-defined bank rules (96% confidence)
2. **MATCH** — open invoices/bills matched by exact amount ± reference/name overlap,
   including two-invoice combination payments
3. **TRANSFER** — equal-and-opposite detection across accounts within 3 days
4. **MEMORY** — learned from how this company categorised the same merchant before
5. **HEURISTIC** — Irish merchant knowledge base (ESB→Light & Heat @9%, insurance→exempt,
   passenger transport→exempt, etc.)

Every suggestion carries an explanation, evidence links and a confidence score, and lands in
the review inbox: **Suggested → Approved → Posted**, with a full audit trail. "Reconcile
everything you can" auto-applies only ≥92% confidence rule/match tiers and reports what it
did and what it skipped. AI never silently posts.

Also: anomaly detection (duplicate bills/expenses — worse when supplier refs match, statistical
outliers per account, missing recurring payments, suspense balances, unclaimed-VAT checks),
plain-English reconciliation explanations with the exact unmatched transactions, an accounting
health score, and document intelligence (PDF text extraction with arithmetic cross-checking —
net + VAT must equal gross — that drafts bills/expenses for approval, never posts them).

**Copilot** — available on every page, context-aware, answers only from computed ledger data:
"Why is my profit down?", "Why has my VAT increased?", "Who owes me money?", "What's preventing
reconciliation?" — plus commands: "Categorise this week's transactions", "Reconcile everything
you can", "Prepare the VAT return for my review", "Find anything that looks wrong."

**Multi-company SaaS** — organisations → companies → memberships with roles (owner, admin,
accountant, bookkeeper, employee, viewer) mapped to capabilities enforced in `requireCompany()`
and re-checked in the engine (cross-tenant account references are rejected at posting time).

Create as many companies as you like from one account:

- **Blank by default.** `createCompany()` provisions *configuration only* — Irish chart of
  accounts, VAT rates, numbering sequences. It writes no contacts, documents, bank accounts or
  journals. The principle is: configuration exists, data does not.
- **Three-step wizard** — company details → accounting setup (year end, currency, VAT
  registration/basis/period) → chart of accounts, then straight into the workspace.
- **Demo data is isolated.** The sample dataset lives in exactly one module
  (`src/lib/demo/sample-data.ts`) and is applied only by `createDemoCompany()`, which puts it in
  its own organisation and flags the company `isDemo` — shown as a **DEMO** badge in the switcher
  and a banner across the app.
- **Company switcher** with search, role and city, current-company check, inline archive, and
  links to create a company / settings / users.
- **Empty-state onboarding** instead of meaningless zeros: a five-step checklist on the dashboard,
  and honest empty states on banking, sales, purchases, VAT, P&L, trial balance and balance sheet.
- **Opening balances** are explicit — entered by the user, posted as a single balanced
  `OPENING_BALANCE` journal, with an opt-in retained-earnings plug for partial trial balances.
  Nothing is ever invented.
- **Isolation is enforced in three places**: `requireCompany()` re-validates the active-company
  cookie against memberships on every request (a forged cookie grants nothing); every query is
  filtered by `companyId`; and `postJournal()` rejects any account that doesn't belong to the
  company. The AI is company-scoped throughout — suggestions, anomalies, insights and the copilot
  all take `companyId` and can only read that company's ledger.

## Architecture

```
src/
  app/            Next.js App Router: server components read, server actions mutate
    (app)/        authenticated workspace (dashboard, banking, sales, purchases,
                  expenses, vat, reports, ledger, documents, settings, inbox)
    api/          auth, copilot, CSV export
    actions.ts    every mutation: auth → role check → engine call → audit
  db/             Drizzle ORM schema (SQLite dev; schema is Postgres-portable) +
                  the CLI demo seeder
  lib/
    engine/       the accounting engine (pure, synchronous, transaction-wrapped)
    services/     companies (create blank / demo, emptiness, opening balances,
                  bank accounts, archive), documents (draft creation + VAT maths),
                  banking (CSV import, duplicate detection, reconciliation maths)
    demo/         the ONLY sample dataset, applied to demo companies alone
    ai/           categorise, suggestions, anomalies, insights, copilot, extract, llm
    auth.ts       JWT session cookies, tenancy boundary, capability checks
tests/            vitest: engine invariants, VAT boxes, isolation, AI tiers, extraction
```

Key decisions:
- **Integer cents everywhere.** No floats in money paths; VAT rates are basis points.
- **The journal is the only source of truth.** Reports never read document tables for figures.
- **Reversals, never edits.** `REVERSED` journals stay in the ledger; their reversal cancels them.
- **Period locks** are enforced in one place (the posting engine) and created by VAT
  finalisation and year-end closes.
- **AI proposals are data**, applied only through the same engine paths as manual entry.

## Testing

`npm test` runs 44 tests: journal balancing/rejection cases, reversal immutability, period
locks, invoice/bill/payment lifecycles incl. overpayment rejection, credit notes, expenses to
directors' loan, bank import duplicate detection, transfer matching, VAT box computation and
finalisation locking, P&L/balance-sheet/TB agreement, tenancy isolation, all five AI tiers,
anomaly detection, reconciliation explanations and document extraction arithmetic.

`tests/multi-company.test.ts` is the multi-company acceptance suite. Its first case walks the full
14-step scenario end to end: create a user → create Company A → assert it holds **zero** journals,
invoices, bills, expenses, contacts, bank accounts, transactions, payments, VAT returns, documents
and suggestions (while holding a full chart of accounts, six VAT rates and numbering sequences) →
post invoices, a bill and a bank feed in A → create Company B → assert B is completely empty and
shares no record ids with A → confirm A's data survives → confirm none of A's data, reports, VAT
or anomalies appear in B → confirm cross-tenant posting is rejected by the engine → ask the copilot
inside B and assert no Company A customer, supplier, document number or figure appears in the answer,
while the same question in A does surface A's data → create Company C and confirm independence.
Further cases cover demo isolation, per-user scoping, archive/restore, opening balances and
per-company bank accounts.

## Production notes

- Swap SQLite → Postgres by porting `src/db/schema.ts` to `drizzle-orm/pg-core` (types were
  chosen to map 1:1) and moving the engine's synchronous calls to async.
- Set a strong `AUTH_SECRET`; put the app behind HTTPS; move rate limiting to a shared store.
- Bank feeds: `importBankTransactions` is the single entry point — an open-banking provider
  (e.g. Plaid/GoCardless/Tink) drops into the same path as CSV.
- Payroll: the schema and engine support it as a first-class module (wages journals are in the
  seed); Revenue payroll submission would live beside the VAT engine.
- Revenue filing: VAT3 boxes are computed and stored — a ROS integration would serialise them.
```
