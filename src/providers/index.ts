import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { ProviderError, type FetchLike, type ModelProvider } from "./provider.js";

export type ProviderName = "anthropic" | "openai";

export interface ProviderSelection {
  provider?: ProviderName;
  model?: string;
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
}

/**
 * Pick a provider from flags and environment.
 * Explicit --provider wins; otherwise ANTHROPIC_API_KEY, then OPENAI_API_KEY.
 * Returns null when no key is available, which callers treat as demo mode.
 */
export function selectProvider(sel: ProviderSelection = {}): ModelProvider | null {
  const env = sel.env ?? process.env;
  const model = sel.model ?? env.COURTROOM_MODEL;
  const name: ProviderName | undefined =
    sel.provider ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : undefined);
  if (!name) return null;
  if (name === "anthropic") {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ProviderError("--provider anthropic needs ANTHROPIC_API_KEY");
    return new AnthropicProvider({ apiKey, model, baseUrl: env.ANTHROPIC_BASE_URL, fetch: sel.fetch });
  }
  if (name === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new ProviderError("--provider openai needs OPENAI_API_KEY");
    return new OpenAIProvider({ apiKey, model, baseUrl: env.OPENAI_BASE_URL, fetch: sel.fetch });
  }
  throw new ProviderError(`Unknown provider "${String(name)}"`);
}

export { AnthropicProvider, OpenAIProvider, ProviderError };
export type { ModelProvider };
