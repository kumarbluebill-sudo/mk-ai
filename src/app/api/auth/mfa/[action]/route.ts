import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPrismaClient } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { authErrorResponse, requireTenantContext } from "@/server/tenant-context";

const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

/**
 * POST /api/auth/mfa/setup    -> creates a pending TOTP secret (not active until confirmed)
 * POST /api/auth/mfa/enable   -> { code } confirms the secret and turns MFA on
 * POST /api/auth/mfa/disable  -> { code } turns MFA off (requires a current code)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    const ctx = await requireTenantContext();
    const prisma = getPrismaClient();

    if (!(await rateLimit(`mfa:${ctx.userId}`, 10, 15 * 60 * 1000))) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    if (action === "setup") {
      if (user.totpEnabled) return NextResponse.json({ error: "MFA is already enabled" }, { status: 409 });
      const secret = generateTotpSecret();
      await prisma.user.update({ where: { id: user.id }, data: { totpSecretEncrypted: encryptSecret(secret) } });
      // The secret is shown once so it can be added to an authenticator app.
      return NextResponse.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) });
    }

    if (action !== "enable" && action !== "disable") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = codeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
    if (!user.totpSecretEncrypted) return NextResponse.json({ error: "Run setup first" }, { status: 409 });

    if (!verifyTotp(decryptSecret(user.totpSecretEncrypted), parsed.data.code)) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    if (action === "enable") {
      await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    } else {
      if (!user.totpEnabled) return NextResponse.json({ error: "MFA is not enabled" }, { status: 409 });
      await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEncrypted: null } });
    }
    void recordAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action: `auth.mfa_${action}d`, entity: "User", entityId: user.id });
    return NextResponse.json({ success: true, mfaEnabled: action === "enable" });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("MFA error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "MFA request failed" }, { status: 500 });
  }
}
