export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (type: "object"). */
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
  /** Set by completeWithFallback: how long the answering provider took. */
  latencyMs?: number;
  /** Routing details the provider reported about the request (served model, upstream name). Never keys or prompts. */
  routing?: Record<string, string>;
}

/** Provider-independent LLM interface. Adapters must never log prompts or keys. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Admin-entered prices per million tokens, used only for cost estimates. */
  readonly pricing?: { inputPerM: number; outputPerM: number };
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured (add one in the admin AI page, or set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    this.name = "AiNotConfiguredError";
  }
}
