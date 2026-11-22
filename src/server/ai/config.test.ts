import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { validateBaseUrl } from "./catalog";
import {
  AiConfigError,
  buildProvider,
  clearProviderCache,
  estimateCostMicros,
  listProviders,
  resolveProviders,
  saveProvider,
  scrub,
  testProvider,
  usageSummary,
} from "./config";
import type { AiProvider } from "./types";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

interface Row {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  encryptedKey: string | null;
  keyLast4: string | null;
  enabled: boolean;
  priority: number;
  inputPricePerM: number | null;
  outputPricePerM: number | null;
  lastCheckAt: Date | null;
  lastSuccessAt: Date | null;
  useAsFallback: boolean;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
  lastLatencyMs: number | null;
  createdAt: Date;
}

function fakeDb(usage: unknown[] = []) {
  const rows: Row[] = [];
  const db = {
    aiProviderConfig: {
      findMany: async (args?: { where?: { enabled?: boolean } }) =>
        rows.filter((r) => args?.where?.enabled === undefined || r.enabled === args.where.enabled).sort((a, b) => a.priority - b.priority),
      findUnique: async ({ where }: { where: { provider: string } }) => rows.find((r) => r.provider === where.provider) ?? null,
      upsert: async ({ where, create, update }: { where: { provider: string }; create: Partial<Row>; update: Partial<Row> }) => {
        const found = rows.find((r) => r.provider === where.provider);
        if (found) return Object.assign(found, update);
        const row = { id: `r${rows.length}`, lastCheckAt: null, lastCheckOk: null, lastCheckMessage: null, lastLatencyMs: null, createdAt: new Date(), keyLast4: null, encryptedKey: null, ...create } as Row;
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { provider: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.provider === where.provider) as Row, data),
      deleteMany: async ({ where }: { where: { provider: string } }) => {
        const before = rows.length;
        const i = rows.findIndex((r) => r.provider === where.provider);
        if (i >= 0) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
    aiUsage: { groupBy: async (args: { by: string[] }) => (args.by.includes("errorCategory") ? [{ provider: "groq", errorCategory: "TIMEOUT", _count: { _all: 2 } }] : usage) },
  };
  return { db: db as unknown as Pick<PrismaClient, "aiProviderConfig" | "aiUsage">, rows };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  clearProviderCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const save = (over: Record<string, unknown> = {}) => ({ provider: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk_secretsecretsecret1234", enabled: true, priority: 100, ...over }) as Parameters<typeof saveProvider>[0];

describe("base URL rules", () => {
  it("accepts normal https endpoints and refuses credentials, metadata addresses and odd schemes", () => {
    expect(validateBaseUrl("groq", "https://api.groq.com/openai/v1").ok).toBe(true);
    expect(validateBaseUrl("groq", "https://user:pw@api.groq.com").ok).toBe(false);
    expect(validateBaseUrl("groq", "http://169.254.169.254/latest").ok).toBe(false);
    expect(validateBaseUrl("groq", "ftp://example.com").ok).toBe(false);
    expect(validateBaseUrl("groq", "not a url").ok).toBe(false);
    expect(validateBaseUrl("groq", "http://example.com/v1").ok).toBe(false); // remote must be https
  });
  it("allows localhost only for Ollama", () => {
    expect(validateBaseUrl("ollama", "http://localhost:11434/v1").ok).toBe(true);
    expect(validateBaseUrl("openai", "http://localhost:11434/v1").ok).toBe(false);
  });
});

describe("saving providers", () => {
  it("stores the key encrypted, remembers only the last 4 characters and never returns the key", async () => {
    const { db, rows } = fakeDb();
    const row = await saveProvider(save(), db);
    expect(rows[0].encryptedKey).toMatch(/^v1:/);
    expect(rows[0].encryptedKey).not.toContain("secretsecret");
    expect(row.keyLast4).toBe("1234");
    const listed = JSON.stringify(await listProviders(db));
    expect(listed).not.toContain("secretsecret");
    expect(listed).not.toContain("v1:");
  });

  it("keeps the saved key when the key field is left blank, and replaces it when a new one is given", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(save(), db);
    const first = rows[0].encryptedKey;
    await saveProvider(save({ apiKey: "", model: "other-model" }), db);
    expect(rows[0].encryptedKey).toBe(first);
    expect(rows[0].model).toBe("other-model");
    await saveProvider(save({ apiKey: "gsk_anotherkeyanotherkey9999" }), db);
    expect(rows[0].encryptedKey).not.toBe(first);
    expect(rows[0].keyLast4).toBe("9999");
  });

  it("requires a key for hosted providers but not for Ollama, and rejects a bad base URL", async () => {
    const { db } = fakeDb();
    await expect(saveProvider(save({ apiKey: undefined }), db)).rejects.toThrow(AiConfigError);
    await expect(saveProvider(save({ provider: "ollama", apiKey: undefined, model: "llama3.1", baseUrl: "http://localhost:11434/v1" }), db)).resolves.toMatchObject({ provider: "ollama" });
    await expect(saveProvider(save({ baseUrl: "http://169.254.169.254" }), db)).rejects.toThrow(AiConfigError);
  });

  it("lists every known provider, configured or not", async () => {
    const { db } = fakeDb();
    const all = await listProviders(db);
    expect(all.map((p) => p.provider)).toEqual(["anthropic", "openai", "gemini", "mistral", "deepseek", "groq", "openrouter", "ollama", "freellmapi"]);
    expect(all.every((p) => p.enabled === false && !p.hasKey)).toBe(true);
  });
});

describe("provider requests", () => {
  function stubFetch(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), auth: headers.get("authorization") });
        return handler(String(url), init ?? {});
      })
    );
    return calls;
  }
  const ok = () =>
    new Response(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("sends Groq-style providers to their own base URL with max_tokens, and OpenAI with max_completion_tokens", async () => {
    const calls = stubFetch(ok);
    const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [], maxTokens: 50 };
    const groq = buildProvider({ provider: "groq", model: "m", apiKey: "k-groq" });
    const r = await groq.complete(req);
    expect(r.provider).toBe("groq");
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0].body.max_tokens).toBe(50);
    expect(calls[0].body.max_completion_tokens).toBeUndefined();
    expect(calls[0].body.tools).toBeUndefined(); // empty tool lists are not sent
    expect(calls[0].auth).toBe("Bearer k-groq");

    await buildProvider({ provider: "openai", model: "m", apiKey: "k-oa" }).complete(req);
    expect(calls[1].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[1].body.max_completion_tokens).toBe(50);
  });

  it("uses a custom base URL, and each OpenAI-compatible provider gets its documented default", async () => {
    const calls = stubFetch(ok);
    const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], tools: [], maxTokens: 5 };
    await buildProvider({ provider: "ollama", model: "llama3.1", apiKey: "", baseUrl: "http://localhost:11434/v1" }).complete(req);
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    for (const id of ["gemini", "mistral", "deepseek", "openrouter"] as const) await buildProvider({ provider: id, model: "m", apiKey: "k" }).complete(req);
    expect(calls.slice(1).map((c) => new URL(c.url).host)).toEqual(["generativelanguage.googleapis.com", "api.mistral.ai", "api.deepseek.com", "openrouter.ai"]);
  });
});

