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
}

/** Provider-independent LLM interface. Adapters must never log prompts or keys. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    this.name = "AiNotConfiguredError";
  }
}
