import { NextRequest, NextResponse } from "next/server";
import { requireCompany, AuthError } from "@/lib/auth";
import { askCopilot } from "@/lib/ai/copilot";
import { z } from "zod";

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireCompany("ai");
    const body = z
      .object({ question: z.string().min(1).max(500), page: z.string().max(200).optional() })
      .safeParse(await req.json());
    if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const result = await askCopilot({
      companyId: ctx.companyId,
      userId: ctx.user.id,
      question: body.data.question,
      context: { page: body.data.page },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "Copilot hit a problem answering that" }, { status: 500 });
  }
}
