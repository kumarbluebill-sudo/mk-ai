import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { AiNotConfiguredError, type AiProvider, type CompletionRequest, type CompletionResponse } from "./types";

// Defaults can be overridden with ANTHROPIC_MODEL / OPENAI_MODEL.
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

function build(name: string, env: NodeJS.ProcessEnv): AiProvider | null {
  if (name === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL);
  }
  if (name === "openai" && env.OPENAI_API_KEY) {
    return new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
  }
  return null;
}

/** Primary provider first, then the configured fallback (if different and configured). */
export function getConfiguredProviders(env: NodeJS.ProcessEnv = process.env): AiProvider[] {
  const order = [env.AI_PROVIDER || "anthropic", env.AI_FALLBACK_PROVIDER || ""].filter(Boolean);
  const providers: AiProvider[] = [];
  for (const name of order) {
    const provider = build(name, env);
    if (provider && !providers.some((p) => p.name === provider.name)) providers.push(provider);
  }
  return providers;
}

/** Tries each provider in order; the last error is thrown if all fail. */
export async function completeWithFallback(
  providers: AiProvider[],
  request: CompletionRequest
): Promise<CompletionResponse> {
  if (providers.length === 0) throw new AiNotConfiguredError();
  let lastError: unknown;
  for (const provider of providers) {
    try {
      return await provider.complete(request);
    } catch (error) {
      if (request.signal?.aborted) throw error;
      lastError = error;
      console.error(`AI provider ${provider.name} failed:`, error instanceof Error ? error.message : "unknown error");
    }
  }
  throw lastError;
}
