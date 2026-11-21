import { describe, expect, it, vi } from "vitest";
import { toAnthropicMessages } from "./anthropic";
import { toOpenAIMessages } from "./openai";
import { completeWithFallback, getConfiguredProviders } from "./providers";
import { AiNotConfiguredError, type AiProvider, type ChatMessage } from "./types";

const conversation: ChatMessage[] = [
  { role: "user", content: "Find safaris" },
  { role: "assistant", content: "Searching", toolCalls: [{ id: "a", name: "search_activities", input: { keyword: "safari" } }, { id: "b", name: "search_destinations", input: {} }] },
  { role: "tool", toolCallId: "a", name: "search_activities", content: "{}" },
  { role: "tool", toolCallId: "b", name: "search_destinations", content: "{}", isError: true },
];

describe("provider selection", () => {
  it("returns no providers without keys", () => {
    expect(getConfiguredProviders({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("orders primary then fallback and skips unconfigured ones", () => {
    const env = {
      AI_PROVIDER: "anthropic", AI_FALLBACK_PROVIDER: "openai", ANTHROPIC_API_KEY: "k1", OPENAI_API_KEY: "k2",
      ANTHROPIC_MODEL: "m-a",
    } as unknown as NodeJS.ProcessEnv;
    expect(getConfiguredProviders(env).map((p) => [p.name, p.model])).toEqual([["anthropic", "m-a"], ["openai", "gpt-4o"]]);
    expect(getConfiguredProviders({ ...env, ANTHROPIC_API_KEY: "" } as NodeJS.ProcessEnv).map((p) => p.name)).toEqual(["openai"]);
  });
});

describe("completeWithFallback", () => {
  const ok = { text: "hi", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "b", model: "m" };
  const req = { system: "s", messages: [], tools: [], maxTokens: 10 };

  it("throws AiNotConfiguredError with no providers", async () => {
    await expect(completeWithFallback([], req)).rejects.toThrow(AiNotConfiguredError);
  });

  it("falls back to the next provider on failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = { name: "a", model: "m", complete: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as AiProvider;
    const b = { name: "b", model: "m", complete: vi.fn().mockResolvedValue(ok) } as unknown as AiProvider;
    await expect(completeWithFallback([a, b], req)).resolves.toMatchObject({ provider: "b" });
  });

  it("throws the last error when all providers fail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = { name: "a", model: "m", complete: vi.fn().mockRejectedValue(new Error("one")) } as unknown as AiProvider;
    await expect(completeWithFallback([a], req)).rejects.toThrow("one");
  });
});

describe("message conversion", () => {
  it("anthropic: tool results are merged into one user turn", () => {
    const out = toAnthropicMessages(conversation);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const results = out[2].content as { type: string; tool_use_id: string; is_error?: boolean }[];
    expect(results.map((r) => [r.type, r.tool_use_id, r.is_error])).toEqual([
      ["tool_result", "a", undefined],
      ["tool_result", "b", true],
    ]);
    const assistant = out[1].content as { type: string }[];
    expect(assistant.map((b) => b.type)).toEqual(["text", "tool_use", "tool_use"]);
  });

  it("openai: system first, tool calls as JSON strings, one tool message per result", () => {
    const out = toOpenAIMessages("SYS", conversation);
    expect(out.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    const assistant = out[2] as { tool_calls: { function: { arguments: string } }[] };
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ keyword: "safari" });
  });
});
