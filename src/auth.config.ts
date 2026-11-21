import type { NextAuthConfig } from "next-auth";
import type { TenantRoleName } from "@/server/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      tenantId: string;
      role: TenantRoleName;
      isSuperAdmin: boolean;
    };
  }
  interface User {
    tenantId?: string;
    role?: TenantRoleName;
    isSuperAdmin?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    tenantId?: string;
    role?: TenantRoleName;
    isSuperAdmin?: boolean;
  }
}

/** Edge/proxy-safe config (no database or hashing imports). */
export const authConfig = {
  providers: [],
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
        token.isSuperAdmin = user.isSuperAdmin ?? false;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid ?? "";
      session.user.tenantId = token.tenantId ?? "";
      session.user.role = token.role ?? "READONLY";
      session.user.isSuperAdmin = token.isSuperAdmin ?? false;
      return session;
    },
  },
} satisfies NextAuthConfig;
