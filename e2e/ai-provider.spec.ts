import { expect, test } from "@playwright/test";
import { api, json, newAgency, newPlatformAdmin } from "./helpers";

/**
 * FreeLLMAPI and the provider chain, against a gateway address where nothing is listening. This proves the error
 * paths with the real servers and database. It does NOT prove a working connection: that needs a running FreeLLMAPI
 * (see the changelog for the manual check).
 */
test.describe("FreeLLMAPI provider settings", () => {
  test("down server: models and test say so plainly, chat shows a clear error, and a provider that opted out of fallback is never called", async () => {
    const admin = await newPlatformAdmin();
    const agency = await newAgency("aichat");
    const dead = "http://127.0.0.1:59999/v1"; // nothing listens here (port 9 is blocked by fetch itself)

    try {
      // Closed to everyone else.
      expect((await agency.ctx.get("/api/admin/ai/freellmapi/models")).status()).toBe(403);
      expect((await (await api()).get("/api/admin/ai/freellmapi/models")).status()).toBe(401);
      // Not saved yet: a clear 404, not a crash.
      expect((await admin.ctx.get("/api/admin/ai/freellmapi/models")).status()).toBe(404);
      expect((await admin.ctx.get("/api/admin/ai/nonsense/models")).status()).toBe(404);

      // Save FreeLLMAPI as the primary and a second provider that must never be used as a fallback.
      const saved = await admin.ctx.post("/api/admin/ai", { data: { provider: "freellmapi", model: "auto", baseUrl: dead, apiKey: "flm_e2e_key_0000_abcd", enabled: true, priority: 1, useAsFallback: true } });
      expect(saved.status()).toBe(200);
      const text = await saved.text();
      expect(text).not.toContain("flm_e2e_key_0000_abcd");
      expect((await admin.ctx.post("/api/admin/ai", { data: { provider: "groq", model: "llama", baseUrl: "https://unreachable.invalid/v1", apiKey: "gsk_e2e_key_0000_wxyz", enabled: true, priority: 2, useAsFallback: false } })).status()).toBe(200);

      const list = await json<{ providers: { provider: string; isPrimary: boolean; useAsFallback: boolean; baseUrl: string | null }[] }>(await admin.ctx.get("/api/admin/ai"));
      expect(list.providers.find((p) => p.provider === "freellmapi")).toMatchObject({ isPrimary: true, baseUrl: dead });
      expect(list.providers.find((p) => p.provider === "groq")).toMatchObject({ isPrimary: false, useAsFallback: false });

      // The models listing and the connection test report the real failure, never a success.
      const models = await json<{ ok: boolean; category?: string; message?: string }>(await admin.ctx.get("/api/admin/ai/freellmapi/models"));
      expect(models).toMatchObject({ ok: false, category: "UNAVAILABLE" });
      expect(models.message).toMatch(/Server unavailable/);
      const tested = await json<{ health: { ok: boolean; category: string; message: string } }>(await admin.ctx.post("/api/admin/ai/freellmapi/test"));
      expect(tested.health).toMatchObject({ ok: false, category: "UNAVAILABLE" });
      const after = await json<{ providers: { provider: string; health: { ok: boolean | null }; lastSuccessAt: string | null }[] }>(await admin.ctx.get("/api/admin/ai"));
      expect(after.providers.find((p) => p.provider === "freellmapi")).toMatchObject({ health: { ok: false }, lastSuccessAt: null });

      // Chat: a clear error, once, and no scripted text posing as an AI answer.
      const chat = await agency.ctx.post("/api/chat", { data: { message: "Plan 3 days in Dubai for 2 adults" } });
      expect(chat.status()).toBe(200);
      const events = (await chat.text()).split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as { type: string; message?: string; content?: string });
      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/AI service is unavailable.*could not be reached/);
      expect(events.some((e) => e.type === "message")).toBe(false);

      // Usage shows the failed FreeLLMAPI attempt by cause, and nothing for the provider that opted out of fallback.
      await new Promise((r) => setTimeout(r, 500));
      const usage = await json<{ usage: { provider: string; failures: number; errorCategories: Record<string, number> }[] }>(await admin.ctx.get("/api/admin/ai"));
      expect(usage.usage.find((u) => u.provider === "freellmapi")).toMatchObject({ failures: expect.any(Number), errorCategories: { UNAVAILABLE: expect.any(Number) } });
      expect(usage.usage.find((u) => u.provider === "groq")).toBeUndefined();
    } finally {
      await admin.ctx.delete("/api/admin/ai/freellmapi");
      await admin.ctx.delete("/api/admin/ai/groq");
    }
  });
});
