/**
 * What went wrong with an AI provider call, in a few categories the admin page, the usage log and the chat can
 * all say in plain words. Classification looks only at status codes, error names and well-known network codes,
 * never at message text that may carry request data.
 */
export const AI_ERROR_CATEGORIES = ["AUTH", "RATE_LIMIT", "TIMEOUT", "UNAVAILABLE", "INVALID_MODEL", "BAD_RESPONSE", "OTHER"] as const;
export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number];

export const AI_ERROR_TEXT: Record<AiErrorCategory, string> = {
  AUTH: "the API key was rejected",
  RATE_LIMIT: "the rate limit was reached",
  TIMEOUT: "the request timed out",
  UNAVAILABLE: "the server could not be reached",
  INVALID_MODEL: "the model name is not available",
  BAD_RESPONSE: "the answer was not in the expected format",
  OTHER: "the service returned an error",
};

interface ErrorShape {
  status?: unknown;
  name?: unknown;
  code?: unknown;
  cause?: unknown;
  message?: unknown;
}

const NETWORK_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]);

export function classifyAiError(error: unknown): AiErrorCategory {
  if (typeof error !== "object" || error === null) return "OTHER";
  const e = error as ErrorShape;
  const name = typeof e.name === "string" ? e.name : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? e.status : null;

  if (name === "TimeoutError" || name === "APIConnectionTimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_HEADERS_TIMEOUT") return "TIMEOUT";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 429) return "RATE_LIMIT";
  if (status === 404 || status === 400) {
    // Providers answer an unknown model with 404, or with 400 and a message that names the model.
    const text = typeof e.message === "string" ? e.message.toLowerCase() : "";
    if (status === 404 || /model/.test(text)) return "INVALID_MODEL";
  }
  if (status !== null && status >= 500) return "UNAVAILABLE";
  if (name === "APIConnectionError" || NETWORK_CODES.has(code)) return "UNAVAILABLE";
  if (e.cause) {
    const inner = classifyAiError(e.cause);
    if (inner !== "OTHER") return inner;
  }
  if (name === "SyntaxError" || name === "ZodError") return "BAD_RESPONSE";
  return "OTHER";
}

/** Thrown when every provider in the chain failed. Carries the last failure's category, never its message. */
export class AiProviderUnavailableError extends Error {
  constructor(
    readonly category: AiErrorCategory,
    readonly providers: string[],
    readonly fallbackWasAvailable: boolean
  ) {
    super(`No AI provider could answer (${AI_ERROR_TEXT[category]})`);
    this.name = "AiProviderUnavailableError";
  }
}

/** The sentence the chat shows when the AI service cannot answer. */
export function unavailableMessage(error: AiProviderUnavailableError): string {
  return `The AI service is unavailable right now (${AI_ERROR_TEXT[error.category]}). Please try again in a moment.`;
}
