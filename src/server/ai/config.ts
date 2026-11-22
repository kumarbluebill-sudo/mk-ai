import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { AnthropicProvider } from "./anthropic";
import { isProviderId, PROVIDER_IDS, PROVIDERS, validateBaseUrl, type ProviderId } from "./catalog";
import { OpenAIProvider } from "./openai";
import type { AiProvider } from "./types";

/**
 * Platform AI provider settings. The super admin chooses providers, models and keys in /admin/ai; keys are
 * encrypted at rest and never returned. Environment variables (ANTHROPIC_API_KEY ...) keep working as a
 * fallback, so nothing that works today stops working.
 */

type Db = Pick<PrismaClient, "aiProviderConfig" | "aiUsage">;

export class AiConfigError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "AiConfigError";
  }
}

export const saveSchema = z.object({
  provider: z.string().refine(isProviderId, "Unknown provider"),
  model: z.string().trim().min(1, "Enter a model name").max(120),
  baseUrl: z.string().trim().max(300).optional(),
  /** Blank or missing keeps the stored key. */
  apiKey: z.string().trim().max(500).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(1000).default(100),
  inputPricePerM: z.number().min(0).max(100000).nullable().optional(),
  outputPricePerM: z.number().min(0).max(100000).nullable().optional(),
});
export type SaveInput = z.infer<typeof saveSchema>;

export interface ProviderRow {
  provider: ProviderId;
  label: string;
  model: string;
  baseUrl: string | null;
  defaultBaseUrl: string | null;
  hasKey: boolean;
  keyLast4: string | null;
  needsKey: boolean;
  enabled: boolean;
  priority: number;
  inputPricePerM: number | null;
  outputPricePerM: number | null;
  tools: "yes" | "model";
  note: string | null;
  health: { checkedAt: string | null; ok: boolean | null; message: string | null; latencyMs: number | null };
}

export interface UsageRow {
  provider: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number | null;
  /** Estimated from the prices entered for the provider; null when no price was set. */
  estimatedCost: number | null;
}

// ---------------------------------------------------------------------------------------------
// Building providers
// ---------------------------------------------------------------------------------------------

export interface BuildInput {
  provider: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  inputPricePerM?: number | null;
  outputPricePerM?: number | null;
}

export function buildProvider(input: BuildInput): AiProvider {
  const info = PROVIDERS[input.provider];
  const pricing = input.inputPricePerM != null && input.outputPricePerM != null ? { inputPerM: input.inputPricePerM, outputPerM: input.outputPricePerM } : undefined;
  if (info.adapter === "anthropic") {
    const p = new AnthropicProvider(input.apiKey, input.model);
    return Object.assign(p, { pricing });
  }
  const p = new OpenAIProvider(input.apiKey, input.model, {
    name: info.id,
    baseURL: input.baseUrl || info.baseUrl || undefined,
    tokenParam: info.tokenParam,
  });
  return Object.assign(p, { pricing });
}

export function estimateCostMicros(pricing: { inputPerM: number; outputPerM: number } | undefined, inputTokens: number, outputTokens: number): number | null {
  if (!pricing) return null;
  // Price per million tokens equals "micros per token", so no extra scaling is needed.
  return Math.round(inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM);
}

/** Keys and key-looking strings never reach logs, the database or the browser. */
export function scrub(message: string, secret?: string): string {
  let out = message;
  if (secret && secret.length >= 6) out = out.split(secret).join("[key]");
  return out.replace(/\b(sk|pk|gsk|AIza|xai|rzp)[-_A-Za-z0-9]{12,}/g, "[key]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [key]").slice(0, 300);
}

// ---------------------------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------------------------

