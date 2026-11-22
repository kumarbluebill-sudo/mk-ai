import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";

/**
 * Server error log, stored in our own database (no third-party service). Errors are grouped by a fingerprint,
 * and anything that looks like personal or secret data is removed BEFORE it is stored, because messages
 * and stack traces often contain emails, ids, tokens or connection strings.
 */

const MAX_MESSAGE = 500;
const MAX_STACK = 2000;

export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b(postgres(ql)?|mysql|redis|https?):\/\/[^\s"')]+/gi, "[url]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]")
    .replace(/\b(sk|pk|rzp|key|token|secret)[-_][A-Za-z0-9_-]{8,}/gi, "[secret]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[long-id]")
    .replace(/\bc[a-z0-9]{24}\b/g, "[id]")
    .replace(/\b\d{6,}\b/g, "[number]");
}

/** First stack frame inside our own code (no line numbers, which change every release). */
function topFrame(stack: string | undefined): string {
  const line = stack?.split("\n").find((l) => l.includes("at ") && !l.includes("node_modules") && !l.includes("node:"));
  return line ? line.replace(/:\d+:\d+/g, "").trim() : "";
}

export function fingerprint(name: string, message: string, stack: string | undefined): string {
  return createHash("sha256").update(`${name}|${redact(message)}|${topFrame(stack)}`).digest("hex").slice(0, 32);
}

export interface ErrorContext {
  source: "server" | "route" | "render" | "action" | "other";
  route?: string;
}

/** Never throws: reporting an error must not create another one. Returns whether it was stored. */
export async function recordError(
  error: unknown,
  ctx: ErrorContext,
  prisma: Pick<PrismaClient, "errorLog"> = getPrismaClient()
): Promise<boolean> {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error value thrown");
    const name = err.name || "Error";
    const message = redact(err.message || "").slice(0, MAX_MESSAGE);
    const stack = err.stack ? redact(err.stack).slice(0, MAX_STACK) : undefined;
    const fp = fingerprint(name, err.message || "", err.stack);
    const route = ctx.route ? redact(ctx.route.split("?")[0]).slice(0, 200) : undefined;
    await prisma.errorLog.upsert({
      where: { fingerprint: fp },
      create: { fingerprint: fp, source: ctx.source, name, message, route, stack },
      // A resolved error that happens again is open again.
      update: { count: { increment: 1 }, lastSeen: new Date(), resolvedAt: null, route },
    });
    return true;
  } catch {
    return false;
  }
}

export interface ErrorRow {
  id: string;
  source: string;
  name: string;
  message: string;
  route: string | null;
  stack: string | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
}

export async function listErrors(
  opts: { includeResolved?: boolean; take?: number } = {},
  prisma: Pick<PrismaClient, "errorLog"> = getPrismaClient()
): Promise<ErrorRow[]> {
  const rows = await prisma.errorLog.findMany({
    where: opts.includeResolved ? {} : { resolvedAt: null },
    orderBy: { lastSeen: "desc" },
    take: Math.min(Math.max(opts.take ?? 100, 1), 200),
  });
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    name: r.name,
    message: r.message,
    route: r.route,
    stack: r.stack,
    count: r.count,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    resolved: r.resolvedAt !== null,
  }));
}

export async function resolveError(id: string, prisma: Pick<PrismaClient, "errorLog"> = getPrismaClient()): Promise<boolean> {
  const res = await prisma.errorLog.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date() } });
  return res.count > 0;
}
