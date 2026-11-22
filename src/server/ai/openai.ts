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

/**
 * Routing details a gateway reports about a request, kept only if present and only as short plain strings:
 * response headers such as x-freellm-*, x-route-*, x-provider, x-served-model, and a top-level provider/routing
 * string in the body. Nothing is assumed to exist; with a plain OpenAI-style server this returns undefined.
 */
export function routingFrom(headers: Headers, body: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (/^x-(freellm|route|routed|provider|served|upstream)/i.test(name) && Object.keys(out).length < 6) out[name.toLowerCase()] = value.slice(0, 100);
  });
  for (const key of ["provider", "routing", "routed_to"]) {
    const v = body[key];
    if (typeof v === "string" && Object.keys(out).length < 8) out[`body.${key}`] = v.slice(0, 100);
  }
  return Object.keys(out).length ? out : undefined;
}

export interface OpenAICompatibleOptions {
  /** Provider id shown in usage records ("openai", "groq", ...). */
  name?: string;
  baseURL?: string;
  tokenParam?: "max_completion_tokens" | "max_tokens";
  timeoutMs?: number;
}

export class OpenAIProvider implements AiProvider {
  readonly name: string;
  private client: OpenAI;
  private tokenParam: "max_completion_tokens" | "max_tokens";

  constructor(apiKey: string, readonly model: string, options: OpenAICompatibleOptions = {}) {
    this.name = options.name ?? "openai";
    this.tokenParam = options.tokenParam ?? "max_completion_tokens";
    // Local models (Ollama) need no key, but the SDK insists on a non-empty value.
    this.client = new OpenAI({ apiKey: apiKey || "not-needed", baseURL: options.baseURL, timeout: options.timeoutMs ?? 60_000, maxRetries: 1 });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const { data: response, response: raw } = await this.client.chat.completions.create(
      {
        model: this.model,
        ...(this.tokenParam === "max_tokens" ? { max_tokens: request.maxTokens } : { max_completion_tokens: request.maxTokens }),
        messages: toOpenAIMessages(request.system, request.messages),
        // Some providers reject an empty tools list, so it is only sent when there are tools.
        ...(request.tools.length
          ? { tools: request.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
          : {}),
      },
      { signal: request.signal }
    ).withResponse();

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
      // The model that actually answered (a gateway such as FreeLLMAPI may route "auto" to a real model).
      model: response.model || this.model,
      routing: routingFrom(raw.headers, response as unknown as Record<string, unknown>),
    };
  }
}
