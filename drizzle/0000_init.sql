CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`subtype` text NOT NULL,
	`system_key` text,
	`description` text,
	`default_vat_rate_id` text,
	`is_control` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_company_code` ON `accounts` (`company_id`,`code`);--> statement-breakpoint
CREATE INDEX `accounts_company_type` ON `accounts` (`company_id`,`type`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`note` text,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_company_created` ON `audit_logs` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity` ON `audit_logs` (`company_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`iban_masked` text,
	`bank` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`opening_balance_cents` integer DEFAULT 0 NOT NULL,
	`opening_balance_date` integer,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_accounts_company` ON `bank_accounts` (`company_id`);--> statement-breakpoint
CREATE TABLE `bank_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`match_mode` text DEFAULT 'CONTAINS' NOT NULL,
	`match_text` text NOT NULL,
	`direction` text DEFAULT 'ANY' NOT NULL,
	`min_amount_cents` integer,
	`max_amount_cents` integer,
	`set_contact_id` text,
	`set_account_id` text,
	`set_vat_rate_id` text,
	`priority` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_rules_company` ON `bank_rules` (`company_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_account_id` text NOT NULL,
	`import_batch_id` text,
	`date` integer NOT NULL,
	`description` text NOT NULL,
	`reference` text,
	`amount_cents` integer NOT NULL,
	`balance_cents` integer,
	`status` text DEFAULT 'UNRECONCILED' NOT NULL,
	`match_type` text,
	`payment_id` text,
	`journal_id` text,
	`transfer_pair_id` text,
	`contact_id` text,
	`fingerprint` text NOT NULL,
	`reconciled_at` integer,
	`reconciled_by_id` text,
	`created_at` integer,
	FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bank_txn_account_status` ON `bank_transactions` (`bank_account_id`,`status`);--> statement-breakpoint
