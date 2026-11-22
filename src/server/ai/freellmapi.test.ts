import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { validateBaseUrl } from "./catalog";
import { clearProviderCache, fetchModels, listModels, saveProvider, testProvider } from "./config";
import { AiProviderUnavailableError, classifyAiError, unavailableMessage } from "./errors";
import { routingFrom } from "./openai";
import { completeWithFallback, getConfiguredProviders } from "./providers";
import type { AiProvider } from "./types";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

type Row = Record<string, unknown> & { provider: string };

function fakeDb() {
  const rows: Row[] = [];
  const db = {
    aiProviderConfig: {
      findUnique: async ({ where }: { where: { provider: string } }) => rows.find((r) => r.provider === where.provider) ?? null,
      findMany: async () => rows,
      upsert: async ({ where, create, update }: { where: { provider: string }; create: Row; update: Row }) => {
        const found = rows.find((r) => r.provider === where.provider);
        if (found) return Object.assign(found, update);
        const row = { id: "x", lastCheckAt: null, lastCheckOk: null, lastCheckMessage: null, lastLatencyMs: null, lastSuccessAt: null, keyLast4: null, encryptedKey: null, createdAt: new Date(), ...create };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { provider: string }; data: Row }) => Object.assign(rows.find((r) => r.provider === where.provider) as Row, data),
    },
  };
  return { db: db as unknown as Pick<PrismaClient, "aiProviderConfig" | "aiUsage">, rows };
}

const free = (over: Record<string, unknown> = {}) => ({ provider: "freellmapi", model: "auto", apiKey: "flm_secret_secret_1234", enabled: true, useAsFallback: true, priority: 100, ...over }) as Parameters<typeof saveProvider>[0];
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const models = (ids: string[]) => json({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  clearProviderCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FreeLLMAPI provider entry", () => {
  it("defaults to the local gateway, model auto, and may use localhost", () => {
    expect(validateBaseUrl("freellmapi", "http://localhost:3001/v1").ok).toBe(true);
    expect(validateBaseUrl("freellmapi", "https://gateway.example.com/v1").ok).toBe(true);
    expect(validateBaseUrl("freellmapi", "http://gateway.example.com/v1").ok).toBe(false); // remote must be https
    expect(validateBaseUrl("freellmapi", "http://169.254.169.254/v1").ok).toBe(false);
    expect(validateBaseUrl("openai", "http://localhost:3001/v1").ok).toBe(false);
  });

  it("is built from environment variables with the documented defaults", () => {
    const env = { AI_PROVIDER: "freellmapi", FREELLMAPI_API_KEY: "k" } as unknown as NodeJS.ProcessEnv;
    const p = getConfiguredProviders(env)[0];
    expect(p).toMatchObject({ name: "freellmapi", model: "auto" });
    expect(getConfiguredProviders({ AI_PROVIDER: "freellmapi" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("sends chat requests to the gateway with a bearer key and max_tokens, and reports the model that answered", async () => {
    const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) });
        return json(
          { id: "1", object: "chat.completion", created: 1, model: "real-model-7b", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "OK" } }], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } },
          200,
          { "x-freellm-provider": "upstream-one", "x-unrelated": "ignore me" }
        );
      })
    );
    const p = getConfiguredProviders({ AI_PROVIDER: "freellmapi", FREELLMAPI_API_KEY: "flm_key", FREELLMAPI_BASE_URL: "http://localhost:3001/v1" } as unknown as NodeJS.ProcessEnv)[0];
    const r = await p.complete({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [], maxTokens: 20 });
    expect(calls[0].url).toBe("http://localhost:3001/v1/chat/completions");
    expect(calls[0].auth).toBe("Bearer flm_key");
    expect(calls[0].body).toMatchObject({ model: "auto", max_tokens: 20 });
    expect(r.model).toBe("real-model-7b");
    expect(r.routing).toEqual({ "x-freellm-provider": "upstream-one" });
    expect(r.usage).toEqual({ inputTokens: 4, outputTokens: 1 });
  });

  it("keeps only short routing details that are actually present", () => {
    expect(routingFrom(new Headers({ "x-request-id": "abc" }), {})).toBeUndefined();
    expect(routingFrom(new Headers({ "x-route-model": "m1" }), { provider: "up" })).toEqual({ "x-route-model": "m1", "body.provider": "up" });
    expect(routingFrom(new Headers({ "x-served-by": "y".repeat(500) }), {})?.["x-served-by"]).toHaveLength(100);
  });
});

