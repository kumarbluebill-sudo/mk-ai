import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/lib/prisma";
import { EmailInUseError, registerAgency, registerSchema } from "@/server/auth/register";
import { isSchemaMismatch, SCHEMA_OUT_OF_DATE_MESSAGE } from "@/server/db-schema";
import { rateLimit } from "@/server/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`register:${ip}`, 5, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await registerAgency(getPrismaClient(), parsed.data);
    return NextResponse.json({ success: true, tenantSlug: result.slug }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailInUseError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Register error:", error);
    if (isSchemaMismatch(error)) return NextResponse.json({ error: SCHEMA_OUT_OF_DATE_MESSAGE }, { status: 503 });
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