function rowOf(provider: ProviderId, c: Awaited<ReturnType<Db["aiProviderConfig"]["findMany"]>>[number] | undefined): ProviderRow {
  const info = PROVIDERS[provider];
  return {
    provider,
    label: info.label,
    model: c?.model ?? info.exampleModel,
    baseUrl: c?.baseUrl ?? null,
    defaultBaseUrl: info.baseUrl,
    hasKey: Boolean(c?.encryptedKey),
    keyLast4: c?.keyLast4 ?? null,
    needsKey: info.needsKey,
    enabled: c?.enabled ?? false,
    priority: c?.priority ?? 100,
    inputPricePerM: c?.inputPricePerM != null ? Number(c.inputPricePerM) : null,
    outputPricePerM: c?.outputPricePerM != null ? Number(c.outputPricePerM) : null,
    tools: info.tools,
    note: info.note ?? null,
    health: { checkedAt: c?.lastCheckAt?.toISOString() ?? null, ok: c?.lastCheckOk ?? null, message: c?.lastCheckMessage ?? null, latencyMs: c?.lastLatencyMs ?? null },
  };
}

/** Every known provider, configured or not, so the admin page can show what is available. */
export async function listProviders(db: Db = getPrismaClient()): Promise<ProviderRow[]> {
  const configs = await db.aiProviderConfig.findMany();
  return PROVIDER_IDS.map((id) => rowOf(id, configs.find((c) => c.provider === id)));
}

export async function saveProvider(input: SaveInput, db: Db = getPrismaClient()): Promise<ProviderRow> {
  const provider = input.provider as ProviderId;
  const info = PROVIDERS[provider];
  let baseUrl: string | null = null;
  if (input.baseUrl) {
    const v = validateBaseUrl(provider, input.baseUrl);
    if (!v.ok) throw new AiConfigError("INVALID", v.reason);
    baseUrl = v.url;
  }
  const existing = await db.aiProviderConfig.findUnique({ where: { provider } });
  const newKey = input.apiKey?.trim();
  if (info.needsKey && !newKey && !existing?.encryptedKey) throw new AiConfigError("INVALID", `${info.label} needs an API key.`);
  const keyData = newKey ? { encryptedKey: encryptSecret(newKey), keyLast4: newKey.slice(-4) } : {};
  const data = {
    model: input.model,
    baseUrl,
    enabled: input.enabled,
    priority: input.priority,
    inputPricePerM: input.inputPricePerM ?? null,
    outputPricePerM: input.outputPricePerM ?? null,
    ...keyData,
    // A changed key, model or URL invalidates the earlier health result.
    ...(newKey || existing?.model !== input.model || existing?.baseUrl !== baseUrl ? { lastCheckAt: null, lastCheckOk: null, lastCheckMessage: null, lastLatencyMs: null } : {}),
  };
  const saved = await db.aiProviderConfig.upsert({ where: { provider }, create: { provider, ...data }, update: data });
  clearProviderCache();
  return rowOf(provider, saved);
}

export async function removeProvider(provider: ProviderId, db: Db = getPrismaClient()): Promise<boolean> {
  const res = await db.aiProviderConfig.deleteMany({ where: { provider } });
  clearProviderCache();
  return res.count > 0;
}

/** A tiny real request to the provider. The result (and only a scrubbed message) is stored as its health. */
export async function testProvider(
  provider: ProviderId,
  db: Db = getPrismaClient(),
  build: (input: BuildInput) => AiProvider = buildProvider
): Promise<ProviderRow["health"]> {
  const c = await db.aiProviderConfig.findUnique({ where: { provider } });
  if (!c) throw new AiConfigError("NOT_FOUND", "Save this provider first.");
  let apiKey = "";
  try {
    apiKey = c.encryptedKey ? decryptSecret(c.encryptedKey) : "";
  } catch {
    return storeHealth(db, provider, false, "The saved key cannot be decrypted (was ENCRYPTION_KEY changed?). Enter the key again.", null);
  }
  const started = Date.now();
  try {
    const p = build({ provider, model: c.model, apiKey, baseUrl: c.baseUrl });
    const signal = AbortSignal.timeout(20_000);
    const r = await p.complete({ system: "Reply with the single word OK.", messages: [{ role: "user", content: "ping" }], tools: [], maxTokens: 16, signal });
    return storeHealth(db, provider, true, r.text ? "Answered." : "Answered (empty reply).", Date.now() - started);
  } catch (error) {
    return storeHealth(db, provider, false, scrub(error instanceof Error ? error.message : "Request failed", apiKey) || "Request failed", Date.now() - started);
  }
}

