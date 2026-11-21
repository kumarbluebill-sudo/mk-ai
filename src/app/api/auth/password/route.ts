import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { getPrismaClient } from "@/lib/prisma";
import { rateLimit } from "@/server/rate-limit";
import { crossOriginResponse } from "@/server/same-origin";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, "Password must be at least 10 characters").max(200),
});

/** Change your own password. Needs the current one, so a stolen session alone is not enough. */
export async function POST(request: NextRequest) {
  const blocked = crossOriginResponse(request);
  if (blocked) return blocked;
  try {
    const ctx = await requireTenantContext();
    if (!rateLimit(`pw:${ctx.userId}`, 5, 15 * 60_000)) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID", message: parsed.error.issues[0]?.message ?? "Check the passwords." }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "INVALID", message: "Choose a password you have not just used." }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { passwordHash: true } });
    if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "WRONG_PASSWORD", message: "The current password is not correct." }, { status: 403 });
    }
    await prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: "auth.password_changed", entity: "User", entityId: ctx.userId });
    return NextResponse.json({ success: true });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: "Failed to change the password" }, { status: 500 });
  }
}
