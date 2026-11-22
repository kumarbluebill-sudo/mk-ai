import { describe, expect, it, vi } from "vitest";
import { runAgent, buildSystemPrompt } from "./agent";
import { emptyState, type ToolContext } from "./tools";
import type { AiProvider, CompletionRequest, CompletionResponse } from "./types";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    tenantId: "t1",
    userId: "u1",
    role: "CONSULTANT",
    conversationId: "c1",
    db: { aiUsage: { create: vi.fn().mockResolvedValue({}) } } as unknown as ToolContext["db"],
    state: emptyState(),
    ...overrides,
  };
}

const usage = { inputTokens: 10, outputTokens: 5 };
const base = { provider: "mock", model: "mock-1", usage };
const provider = { name: "mock", model: "mock-1" } as AiProvider;

function scripted(responses: Partial<CompletionResponse>[]) {
  const seen: CompletionRequest[] = [];
  let i = 0;
  const complete = vi.fn(async (_p: AiProvider[], req: CompletionRequest): Promise<CompletionResponse> => {
    seen.push(JSON.parse(JSON.stringify({ ...req, signal: undefined })));
    return { text: "", toolCalls: [], ...base, ...responses[i++] };
  });
  return { complete, seen };
}

describe("runAgent", () => {
  it("returns plain text when the model calls no tools", async () => {
    const { complete } = scripted([{ text: "Hello! Where to?" }]);
    const result = await runAgent({ providers: [provider], ctx: makeCtx(), history: [], userMessage: "hi", complete });
    expect(result.text).toBe("Hello! Where to?");
    expect(result.hitStepLimit).toBe(false);
  });

  it("executes a tool, feeds the result back, then answers", async () => {
    const events: string[] = [];
    const { complete, seen } = scripted([
      { toolCalls: [{ id: "call1", name: "search_destinations", input: { query: "bali" } }] },
      { text: "Bali looks great." },
    ]);
    const result = await runAgent({
      providers: [provider],
      ctx: makeCtx(),
      history: [],
      userMessage: "bali?",
      complete,
      onEvent: (e) => events.push(`${e.type}:${e.name}`),
    });
    expect(result.text).toBe("Bali looks great.");
    expect(events).toEqual(["tool_start:search_destinations", "tool_result:search_destinations"]);
    const toolMsg = seen[1].messages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ toolCallId: "call1", isError: false });
    expect(toolMsg && "content" in toolMsg && toolMsg.content).toContain("editorial-catalogue");
  });

  it("returns tool errors to the model instead of throwing", async () => {
    const { complete, seen } = scripted([
      { toolCalls: [{ id: "c", name: "no_such_tool", input: {} }] },
      { text: "Sorry, that isn't available." },
    ]);
    const result = await runAgent({ providers: [provider], ctx: makeCtx(), history: [], userMessage: "x", complete });
    expect(result.text).toContain("isn't available");
    expect(seen[1].messages.at(-1)).toMatchObject({ role: "tool", isError: true });
  });

  it("stops at the step limit with an honest message", async () => {
    const loop = { toolCalls: [{ id: "c", name: "search_destinations", input: {} }] };
    const { complete } = scripted(Array(10).fill(loop));
    const result = await runAgent({ providers: [provider], ctx: makeCtx(), history: [], userMessage: "x", complete, maxSteps: 3 });
    expect(result.hitStepLimit).toBe(true);
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("records token usage for the tenant", async () => {
    const ctx = makeCtx();
    const { complete } = scripted([{ text: "ok" }]);
    await runAgent({ providers: [provider], ctx, history: [], userMessage: "x", complete });
    expect(ctx.db.aiUsage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: "t1", userId: "u1", inputTokens: 10, outputTokens: 5 }),
    });
  });

  it("does not fail the chat if usage logging fails", async () => {
    const ctx = makeCtx({
      db: { aiUsage: { create: vi.fn().mockRejectedValue(new Error("db down")) } } as unknown as ToolContext["db"],
    });
    const { complete } = scripted([{ text: "ok" }]);
    await expect(runAgent({ providers: [provider], ctx, history: [], userMessage: "x", complete })).resolves.toMatchObject({
      text: "ok",
    });
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { complete } = scripted([{ text: "never" }]);
    await expect(
      runAgent({ providers: [provider], ctx: makeCtx(), history: [], userMessage: "x", complete, signal: controller.signal })
    ).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("system prompt", () => {
  it("forbids fake bookings and live claims", () => {
    const p = buildSystemPrompt(new Date("2026-11-21T00:00:00Z"));
    expect(p).toContain("2026-11-21");
    expect(p).toMatch(/Never invent availability/);
    expect(p).toMatch(/cannot book/);
    expect(p).toMatch(/sandbox/);
  });
});

describe("buildSystemPrompt tour programme workflow", () => {
  it("never lets the model invent hotels or assume a tax rate", () => {
    const prompt = buildSystemPrompt(new Date("2026-11-22"));
    expect(prompt).toMatch(/NO live hotel inventory/);
    expect(prompt).toMatch(/Do not invent hotel names/);
    expect(prompt).toMatch(/never assume a statutory rate/);
    expect(prompt).toMatch(/check_availability/);
  });
});
