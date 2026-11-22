/**
 * Opt-in check against a RUNNING FreeLLMAPI. Skipped unless FREELLMAPI_API_KEY (and FREELLMAPI_BASE_URL) are set in the
 * shell. Run: set the two variables, then `npx vitest run src/server/ai/freellmapi.live.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { fetchModels } from "@/server/ai/config";
import { OpenAIProvider } from "@/server/ai/openai";

const key = process.env.FREELLMAPI_API_KEY ?? "";
const base = process.env.FREELLMAPI_BASE_URL ?? "http://localhost:3001/v1";
describe.skipIf(!key)("live FreeLLMAPI", () => {
  const p = new OpenAIProvider(key, "auto", { name: "freellmapi", baseURL: base, tokenParam: "max_tokens" });
  it("lists models", async () => {
    const r = await fetchModels(base, key);
    expect(r.ok).toBe(true);
  }, 30000);
  it("multi-turn + tool call", async () => {
    const tools = [{ name: "get_weather", description: "Get weather for a city", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }];
    const first = await p.complete({ system: "You are a travel assistant. Use tools when asked.", messages: [{ role: "user", content: "My name is Asha. What is the weather in Dubai? Use the tool." }], tools, maxTokens: 200 });
    expect(first.toolCalls[0]?.name).toBe("get_weather");
    const second = await p.complete({ system: "You are a travel assistant.", messages: [{ role: "user", content: "My name is Asha. Say my name." }, { role: "assistant", content: "Hi Asha!" }, { role: "user", content: "What is my name?" }], tools: [], maxTokens: 600 });
    expect(second.text.toLowerCase()).toContain("asha");
  }, 90000);
});
