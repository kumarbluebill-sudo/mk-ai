import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { ALL_ADAPTERS } from "./registry";
import { searchInventory, type SearchOptions } from "./search";
import type { InventoryCategory, SupplierAdapter, SupplierOutcome } from "./types";

/**
 * Platform-level supplier controls (super admin): an on/off switch per supplier, a log of real supplier
 * requests for health statistics, and a "test connection" that makes one real search.
 *
 * Credentials stay in environment variables on purpose: the Viator and Traveldesk clients read them
 * synchronously, and one platform key set is how the product works today. Moving keys into the database only
 * makes sense when agencies bring their own supplier accounts, which needs those clients reworked first.
 */

type Db = Pick<PrismaClient, "supplierSetting" | "supplierCall">;

export class SupplierAdminError extends Error {
  constructor(
    readonly code: "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "SupplierAdminError";
  }
}

export interface SupplierStats {
  calls: number;
  ok: number;
  timeouts: number;
  errors: number;
  avgLatencyMs: number | null;
  lastCallAt: string | null;
  lastProblem: { at: string; status: string; message: string | null } | null;
}

export interface SupplierAdminRow {
  id: string;
  displayName: string;
  categories: readonly InventoryCategory[];
  configured: boolean;
  /** Why it is not usable (only when not configured). */
  reason: string | null;
  /** "sandbox" or "production" for suppliers that have both; null when unknown or not applicable. */
  environment: "sandbox" | "production" | null;
  enabled: boolean;
  stats: SupplierStats;
}

/** Which API environment each supplier is currently pointed at, read from the same variables the clients use. */
export function supplierEnvironment(id: string, env: Record<string, string | undefined> = process.env): "sandbox" | "production" | null {
  if (id === "viator") return env.VIATOR_API_ENV === "production" ? "production" : "sandbox";
  if (id === "traveldesk") return env.TRAVELDESK_API_ENV === "production" ? "production" : "sandbox";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Runtime hooks used by searches
// ---------------------------------------------------------------------------------------------

let disabledCache: { at: number; ids: Set<string> } | null = null;
const CACHE_MS = 30_000;

export function clearSupplierSettingsCache(): void {
  disabledCache = null;
}

/** Suppliers switched off by the admin. A database problem means "none", so searching never depends on this table. */
export async function disabledSuppliers(db?: Pick<PrismaClient, "supplierSetting">): Promise<Set<string>> {
  if (disabledCache && Date.now() - disabledCache.at < CACHE_MS) return disabledCache.ids;
  let ids = new Set<string>();
  try {
    ids = new Set((await (db ?? getPrismaClient()).supplierSetting.findMany({ where: { enabled: false }, select: { supplierId: true } })).map((r) => r.supplierId));
  } catch {
    // keep the empty set
  }
  disabledCache = { at: Date.now(), ids };
  return ids;
}

/** Counts one real supplier request. Fire and forget; never throws. */
export function recordCall(outcome: SupplierOutcome, category: InventoryCategory, dbOverride?: Pick<PrismaClient, "supplierCall">): void {
  let db: Pick<PrismaClient, "supplierCall">;
  try {
    db = dbOverride ?? getPrismaClient();
  } catch {
    return; // no database configured: nothing to count
  }
  db.supplierCall
    .create({
      data: {
        supplier: outcome.supplier,
        category,
        status: outcome.status,
        latencyMs: outcome.latencyMs,
        itemCount: outcome.itemCount,
        message: outcome.status === "OK" ? null : (outcome.message ?? null)?.slice(0, 200) ?? null,
      },
    })
    .then(() => {
      // Keep the log small: now and then, drop rows older than 90 days.
      if (Math.random() < 0.01) return db.supplierCall.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } });
    })
    .catch(() => undefined);
}

/** Options every caller of searchInventory adds, so switches and call counting apply everywhere. */
export async function supplierRuntime(): Promise<Pick<SearchOptions, "disabled" | "onOutcome">> {
  return { disabled: await disabledSuppliers(), onOutcome: (o, c) => recordCall(o, c) };
}

// ---------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------

export async function listSupplierAdmin(
  db: Db = getPrismaClient(),
  adapters: readonly SupplierAdapter[] = ALL_ADAPTERS,
  days = 30,
  env: Record<string, string | undefined> = process.env
): Promise<SupplierAdminRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [settings, groups, problems, lastCalls] = await Promise.all([
    db.supplierSetting.findMany(),
    db.supplierCall.groupBy({ by: ["supplier", "status"], where: { createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
    db.supplierCall.findMany({ where: { createdAt: { gte: since }, status: { in: ["TIMEOUT", "ERROR"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { supplier: true, status: true, message: true, createdAt: true } }),
    db.supplierCall.groupBy({ by: ["supplier"], where: { createdAt: { gte: since } }, _max: { createdAt: true } }),
  ]);
  return adapters.map((a) => {
    const configured = a.isConfigured();
    const mine = groups.filter((g) => g.supplier === a.id);
    const count = (s: string) => mine.find((g) => g.status === s)?._count._all ?? 0;
    const calls = mine.reduce((n, g) => n + g._count._all, 0);
    const latSum = mine.reduce((n, g) => n + (g._avg.latencyMs ?? 0) * g._count._all, 0);
    const lastProblem = problems.find((p) => p.supplier === a.id);
    const last = lastCalls.find((l) => l.supplier === a.id)?._max.createdAt ?? null;
    return {
      id: a.id,
      displayName: a.displayName,
      categories: a.categories,
      configured,
      reason: configured ? null : a.notConfiguredReason(),
      environment: configured ? supplierEnvironment(a.id, env) : null,
      enabled: settings.find((s) => s.supplierId === a.id)?.enabled ?? true,
      stats: {
        calls,
        ok: count("OK"),
        timeouts: count("TIMEOUT"),
        errors: count("ERROR"),
        avgLatencyMs: calls ? Math.round(latSum / calls) : null,
        lastCallAt: last ? last.toISOString() : null,
        lastProblem: lastProblem ? { at: lastProblem.createdAt.toISOString(), status: lastProblem.status, message: lastProblem.message } : null,
      },
    };
  });
}

export async function setSupplierEnabled(id: string, enabled: boolean, db: Pick<PrismaClient, "supplierSetting"> = getPrismaClient(), adapters: readonly SupplierAdapter[] = ALL_ADAPTERS): Promise<void> {
  if (!adapters.some((a) => a.id === id)) throw new SupplierAdminError("NOT_FOUND", "Unknown supplier");
  await db.supplierSetting.upsert({ where: { supplierId: id }, create: { supplierId: id, enabled }, update: { enabled } });
  clearSupplierSettingsCache();
}

export interface SupplierTestResult {
  supplier: string;
  status: SupplierOutcome["status"];
  itemCount: number;
  latencyMs: number;
  environment?: string;
  message?: string;
}

/** One real search ("dubai", at most 3 results) against this supplier alone. Nothing from it is stored. */
export async function testSupplier(id: string, adapters: readonly SupplierAdapter[] = ALL_ADAPTERS): Promise<SupplierTestResult> {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) throw new SupplierAdminError("NOT_FOUND", "Unknown supplier");
  const result = await searchInventory(
    { category: adapter.categories[0], keyword: "dubai", currency: "USD", limit: 3 },
    { adapters: [adapter], useCache: false, timeoutMs: 15_000 }
  );
  const o = result.suppliers[0];
  return { supplier: o.supplier, status: o.status, itemCount: o.itemCount, latencyMs: o.latencyMs, environment: o.environment, message: o.message };
}