const modelsOk = vi.fn(async () => new Response(JSON.stringify({ object: "list", data: [{ id: "llama-3.3-70b-versatile" }, { id: "other" }] }), { status: 200 })) as unknown as typeof fetch;

describe("testing a provider", () => {
  it("records a working provider with its latency", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(save(), db);
    const fake = { name: "groq", model: "m", complete: vi.fn().mockResolvedValue({ text: "OK", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "groq", model: "m" }) } as unknown as AiProvider;
    const h = await testProvider("groq", db, () => fake, modelsOk);
    expect(h.ok).toBe(true);
    expect(h.message).toContain("Connection successful");
    expect(rows[0].lastSuccessAt).toBeInstanceOf(Date);
    expect(rows[0].lastCheckOk).toBe(true);
    expect(rows[0].lastLatencyMs).not.toBeNull();
  });

  it("records a failure with the key scrubbed out of the message", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(save(), db);
    const fake = { name: "groq", model: "m", complete: vi.fn().mockRejectedValue(Object.assign(new Error("401 invalid key gsk_secretsecretsecret1234 for Bearer abcdefghijkl"), { status: 401 })) } as unknown as AiProvider;
    const h = await testProvider("groq", db, () => fake, modelsOk);
    expect(h.ok).toBe(false);
    expect(h.category).toBe("AUTH");
    // The message is built from the category and status only, so no part of the provider's text (or the key) can reach it.
    expect(rows[0].lastCheckMessage).not.toMatch(/secretsecret|abcdefghijkl/);
  });

  it("explains a key that cannot be decrypted instead of crashing", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(save(), db);
    process.env.ENCRYPTION_KEY = "ff".repeat(32);
    const h = await testProvider("groq", db);
    expect(h.ok).toBe(false);
    expect(h.message).toMatch(/ENCRYPTION_KEY/);
    expect(rows[0].lastCheckOk).toBe(false);
  });

  it("changing the key or model clears the earlier health result", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(save(), db);
    rows[0].lastCheckOk = true;
    await saveProvider(save({ apiKey: "", model: "different" }), db);
    expect(rows[0].lastCheckOk).toBeNull();
  });
});

