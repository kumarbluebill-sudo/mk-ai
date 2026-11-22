import { resolveProviders } from "./config";
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
export interface FallbackHooks {
  /** Called for every provider that failed, so the failure can be counted. */
  onFailure?: (provider: AiProvider, error: unknown, latencyMs: number) => void;
}

export async function completeWithFallback(
  providers: AiProvider[],
  request: CompletionRequest,
  hooks: FallbackHooks = {}
): Promise<CompletionResponse> {
  if (providers.length === 0) throw new AiNotConfiguredError();
  let lastError: unknown;
  for (const provider of providers) {
    const started = Date.now();
    try {
      const response = await provider.complete(request);
      return { ...response, latencyMs: Date.now() - started };
    } catch (error) {
      if (request.signal?.aborted) throw error;
      hooks.onFailure?.(provider, error, Date.now() - started);
      lastError = error;
      console.error(`AI provider ${provider.name} failed:`, error instanceof Error ? error.message : "unknown error");
    }
  }
  throw lastError;
}

/** Providers for a chat request: the ones saved in the admin AI page first, then environment-variable ones. */
export function resolveAiProviders(): Promise<AiProvider[]> {
  return resolveProviders(getConfiguredProviders);
}