async function storeHealth(db: Db, provider: ProviderId, ok: boolean, message: string, latencyMs: number | null): Promise<ProviderRow["health"]> {
  const now = new Date();
  await db.aiProviderConfig.update({ where: { provider }, data: { lastCheckAt: now, lastCheckOk: ok, lastCheckMessage: message, lastLatencyMs: latencyMs } });
  return { checkedAt: now.toISOString(), ok, message, latencyMs };
}

export async function usageSummary(days = 30, db: Db = getPrismaClient()): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [groups, configs] = await Promise.all([
    db.aiUsage.groupBy({
      by: ["provider", "ok"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      _avg: { latencyMs: true },
    }),
    db.aiProviderConfig.findMany({ select: { provider: true, inputPricePerM: true } }),
  ]);
  const byProvider = new Map<string, UsageRow & { costMicros: number; latSum: number; latN: number }>();
  for (const g of groups) {
    const row = byProvider.get(g.provider) ?? { provider: g.provider, calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: null, estimatedCost: null, costMicros: 0, latSum: 0, latN: 0 };
    row.calls += g._count._all;
    if (!g.ok) row.failures += g._count._all;
    row.inputTokens += g._sum.inputTokens ?? 0;
    row.outputTokens += g._sum.outputTokens ?? 0;
    row.costMicros += g._sum.costMicros ?? 0;
    if (g._avg.latencyMs != null) {
      row.latSum += g._avg.latencyMs * g._count._all;
      row.latN += g._count._all;
    }
    byProvider.set(g.provider, row);
  }
  const priced = new Set(configs.filter((c) => c.inputPricePerM != null).map((c) => c.provider));
  return [...byProvider.values()]
    .map((r) => ({
      provider: r.provider,
      calls: r.calls,
      failures: r.failures,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      avgLatencyMs: r.latN ? Math.round(r.latSum / r.latN) : null,
      estimatedCost: priced.has(r.provider) ? Math.round(r.costMicros) / 1_000_000 : null,
    }))
    .sort((a, b) => b.calls - a.calls);
}

// ---------------------------------------------------------------------------------------------
// Resolving providers for chat requests
// ---------------------------------------------------------------------------------------------

let cache: { at: number; providers: AiProvider[] } | null = null;
const CACHE_MS = 30_000;

export function clearProviderCache(): void {
  cache = null;
}

/**
 * Enabled providers saved in /admin/ai (by priority), then any environment-variable providers not already
 * listed. A database problem falls back to the environment alone, so chat never depends on this table.
 */
export async function resolveProviders(
  envProviders: (env: NodeJS.ProcessEnv) => AiProvider[],
  env: NodeJS.ProcessEnv = process.env,
  db: Pick<PrismaClient, "aiProviderConfig"> = getPrismaClient()
): Promise<AiProvider[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.providers;
  const providers: AiProvider[] = [];
  try {
    const configs = await db.aiProviderConfig.findMany({ where: { enabled: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
    for (const c of configs) {
      if (!isProviderId(c.provider)) continue;
      try {
        const apiKey = c.encryptedKey ? decryptSecret(c.encryptedKey) : "";
        if (PROVIDERS[c.provider].needsKey && !apiKey) continue;
        providers.push(
          buildProvider({
            provider: c.provider,
            model: c.model,
            apiKey,
            baseUrl: c.baseUrl,
            inputPricePerM: c.inputPricePerM != null ? Number(c.inputPricePerM) : null,
            outputPricePerM: c.outputPricePerM != null ? Number(c.outputPricePerM) : null,
          })
        );
      } catch {
        console.error(`AI provider ${c.provider}: saved key could not be used`);
      }
    }
  } catch (error) {
    console.error("AI provider settings unavailable, using environment settings:", error instanceof Error ? error.message : "unknown error");
  }
  for (const p of envProviders(env)) if (!providers.some((x) => x.name === p.name)) providers.push(p);
  cache = { at: Date.now(), providers };
  return providers;
}
