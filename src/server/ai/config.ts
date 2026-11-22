import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { AnthropicProvider } from "./anthropic";
import { isProviderId, PROVIDER_IDS, PROVIDERS, validateBaseUrl, type ProviderId } from "./catalog";
import { AI_ERROR_TEXT, classifyAiError, type AiErrorCategory } from "./errors";
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
  /** When false this provider is never used as a fallback for another provider. */
  useAsFallback: z.boolean().default(true),
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
  useAsFallback: boolean;
  /** True for the first enabled provider with a usable key: the one asked first. */
  isPrimary: boolean;
  lastSuccessAt: string | null;
  priority: number;
  inputPricePerM: number | null;
  outputPricePerM: number | null;
  tools: "yes" | "model";
  note: string | null;
  health: { checkedAt: string | null; ok: boolean | null; message: string | null; latencyMs: number | null; category?: AiErrorCategory | null };
}

export interface UsageRow {
  provider: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  avgLatencyMs: number | null;
  /** Failed calls by category (AUTH, TIMEOUT ...). */
  errorCategories: Record<string, number>;
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
    useAsFallback: c?.useAsFallback ?? true,
    isPrimary: false,
    lastSuccessAt: c?.lastSuccessAt?.toISOString() ?? null,
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
  const rows = PROVIDER_IDS.map((id) => rowOf(id, configs.find((c) => c.provider === id)));
  // The primary is what resolveProviders would ask first: lowest order among enabled providers that can be used.
  const primary = rows.filter((r) => r.enabled && (r.hasKey || !r.needsKey)).sort((a, b) => a.priority - b.priority)[0];
  if (primary) primary.isPrimary = true;
  return rows;
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
    useAsFallback: input.useAsFallback,
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

const MODELS_TIMEOUT_MS = 8000;

export type ModelListing = { ok: true; models: string[] } | { ok: false; category: AiErrorCategory; message: string };

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

function baseUrlOf(provider: ProviderId, configured: string | null | undefined): string | null {
  return (configured || PROVIDERS[provider].baseUrl || "").replace(/\/+$/, "") || null;
}

/** An HTTP failure shaped like the SDK errors, so classifyAiError reads it the same way. */
function httpFailure(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function describeFailure(category: AiErrorCategory, status?: number): string {
  const head: Record<AiErrorCategory, string> = {
    AUTH: "Authentication failed",
    RATE_LIMIT: "Rate limit reached",
    TIMEOUT: "Request timed out",
    UNAVAILABLE: "Server unavailable",
    INVALID_MODEL: "Invalid model",
    BAD_RESPONSE: "Unexpected response",
    OTHER: "Request failed",
  };
  return `${head[category]}: ${AI_ERROR_TEXT[category]}${status ? ` (HTTP ${status})` : ""}.`;
}

/**
 * The real model ids the server offers (GET {baseUrl}/models, the OpenAI-compatible listing). Nothing is
 * hardcoded: whatever the service returns is what the admin can pick from.
 */
export async function fetchModels(baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<ModelListing> {
  try {
    const res = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      const category = classifyAiError(httpFailure(res.status));
      return { ok: false, category, message: describeFailure(category, res.status) };
    }
    const parsed = modelsSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) return { ok: false, category: "BAD_RESPONSE", message: describeFailure("BAD_RESPONSE") };
    return { ok: true, models: [...new Set(parsed.data.data.map((m) => m.id))].sort() };
  } catch (error) {
    const category = classifyAiError(error);
    return { ok: false, category, message: describeFailure(category) };
  }
}

/** Model ids for the admin's picker. Needs the provider saved first (the key is read from the database). */
export async function listModels(provider: ProviderId, db: Db = getPrismaClient(), fetchFn: typeof fetch = fetch): Promise<ModelListing> {
  const info = PROVIDERS[provider];
  if (info.adapter !== "openai-compatible") return { ok: false, category: "OTHER", message: `${info.label} does not offer a model list through this page.` };
  const c = await db.aiProviderConfig.findUnique({ where: { provider } });
  if (!c) throw new AiConfigError("NOT_FOUND", "Save this provider first.");
  const base = baseUrlOf(provider, c.baseUrl);
  if (!base) return { ok: false, category: "OTHER", message: "No base URL is set." };
  let apiKey = "";
  try {
    apiKey = c.encryptedKey ? decryptSecret(c.encryptedKey) : "";
  } catch {
    return { ok: false, category: "AUTH", message: "The saved key cannot be decrypted (was ENCRYPTION_KEY changed?). Enter the key again." };
  }
  return fetchModels(base, apiKey, fetchFn);
}

/**
 * A real check of the provider. OpenAI-compatible servers are asked for their model list first (proves the
 * address and the key), then for one tiny completion with the chosen model (proves the model and the answering
 * path). "Working" is recorded only if that completion really came back.
 */
export async function testProvider(
  provider: ProviderId,
  db: Db = getPrismaClient(),
  build: (input: BuildInput) => AiProvider = buildProvider,
  fetchFn: typeof fetch = fetch
): Promise<ProviderRow["health"]> {
  const c = await db.aiProviderConfig.findUnique({ where: { provider } });
  if (!c) throw new AiConfigError("NOT_FOUND", "Save this provider first.");
  let apiKey = "";
  try {
    apiKey = c.encryptedKey ? decryptSecret(c.encryptedKey) : "";
  } catch {
    return storeHealth(db, provider, false, "The saved key cannot be decrypted (was ENCRYPTION_KEY changed?). Enter the key again.", null, "AUTH");
  }
  const started = Date.now();
  const info = PROVIDERS[provider];
  let note = "";
  if (info.adapter === "openai-compatible") {
    const base = baseUrlOf(provider, c.baseUrl);
    if (!base) return storeHealth(db, provider, false, "No base URL is set.", null, "OTHER");
    const listing = await fetchModels(base, apiKey, fetchFn);
    if (!listing.ok) return storeHealth(db, provider, false, listing.message, Date.now() - started, listing.category);
    // "auto" (a gateway choosing for you) is never in a model list, so it is not checked against it.
    if (c.model !== "auto" && !listing.models.includes(c.model)) {
      return storeHealth(db, provider, false, `${describeFailure("INVALID_MODEL")} "${c.model}" is not in the server's model list (${listing.models.length} models).`, Date.now() - started, "INVALID_MODEL");
    }
    note = `${listing.models.length} models listed. `;
  }
  try {
    const p = build({ provider, model: c.model, apiKey, baseUrl: c.baseUrl });
    const signal = AbortSignal.timeout(20_000);
    const r = await p.complete({ system: "Reply with the single word OK.", messages: [{ role: "user", content: "ping" }], tools: [], maxTokens: 16, signal });
    const served = r.model && r.model !== c.model ? ` Answered by ${r.model}.` : "";
    return storeHealth(db, provider, true, `Connection successful. ${note}${r.text ? "A test message was answered." : "The test message came back empty."}${served}`, Date.now() - started, null);
  } catch (error) {
    const category = classifyAiError(error);
    const status = (error as { status?: unknown } | null)?.status;
    return storeHealth(db, provider, false, describeFailure(category, typeof status === "number" ? status : undefined), Date.now() - started, category);
  }
}

async function storeHealth(db: Db, provider: ProviderId, ok: boolean, message: string, latencyMs: number | null, category: AiErrorCategory | null): Promise<ProviderRow["health"]> {
  const now = new Date();
  await db.aiProviderConfig.update({
    where: { provider },
    data: { lastCheckAt: now, lastCheckOk: ok, lastCheckMessage: message, lastLatencyMs: latencyMs, ...(ok ? { lastSuccessAt: now } : {}) },
  });
  return { checkedAt: now.toISOString(), ok, message, latencyMs, category };
}

const successSeen = new Map<string, number>();

/** Notes that a provider answered a real chat request (at most once a minute per provider). Never throws. */
export function noteProviderSuccess(provider: string, db?: Pick<PrismaClient, "aiProviderConfig">): void {
  const last = successSeen.get(provider) ?? 0;
  if (Date.now() - last < 60_000) return;
  successSeen.set(provider, Date.now());
  try {
    (db ?? getPrismaClient()).aiProviderConfig.updateMany({ where: { provider }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
  } catch {
    // no database configured
  }
}

export async function usageSummary(days = 30, db: Db = getPrismaClient()): Promise<UsageRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [groups, categories, configs] = await Promise.all([
    db.aiUsage.groupBy({
      by: ["provider", "ok"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
      _avg: { latencyMs: true },
    }),
    db.aiUsage.groupBy({ by: ["provider", "errorCategory"], where: { createdAt: { gte: since }, ok: false }, _count: { _all: true } }),
    db.aiProviderConfig.findMany({ select: { provider: true, inputPricePerM: true } }),
  ]);
  const byProvider = new Map<string, UsageRow & { costMicros: number; latSum: number; latN: number }>();
  for (const g of groups) {
    const row = byProvider.get(g.provider) ?? { provider: g.provider, calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: null, errorCategories: {}, estimatedCost: null, costMicros: 0, latSum: 0, latN: 0 };
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
  for (const c of categories) {
    const row = byProvider.get(c.provider);
    if (row) row.errorCategories[c.errorCategory ?? "OTHER"] = (row.errorCategories[c.errorCategory ?? "OTHER"] ?? 0) + c._count._all;
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
      errorCategories: r.errorCategories,
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
 * The chain a chat request uses.
 *  - Providers saved in /admin/ai: the first enabled one with a usable key is the PRIMARY. The others follow in
 *    order but only if "use as fallback" is on for them; a provider with it off is never silently used.
 *  - Providers from environment variables (ANTHROPIC_API_KEY ...) are used only when nothing usable is saved
 *    here, so saving a provider is what switches the platform over, and nothing else sneaks in behind it.
 * A database problem falls back to the environment alone, so chat never depends on this table.
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
        // The first usable provider is the primary; later ones must have opted in to being a fallback.
        if (providers.length > 0 && c.useAsFallback === false) continue;
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
  if (providers.length === 0) providers.push(...envProviders(env));
  cache = { at: Date.now(), providers };
  return providers;
}
