import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getPrismaClient } from "@/lib/prisma";
import { verifyPassword } from "@/server/auth/password";
import { verifyTotp } from "@/server/auth/totp";
import { recordAudit } from "@/server/audit";
import { decryptSecret } from "@/server/crypto";
import { rateLimit } from "@/server/rate-limit";
import { authConfig } from "./auth.config";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  totp: z.string().max(10).optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, totp } = parsed.data;

        // Throttle password guessing per account (10 attempts / 15 min).
        if (!(await rateLimit(`login:${email}`, 10, 15 * 60 * 1000))) return null;

        const prisma = getPrismaClient();
        const user = await prisma.user.findUnique({
          where: { email },
          include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
        });
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        const membership = user.memberships[0];
        if (!membership) return null;

        // Second factor: required whenever the user has enabled TOTP.
        if (user.totpEnabled) {
          let ok = false;
          try {
            ok = !!user.totpSecretEncrypted && !!totp && verifyTotp(decryptSecret(user.totpSecretEncrypted), totp.trim());
          } catch (error) {
            console.error("MFA verification error:", error instanceof Error ? error.message : error);
          }
          if (!ok) {
            void recordAudit({ tenantId: membership.tenantId, userId: user.id, action: "auth.mfa_failed", entity: "User", entityId: user.id });
            return null;
          }
        }

        void recordAudit({ tenantId: membership.tenantId, userId: user.id, action: "auth.login", entity: "User", entityId: user.id });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tenantId: membership.tenantId,
          role: membership.role,
          isSuperAdmin: user.isSuperAdmin,
        };
      },
    }),
  ],
});
