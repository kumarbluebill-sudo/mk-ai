import { adaptersForCategory } from "./registry";
import type {
  InventoryItem,
  InventorySearchRequest,
  SupplierAdapter,
  SupplierOutcome,
} from "./types";

export type SortMode = "relevance" | "price" | "rating";

export interface SearchOptions {
  /** Defaults to every adapter for the requested category. */
  adapters?: readonly SupplierAdapter[];
  /** Per-supplier deadline. A slow supplier must not delay the others. */
  timeoutMs?: number;
  sort?: SortMode;
  /** Drop items priced above this, in minor units of the request currency. */
  maxPriceMinor?: number;
  /** Set false to bypass the short-lived cache (e.g. right before presenting a price). */
  useCache?: boolean;
  /** Supplier ids switched off by the platform admin (see settings.ts). They are reported as DISABLED, not searched. */
  disabled?: ReadonlySet<string>;
  /** Called once per supplier that was actually asked, so calls can be counted. Must not throw. */
  onOutcome?: (outcome: SupplierOutcome, category: InventorySearchRequest["category"]) => void;
}

export interface SearchResult {
  items: InventoryItem[];
  suppliers: SupplierOutcome[];
  /** True only if at least one item came from a supplier production API. */
  liveInventory: boolean;
  checkedAt: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 200;

interface CacheEntry {
  at: number;
  items: InventoryItem[];
  environment: string;
  note?: string;
}
const cache = new Map<string, CacheEntry>();

export function clearSearchCache(): void {
  cache.clear();
}

function cacheKey(adapter: SupplierAdapter, r: InventorySearchRequest): string {
  return [adapter.id, r.category, r.keyword.trim().toLowerCase(), r.startDate ?? "", r.currency].join("|");
}

function remember(key: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
}

async function runAdapter(
  adapter: SupplierAdapter,
  request: InventorySearchRequest,
  timeoutMs: number,
  useCache: boolean,
  disabled: ReadonlySet<string> | undefined,
  onOutcome: SearchOptions["onOutcome"]
): Promise<{ outcome: SupplierOutcome; items: InventoryItem[] }> {
  const started = Date.now();
  const done = (outcome: Omit<SupplierOutcome, "supplier" | "latencyMs">, items: InventoryItem[] = []) => {
    const full: SupplierOutcome = { supplier: adapter.id, latencyMs: Date.now() - started, ...outcome };
    // Only suppliers that were really asked are counted; "not connected" and "switched off" are not calls.
    if (onOutcome && ["OK", "TIMEOUT", "ERROR"].includes(full.status) && !full.cached) {
      try {
        onOutcome(full, request.category);
      } catch {
        // counting must never break a search
      }
    }
    return { outcome: full, items };
  };

  if (!adapter.categories.includes(request.category)) {
    return done({ status: "UNSUPPORTED", itemCount: 0, message: `${adapter.displayName} does not sell ${request.category}.` });
  }
  if (disabled?.has(adapter.id)) {
    return done({ status: "DISABLED", itemCount: 0, message: `${adapter.displayName} is switched off by the administrator.` });
  }
  if (!adapter.isConfigured()) {
    return done({ status: "NOT_CONFIGURED", itemCount: 0, message: adapter.notConfiguredReason() });
  }

  const key = cacheKey(adapter, request);
  if (useCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return done({ status: "OK", itemCount: hit.items.length, environment: hit.environment, cached: true, message: hit.note }, hit.items);
    }
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([adapter.search(request, controller.signal), timeout]);
    if (result === "timeout") {
      return done({ status: "TIMEOUT", itemCount: 0, message: `${adapter.displayName} did not answer within ${timeoutMs / 1000}s.` });
    }
    remember(key, { at: Date.now(), items: result.items, environment: result.environment, note: result.note });
    return done({ status: "OK", itemCount: result.items.length, environment: result.environment, message: result.note }, result.items);
  } catch (error) {
    if (controller.signal.aborted) {
      return done({ status: "TIMEOUT", itemCount: 0, message: `${adapter.displayName} did not answer within ${timeoutMs / 1000}s.` });
    }
    // Upstream error text can contain request details; log it server-side, show a generic message.
    console.error(`[suppliers] ${adapter.id} search failed:`, error instanceof Error ? error.message : error);
    return done({ status: "ERROR", itemCount: 0, message: `${adapter.displayName} returned an error.` });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rank(items: InventoryItem[], sort: SortMode): InventoryItem[] {
  const copy = [...items];
  if (sort === "price") {
    // Items without a price go last; they are not "free".
    return copy.sort((a, b) => (a.price?.amountMinor ?? Infinity) - (b.price?.amountMinor ?? Infinity));
  }
  if (sort === "rating") {
    return copy.sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
    );
  }
  // relevance: keep each supplier's own ordering, interleaving suppliers round-robin.
  const buckets = new Map<string, InventoryItem[]>();
  for (const item of copy) buckets.set(item.supplier, [...(buckets.get(item.supplier) ?? []), item]);
  const out: InventoryItem[] = [];
  const lists = [...buckets.values()];
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length) out.push(l[i]);
  }
  return out;
}

/**
 * Query every adapter that sells the category in parallel. One supplier failing or timing out never
 * affects the others; each supplier's status is reported so callers can say what was and was not searched.
 */
export async function searchInventory(
  request: InventorySearchRequest,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const adapters = options.adapters ?? adaptersForCategory(request.category);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const results = await Promise.all(
    adapters.map((a) => runAdapter(a, request, timeoutMs, options.useCache ?? true, options.disabled, options.onOutcome))
  );

  let items = results.flatMap((r) => r.items);
  if (options.maxPriceMinor !== undefined) {
    const max = options.maxPriceMinor;
    // Only items with a known price in the requested currency can be compared with a budget.
    items = items.filter((i) => i.price && i.price.currency === request.currency && i.price.amountMinor <= max);
  }
  items = rank(items, options.sort ?? "relevance");
  if (request.limit) items = items.slice(0, request.limit);

  return {
    items,
    suppliers: results.map((r) => r.outcome),
    liveInventory: items.some((i) => i.dataStatus === "LIVE"),
    checkedAt: new Date().toISOString(),
  };
}
