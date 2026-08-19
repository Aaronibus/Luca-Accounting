import { NextRequest, NextResponse } from "next/server";
import { db, tables } from "@/db";
import { eq } from "drizzle-orm";
import { createSession, verifyPassword } from "@/lib/auth";
import { z } from "zod";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

// naive in-memory rate limit per email (production: move to a shared store)
const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { email, password } = body.data;

  const now = Date.now();
  const attempt = attempts.get(email);
  if (attempt && attempt.count >= 8 && attempt.resetAt > now) {
    return NextResponse.json({ error: "Too many attempts — try again in a few minutes" }, { status: 429 });
  }

  const user = db.select().from(tables.users).where(eq(tables.users.email, email.toLowerCase())).get();
  const ok = user && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    const cur = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + 10 * 60_000 };
    attempts.set(email, { count: cur.count + 1, resetAt: cur.resetAt });
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }
  attempts.delete(email);
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
