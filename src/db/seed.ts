// Dev/demo CLI seeder: creates the demo login users and one demo company,
// then applies the isolated sample dataset. Newly created companies in the
// product NEVER run this — they are provisioned blank.
//
// Demo logins: aaron@caracoffee.ie / demo1234 (owner)
//              maire@kellyaccountants.ie / demo1234 (accountant)

import { db, tables } from "./index";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { provisionCompany } from "@/lib/engine/setup";
import { seedDemoData } from "@/lib/demo/sample-data";

async function main() {
  const existing = db.select().from(tables.users).where(eq(tables.users.email, "aaron@caracoffee.ie")).get();
  if (existing) {
    console.log("Seed already applied — run `npm run db:reset` to reseed from scratch.");
    return;
  }

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const owner = db.insert(tables.users).values({ email: "aaron@caracoffee.ie", name: "Aaron Byrne", passwordHash }).returning().get();
  const accountant = db.insert(tables.users).values({ email: "maire@kellyaccountants.ie", name: "Máire Kelly", passwordHash }).returning().get();
  const org = db.insert(tables.organisations).values({ name: "Cara Coffee Roasters (Demo)", type: "BUSINESS", ownerUserId: owner.id }).returning().get();

  const { companyId } = provisionCompany({
    organisationId: org.id,
    name: "Cara Coffee Roasters Ltd",
    ownerUserId: owner.id,
    vatNumber: "IE3412345WH",
    croNumber: "684221",
    vatBasis: "INVOICE",
    city: "Kilkenny",
    county: "Co. Kilkenny",
    industry: "Food & beverage",
    isDemo: true,
  });
  db.insert(tables.memberships).values({ userId: accountant.id, companyId, role: "ACCOUNTANT" }).run();

  const result = seedDemoData({ companyId, ownerId: owner.id, accountantId: accountant.id });
  console.log("Seeded demo company: Cara Coffee Roasters Ltd (DEMO)");
  console.log("  VAT Jan–Feb T3:", result.vatJanFeb.t3Cents / 100);
  console.log("  VAT Mar–Apr T3:", result.vatMarApr.t3Cents / 100);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
