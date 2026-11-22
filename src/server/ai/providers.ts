import { resolveProviders } from "./config";
import { AiProviderUnavailableError, classifyAiError } from "./errors";
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
  if (name === "freellmapi" && env.FREELLMAPI_API_KEY) {
    return new OpenAIProvider(env.FREELLMAPI_API_KEY, env.FREELLMAPI_MODEL || "auto", {
      name: "freellmapi",
      baseURL: env.FREELLMAPI_BASE_URL || "http://localhost:3001/v1",
      tokenParam: "max_tokens",
    });
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

export interface FallbackHooks {
  /** Called for every provider that failed, so the failure can be counted. */
  onFailure?: (provider: AiProvider, error: unknown, latencyMs: number) => void;
}

/**
 * Tries each provider in order. If all fail, throws AiProviderUnavailableError carrying the category of the last
 * failure (never its message, which can contain request details). Moving to the next provider is logged with the
 * provider names and the category only.
 */
export async function completeWithFallback(
  providers: AiProvider[],
  request: CompletionRequest,
  hooks: FallbackHooks = {}
): Promise<CompletionResponse> {
  if (providers.length === 0) throw new AiNotConfiguredError();
  let lastError: unknown;
  for (const [index, provider] of providers.entries()) {
    const started = Date.now();
    try {
      const response = await provider.complete(request);
      return { ...response, latencyMs: Date.now() - started };
    } catch (error) {
      if (request.signal?.aborted) throw error;
      hooks.onFailure?.(provider, error, Date.now() - started);
      lastError = error;
      const next = providers[index + 1];
      console.error(`AI provider ${provider.name} failed (${classifyAiError(error)})${next ? `; trying ${next.name}` : "; no more providers"}`);
    }
  }
  throw new AiProviderUnavailableError(classifyAiError(lastError), providers.map((p) => p.name), providers.length > 1);
}

/** Providers for a chat request: the ones saved in the admin AI page first, then environment-variable ones. */
export function resolveAiProviders(): Promise<AiProvider[]> {
  return resolveProviders(getConfiguredProviders);
}
