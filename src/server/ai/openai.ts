import OpenAI from "openai";
import type { AiProvider, ChatMessage, CompletionRequest, CompletionResponse, ToolCall } from "./types";

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export function toOpenAIMessages(system: string, messages: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

export class OpenAIProvider implements AiProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string, readonly model: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        max_completion_tokens: request.maxTokens,
        messages: toOpenAIMessages(request.system, request.messages),
        tools: request.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      },
      { signal: request.signal }
    );

    const message = response.choices[0]?.message;
    const toolCalls: ToolCall[] = [];
    for (const call of message?.tool_calls ?? []) {
      if (call.type !== "function") continue;
      let input: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Record<string, unknown>;
      } catch {
        // Malformed arguments are surfaced to the tool layer as empty input and rejected by schema validation.
      }
      toolCalls.push({ id: call.id, name: call.function.name, input });
    }

    return {
      text: message?.content ?? "",
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      provider: this.name,
      model: this.model,
    };
  }
}