describe("error classification", () => {
  it("reads status codes, names and network codes, never message text", () => {
    expect(classifyAiError(Object.assign(new Error("x"), { status: 401 }))).toBe("AUTH");
    expect(classifyAiError(Object.assign(new Error("x"), { status: 403 }))).toBe("AUTH");
    expect(classifyAiError(Object.assign(new Error("x"), { status: 429 }))).toBe("RATE_LIMIT");
    expect(classifyAiError(Object.assign(new Error("x"), { status: 503 }))).toBe("UNAVAILABLE");
    expect(classifyAiError(Object.assign(new Error("model not found"), { status: 404 }))).toBe("INVALID_MODEL");
    expect(classifyAiError(Object.assign(new Error("The model `x` does not exist"), { status: 400 }))).toBe("INVALID_MODEL");
    expect(classifyAiError(Object.assign(new Error("bad request"), { status: 400 }))).toBe("OTHER");
    expect(classifyAiError(Object.assign(new Error("x"), { name: "APIConnectionTimeoutError" }))).toBe("TIMEOUT");
    expect(classifyAiError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("TIMEOUT");
    expect(classifyAiError(Object.assign(new Error("x"), { name: "APIConnectionError" }))).toBe("UNAVAILABLE");
    expect(classifyAiError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("UNAVAILABLE");
    expect(classifyAiError(new Error("401 unauthorized in the text only"))).toBe("OTHER");
    expect(classifyAiError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }))).toBe("UNAVAILABLE");
    expect(classifyAiError("a string")).toBe("OTHER");
  });
});

describe("model discovery", () => {
  it("returns the ids the server really lists, sorted and de-duplicated, with the bearer key", async () => {
    let seen: { url: string; auth: string | null } | null = null;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init?.headers).get("authorization") };
      return models(["zeta", "alpha", "alpha"]);
    }) as unknown as typeof fetch;
    const r = await fetchModels("http://localhost:3001/v1/", "flm_key", fetchFn);
    expect(r).toEqual({ ok: true, models: ["alpha", "zeta"] });
    expect(seen).toEqual({ url: "http://localhost:3001/v1/models", auth: "Bearer flm_key" });
  });

  it("explains each way it can fail", async () => {
    const answer = (status: number) => (vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch);
    expect(await fetchModels("http://x/v1", "k", answer(401))).toMatchObject({ ok: false, category: "AUTH", message: expect.stringMatching(/Authentication failed/) });
    expect(await fetchModels("http://x/v1", "k", answer(429))).toMatchObject({ ok: false, category: "RATE_LIMIT" });
    expect(await fetchModels("http://x/v1", "k", answer(502))).toMatchObject({ ok: false, category: "UNAVAILABLE", message: expect.stringMatching(/Server unavailable/) });
    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    expect(await fetchModels("http://x/v1", "k", refused)).toMatchObject({ ok: false, category: "UNAVAILABLE" });
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect(await fetchModels("http://x/v1", "k", timeout)).toMatchObject({ ok: false, category: "TIMEOUT", message: expect.stringMatching(/timed out/) });
    const junk = vi.fn(async () => json({ nothing: true })) as unknown as typeof fetch;
    expect(await fetchModels("http://x/v1", "k", junk)).toMatchObject({ ok: false, category: "BAD_RESPONSE" });
  });

  it("lists models for a saved provider using its stored key and base URL", async () => {
    const { db } = fakeDb();
    await saveProvider(free({ baseUrl: "http://localhost:3001/v1" }), db);
    let auth: string | null = null;
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return models(["auto-x", "m2"]);
    }) as unknown as typeof fetch;
    expect(await listModels("freellmapi", db, fetchFn)).toEqual({ ok: true, models: ["auto-x", "m2"] });
    expect(auth).toBe("Bearer flm_secret_secret_1234");
    await expect(listModels("groq", db, fetchFn)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listModels("anthropic", db, fetchFn)).toMatchObject({ ok: false });
  });
});

