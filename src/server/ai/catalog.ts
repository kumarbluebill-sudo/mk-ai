/**
 * The AI providers the platform can use. Anthropic has its own adapter; every other provider here offers an
 * OpenAI-compatible chat endpoint (documented by each vendor), so one adapter serves them with a different base URL.
 *
 * Capabilities are what the vendors document for their default chat models, NOT something this code has verified
 * against a live account: a provider counts as tested only after "Test connection" has succeeded in the admin page.
 */
export const PROVIDER_IDS = ["anthropic", "openai", "gemini", "mistral", "deepseek", "groq", "openrouter", "ollama", "freellmapi"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Default API base URL for OpenAI-compatible providers; null for Anthropic (SDK default). */
  baseUrl: string | null;
  adapter: "anthropic" | "openai-compatible";
  /** Which request field carries the output limit. OpenAI's newer models reject max_tokens; most others expect it. */
  tokenParam: "max_completion_tokens" | "max_tokens";
  needsKey: boolean;
  /** "model" = depends on the model chosen (open models). */
  tools: "yes" | "model";
  /** A reasonable starting model name (an example, change it in the admin page). */
  exampleModel: string;
  note?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: { id: "anthropic", label: "Anthropic Claude", baseUrl: null, adapter: "anthropic", tokenParam: "max_tokens", needsKey: true, tools: "yes", exampleModel: "claude-sonnet-5-5" },
  openai: { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", adapter: "openai-compatible", tokenParam: "max_completion_tokens", needsKey: true, tools: "yes", exampleModel: "gpt-4o" },
  gemini: { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "yes", exampleModel: "gemini-2.5-flash", note: "Uses Google's OpenAI-compatible endpoint." },
  mistral: { id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "yes", exampleModel: "mistral-large-latest" },
  deepseek: { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "yes", exampleModel: "deepseek-chat" },
  groq: { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "model", exampleModel: "llama-3.3-70b-versatile" },
  openrouter: { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "model", exampleModel: "anthropic/claude-sonnet-4.5" },
  freellmapi: { id: "freellmapi", label: "FreeLLMAPI", baseUrl: "http://localhost:3001/v1", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: true, tools: "model", exampleModel: "auto", note: "An OpenAI-compatible gateway. \"auto\" lets it choose the model; use Load models to see the real model ids it offers. localhost only works when this app and FreeLLMAPI run on the same computer; the live site needs a public https address." },
  ollama: { id: "ollama", label: "Ollama / local model", baseUrl: "http://localhost:11434/v1", adapter: "openai-compatible", tokenParam: "max_tokens", needsKey: false, tools: "model", exampleModel: "llama3.1", note: "Must be reachable from the server. A model running on your own computer is not reachable from Vercel." },
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Admin-supplied base URLs are fetched by the server, so refuse the ones that make no sense or are dangerous:
 * credentials in the URL, non-http(s), and cloud metadata / link-local addresses. Localhost is allowed only for Ollama.
 */
export function validateBaseUrl(provider: ProviderId, raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Only http and https URLs are allowed." };
  if (u.username || u.password) return { ok: false, reason: "Do not put credentials in the URL; use the API key field." };
  const host = u.hostname.toLowerCase();
  if (/^169\.254\./.test(host) || host === "metadata.google.internal" || host === "[fd00:ec2::254]") return { ok: false, reason: "That address is not allowed." };
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (local && provider !== "ollama" && provider !== "freellmapi") return { ok: false, reason: "Localhost addresses are only for Ollama and FreeLLMAPI." };
  if (u.protocol === "http:" && !local && !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return { ok: false, reason: "Use https for remote providers." };
  return { ok: true, url: u.toString() };
}
