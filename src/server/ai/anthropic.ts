import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider, ChatMessage, CompletionRequest, CompletionResponse, ToolCall } from "./types";

type AnthropicMessage = Anthropic.Messages.MessageParam;

/** Converts provider-neutral messages into Anthropic's block format. */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: Anthropic.Messages.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : "" });
    } else {
      const block: Anthropic.Messages.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content,
        is_error: m.isError,
      };
      // Consecutive tool results must share a single user turn.
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
        })),
      },
      { signal: request.signal }
    );

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
      }
    }

    return {
      text,
      toolCalls,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      provider: this.name,
      model: this.model,
    };
  }
}