describe("connection test", () => {
  const completes = (text = "OK", model = "served-model") => ({ name: "freellmapi", model: "auto", complete: vi.fn().mockResolvedValue({ text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "freellmapi", model }) }) as unknown as AiProvider;

  it("is successful only after the model list AND a real completion both worked, and says who answered", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(free(), db);
    const h = await testProvider("freellmapi", db, () => completes(), vi.fn(async () => models(["a", "b"])) as unknown as typeof fetch);
    expect(h).toMatchObject({ ok: true, category: null });
    expect(h.message).toMatch(/Connection successful.*2 models listed.*Answered by served-model/);
    expect(rows[0].lastSuccessAt).toBeInstanceOf(Date);
  });

  it("does not report success when authentication fails, and never reaches the completion", async () => {
    const { db, rows } = fakeDb();
    await saveProvider(free(), db);
    const provider = completes();
    const h = await testProvider("freellmapi", db, () => provider, vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    expect(h).toMatchObject({ ok: false, category: "AUTH" });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(rows[0].lastCheckOk).toBe(false);
    expect(rows[0].lastSuccessAt).toBeNull();
  });

  it("reports an unreachable server, a timeout and a rate limit in their own words", async () => {
    const { db } = fakeDb();
    await saveProvider(free(), db);
    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    expect((await testProvider("freellmapi", db, () => completes(), refused)).message).toMatch(/Server unavailable/);
    const slow = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    expect((await testProvider("freellmapi", db, () => completes(), slow)).message).toMatch(/timed out/);
    expect((await testProvider("freellmapi", db, () => completes(), vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch)).message).toMatch(/Rate limit/);
  });

  it("flags a model that is not in the server's list, but accepts auto without checking the list", async () => {
    const { db } = fakeDb();
    await saveProvider(free({ model: "ghost-model" }), db);
    const list = vi.fn(async () => models(["real-1"])) as unknown as typeof fetch;
    const bad = await testProvider("freellmapi", db, () => completes(), list);
    expect(bad).toMatchObject({ ok: false, category: "INVALID_MODEL" });
    expect(bad.message).toContain("ghost-model");
    await saveProvider(free({ model: "auto", apiKey: "" }), db);
    expect((await testProvider("freellmapi", db, () => completes(), list)).ok).toBe(true);
  });

  it("classifies a failing completion even though the model list worked", async () => {
    const { db } = fakeDb();
    await saveProvider(free(), db);
    const failing = { name: "freellmapi", model: "auto", complete: vi.fn().mockRejectedValue(Object.assign(new Error("model gone"), { status: 404 })) } as unknown as AiProvider;
    const h = await testProvider("freellmapi", db, () => failing, vi.fn(async () => models(["x"])) as unknown as typeof fetch);
    expect(h).toMatchObject({ ok: false, category: "INVALID_MODEL" });
    expect(h.message).not.toContain("model gone");
  });
});

describe("chain failure and fallback", () => {
  const req = { system: "s", messages: [], tools: [], maxTokens: 10 };
  const failing = (name: string, status: number) => ({ name, model: "m", complete: vi.fn().mockRejectedValue(Object.assign(new Error("secret request detail"), { status })) }) as unknown as AiProvider;
  const working = (name: string) => ({ name, model: "m", complete: vi.fn().mockResolvedValue({ text: "ok", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: name, model: "m" }) }) as unknown as AiProvider;

  it("moves to the fallback when the primary is down, and logs only names and the category", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await completeWithFallback([failing("freellmapi", 503), working("openai")], req);
    expect(out.provider).toBe("openai");
    const logged = log.mock.calls.map((c) => String(c[0])).join(" ");
    expect(logged).toContain("freellmapi failed (UNAVAILABLE); trying openai");
    expect(logged).not.toContain("secret request detail");
  });

  it("with no fallback in the chain, fails with a clear error and never calls anything else", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const only = failing("freellmapi", 401);
    const other = working("openai");
    const err = await completeWithFallback([only], req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderUnavailableError);
    expect((err as AiProviderUnavailableError).category).toBe("AUTH");
    expect((err as AiProviderUnavailableError).fallbackWasAvailable).toBe(false);
    expect(other.complete).not.toHaveBeenCalled();
    expect(unavailableMessage(err as AiProviderUnavailableError)).toBe("The AI service is unavailable right now (the API key was rejected). Please try again in a moment.");
  });

  it("reports every failed provider to the usage hook, and the error carries only the last category", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const err = await completeWithFallback([failing("a", 429), failing("b", 503)], req, { onFailure: (p) => seen.push(p.name) }).catch((e: unknown) => e);
    expect(seen).toEqual(["a", "b"]);
    expect((err as AiProviderUnavailableError).category).toBe("UNAVAILABLE");
    expect((err as AiProviderUnavailableError).providers).toEqual(["a", "b"]);
    expect((err as Error).message).not.toContain("secret request detail");
  });
});
