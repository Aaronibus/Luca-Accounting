import { NextRequest, NextResponse } from "next/server";
import { db, tables } from "@/db";
import { and, eq } from "drizzle-orm";
import { requireUser, setActiveCompany } from "@/lib/auth";
import { z } from "zod";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = z.object({ companyId: z.string() }).safeParse(await req.json());
    if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    // membership check — the tenancy boundary
    const membership = db
      .select()
      .from(tables.memberships)
      .where(and(eq(tables.memberships.userId, user.id), eq(tables.memberships.companyId, body.data.companyId)))
      .get();
    if (!membership) return NextResponse.json({ error: "No access to that company" }, { status: 403 });
    setActiveCompany(body.data.companyId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
}