CREATE INDEX `bank_txn_account_date` ON `bank_transactions` (`bank_account_id`,`date`);--> statement-breakpoint
CREATE INDEX `bank_txn_fingerprint` ON `bank_transactions` (`bank_account_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `bill_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`account_id` text NOT NULL,
	`vat_rate_id` text NOT NULL,
	`net_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bill_lines_bill` ON `bill_lines` (`bill_id`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text DEFAULT 'BILL' NOT NULL,
	`number` text NOT NULL,
	`supplier_ref` text,
	`date` integer NOT NULL,
	`due_date` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`vat_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`journal_id` text,
	`void_journal_id` text,
	`origin` text DEFAULT 'MANUAL' NOT NULL,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bills_company_number` ON `bills` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `bills_company_status` ON `bills` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `bills_company_contact` ON `bills` (`company_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `bills_company_date` ON `bills` (`company_id`,`date`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`organisation_id` text NOT NULL,
	`name` text NOT NULL,
	`trading_name` text,
	`cro_number` text,
	`vat_number` text,
	`vat_basis` text DEFAULT 'INVOICE' NOT NULL,
	`vat_period_months` integer DEFAULT 2 NOT NULL,
	`year_end_month` integer DEFAULT 12 NOT NULL,
	`year_end_day` integer DEFAULT 31 NOT NULL,
	`base_currency` text DEFAULT 'EUR' NOT NULL,
	`entity_type` text DEFAULT 'LIMITED_COMPANY' NOT NULL,
	`industry` text,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`county` text,
	`eircode` text,
	`country` text DEFAULT 'IE' NOT NULL,
	`contact_email` text,
	`contact_phone` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`organisation_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `companies_org_idx` ON `companies` (`organisation_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`vat_number` text,
	`address_line1` text,
	`city` text,
	`county` text,
	`eircode` text,
	`country` text DEFAULT 'IE' NOT NULL,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`default_account_id` text,
	`default_vat_rate_id` text,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_company_type` ON `contacts` (`company_id`,`type`);--> statement-breakpoint
CREATE INDEX `contacts_company_name` ON `contacts` (`company_id`,`name`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_path` text NOT NULL,
	`doc_type` text DEFAULT 'OTHER' NOT NULL,
	`extracted` text,
	`extraction_status` text DEFAULT 'NONE' NOT NULL,
	`uploaded_by_id` text,
	`invoice_id` text,
	`bill_id` text,
	`expense_id` text,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `documents_company` ON `documents` (`company_id`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`contact_id` text,
	`merchant` text NOT NULL,
	`description` text,
	`date` integer NOT NULL,
	`account_id` text NOT NULL,
	`vat_rate_id` text NOT NULL,
	`net_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`gross_cents` integer NOT NULL,
	`paid_via` text DEFAULT 'BANK' NOT NULL,
	`bank_account_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`origin` text DEFAULT 'MANUAL' NOT NULL,
	`journal_id` text,
	`submitted_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_company_status` ON `expenses` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `expenses_company_date` ON `expenses` (`company_id`,`date`);--> statement-breakpoint
CREATE TABLE `fixed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`asset_account_id` text NOT NULL,
	`depreciation_account_id` text,
	`accumulated_account_id` text,
	`purchase_date` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`method` text DEFAULT 'STRAIGHT_LINE' NOT NULL,
	`useful_life_months` integer DEFAULT 60 NOT NULL,
	`residual_cents` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`disposed_at` integer,
	`disposal_proceeds_cents` integer,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fixed_assets_company` ON `fixed_assets` (`company_id`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`filename` text,
	`imported_by_id` text,
	`row_count` integer NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_batches_company` ON `import_batches` (`company_id`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`account_id` text NOT NULL,
	`vat_rate_id` text NOT NULL,
	`net_cents` integer NOT NULL,
	`vat_cents` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text DEFAULT 'INVOICE' NOT NULL,
	`number` text NOT NULL,
	`reference` text,
	`date` integer NOT NULL,
	`due_date` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`vat_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`paid_cents` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`journal_id` text,
	`void_journal_id` text,
	`created_by_id` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_company_number` ON `invoices` (`company_id`,`number`);--> statement-breakpoint
CREATE INDEX `invoices_company_status` ON `invoices` (`company_id`,`status`);--> statement-breakpoint
CREATE INDEX `invoices_company_contact` ON `invoices` (`company_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `invoices_company_date` ON `invoices` (`company_id`,`date`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`description` text,
	`debit_cents` integer DEFAULT 0 NOT NULL,
	`credit_cents` integer DEFAULT 0 NOT NULL,
	`contact_id` text,
	`vat_rate_id` text,
	FOREIGN KEY (`journal_id`) REFERENCES `journals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `journal_lines_account` ON `journal_lines` (`account_id`);--> statement-breakpoint
CREATE INDEX `journal_lines_journal` ON `journal_lines` (`journal_id`);--> statement-breakpoint
CREATE TABLE `journals` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`journal_number` integer NOT NULL,
	`date` integer NOT NULL,
	`description` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`posted_by_id` text,
	`posted_at` integer,
	`reverses_id` text,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `journals_company_number` ON `journals` (`company_id`,`journal_number`);--> statement-breakpoint
CREATE INDEX `journals_company_date` ON `journals` (`company_id`,`date`);--> statement-breakpoint
CREATE INDEX `journals_source` ON `journals` (`company_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_company` ON `memberships` (`user_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `memberships_company_idx` ON `memberships` (`company_id`);--> statement-breakpoint
CREATE TABLE `number_sequences` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`next_value` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `number_seq_company_key` ON `number_sequences` (`company_id`,`key`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'BUSINESS' NOT NULL,
	`owner_user_id` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text,
	`bill_id` text,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pay_alloc_payment` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `pay_alloc_invoice` ON `payment_allocations` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `pay_alloc_bill` ON `payment_allocations` (`bill_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`contact_id` text,
	`direction` text NOT NULL,
	`date` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text,
	`bank_account_id` text NOT NULL,
	`journal_id` text,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_company_date` ON `payments` (`company_id`,`date`);--> statement-breakpoint
CREATE TABLE `period_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`locked_through` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `period_locks_company` ON `period_locks` (`company_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`bank_account_id` text NOT NULL,
	`statement_date` integer NOT NULL,
	`statement_balance_cents` integer NOT NULL,
	`ledger_balance_cents` integer NOT NULL,
	`difference_cents` integer NOT NULL,
	`status` text DEFAULT 'IN_PROGRESS' NOT NULL,
	`explanation` text,
	`created_by_id` text,
	`closed_at` integer,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recon_company_bank` ON `reconciliation_sessions` (`company_id`,`bank_account_id`);--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`bank_transaction_id` text,
	`payload` text NOT NULL,
	`explanation` text NOT NULL,
	`confidence` integer NOT NULL,
	`evidence` text,
	`status` text DEFAULT 'SUGGESTED' NOT NULL,
	`source` text DEFAULT 'HEURISTIC' NOT NULL,
	`acted_by_id` text,
	`acted_at` integer,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `suggestions_status` ON `suggestions` (`company_id`,`status`,`kind`);--> statement-breakpoint
CREATE INDEX `suggestions_entity` ON `suggestions` (`company_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `vat_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`category` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer,
	`archived` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `vat_rates_company` ON `vat_rates` (`company_id`);--> statement-breakpoint
CREATE TABLE `vat_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`due_date` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`t1_cents` integer DEFAULT 0 NOT NULL,
	`t2_cents` integer DEFAULT 0 NOT NULL,
	`t3_cents` integer DEFAULT 0 NOT NULL,
	`t4_cents` integer DEFAULT 0 NOT NULL,
	`e1_cents` integer DEFAULT 0 NOT NULL,
	`e2_cents` integer DEFAULT 0 NOT NULL,
	`es1_cents` integer DEFAULT 0 NOT NULL,
	`es2_cents` integer DEFAULT 0 NOT NULL,
	`pa1_cents` integer DEFAULT 0 NOT NULL,
	`exceptions` text,
	`journal_id` text,
	`finalised_by_id` text,
	`finalised_at` integer,
	`created_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vat_returns_period` ON `vat_returns` (`company_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `vat_returns_status` ON `vat_returns` (`company_id`,`status`);