describe("resolving providers for chat", () => {
  const env = (name: string): AiProvider => ({ name, model: "env-model", complete: vi.fn() }) as unknown as AiProvider;

  it("puts enabled saved providers first by priority and skips disabled ones; environment providers are not mixed in", async () => {
    const { db } = fakeDb();
    await saveProvider(save({ provider: "groq", priority: 20 }), db);
    await saveProvider(save({ provider: "mistral", model: "ml", priority: 10 }), db);
    await saveProvider(save({ provider: "deepseek", model: "dc", priority: 5, enabled: false }), db);
    const list = await resolveProviders(() => [env("groq"), env("openai")], {} as NodeJS.ProcessEnv, db);
    expect(list.map((p) => p.name)).toEqual(["mistral", "groq"]);
    expect(list.find((p) => p.name === "groq")?.model).toBe("llama-3.3-70b-versatile");
  });

  it("uses environment providers only while nothing usable is saved", async () => {
    const { db } = fakeDb();
    expect((await resolveProviders(() => [env("openai")], {} as NodeJS.ProcessEnv, db)).map((p) => p.name)).toEqual(["openai"]);
  });

  it("a provider with fallback switched off is never used behind the primary, but can be the primary itself", async () => {
    const { db } = fakeDb();
    await saveProvider(save({ provider: "mistral", model: "ml", priority: 10 }), db);
    await saveProvider(save({ provider: "groq", priority: 20, useAsFallback: false }), db);
    await saveProvider(save({ provider: "deepseek", model: "dc", priority: 30, useAsFallback: true }), db);
    expect((await resolveProviders(() => [], {} as NodeJS.ProcessEnv, db)).map((p) => p.name)).toEqual(["mistral", "deepseek"]);
    clearProviderCache();
    await saveProvider(save({ provider: "mistral", model: "ml", priority: 30, apiKey: "" }), db);
    await saveProvider(save({ provider: "groq", priority: 5, useAsFallback: false }), db);
    expect((await resolveProviders(() => [], {} as NodeJS.ProcessEnv, db)).map((p) => p.name)[0]).toBe("groq");
  });

  it("uses the environment alone when the settings table cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { aiProviderConfig: { findMany: async () => { throw new Error("relation does not exist"); } } } as unknown as Pick<PrismaClient, "aiProviderConfig">;
    const list = await resolveProviders(() => [env("anthropic")], {} as NodeJS.ProcessEnv, broken);
    expect(list.map((p) => p.name)).toEqual(["anthropic"]);
  });

  it("skips a provider whose key cannot be decrypted without losing the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, rows } = fakeDb();
    await saveProvider(save({ provider: "groq" }), db);
    await saveProvider(save({ provider: "mistral", model: "ml" }), db);
    rows[0].encryptedKey = "v1:bad:bad:bad";
    const list = await resolveProviders(() => [], {} as NodeJS.ProcessEnv, db);
    expect(list.map((p) => p.name)).toEqual(["mistral"]);
  });
});

describe("cost and usage", () => {
  it("estimates cost only from prices the admin entered", () => {
    expect(estimateCostMicros(undefined, 1000, 1000)).toBeNull();
    // 3 per million input, 15 per million output: 2000 in + 1000 out = 6000 + 15000 micros
    expect(estimateCostMicros({ inputPerM: 3, outputPerM: 15 }, 2000, 1000)).toBe(21000);
  });

  it("scrubs keys from messages", () => {
    expect(scrub("bad key sk-abcdefghijklmnop here")).not.toContain("abcdefghijklmnop");
    expect(scrub("echo mykeyvalue123", "mykeyvalue123")).toBe("echo [key]");
  });

  it("summarises calls, failures, tokens and speed per provider, with a cost only for priced providers", async () => {
    const groups = [
      { provider: "groq", ok: true, _count: { _all: 8 }, _sum: { inputTokens: 8000, outputTokens: 2000, costMicros: 50000 }, _avg: { latencyMs: 400 } },
      { provider: "groq", ok: false, _count: { _all: 2 }, _sum: { inputTokens: 0, outputTokens: 0, costMicros: null }, _avg: { latencyMs: 1000 } },
      { provider: "openai", ok: true, _count: { _all: 1 }, _sum: { inputTokens: 10, outputTokens: 5, costMicros: null }, _avg: { latencyMs: 700 } },
    ];
    const { db } = fakeDb(groups);
    await saveProvider(save({ inputPricePerM: 1, outputPricePerM: 2 }), db);
    const rows = await usageSummary(30, db);
    const groq = rows.find((r) => r.provider === "groq");
    expect(groq).toMatchObject({ calls: 10, failures: 2, inputTokens: 8000, outputTokens: 2000, avgLatencyMs: 520, errorCategories: { TIMEOUT: 2 } });
    expect(groq?.estimatedCost).toBe(0.05);
    expect(rows.find((r) => r.provider === "openai")?.estimatedCost).toBeNull();
  });
});
