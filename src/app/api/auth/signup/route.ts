import { NextRequest, NextResponse } from "next/server";
import { db, tables } from "@/db";
import { eq } from "drizzle-orm";
import { createSession, hashPassword } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Enter your name, a valid email and a password of at least 8 characters" }, { status: 400 });
  }
  const email = body.data.email.toLowerCase().trim();

  const existing = db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, email)).get();
  if (existing) return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });

  const user = db
    .insert(tables.users)
    .values({ email, name: body.data.name.trim(), passwordHash: await hashPassword(body.data.password) })
    .returning({ id: tables.users.id })
    .get();

  // New accounts start with NO company — onboarding decides blank vs demo.
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
