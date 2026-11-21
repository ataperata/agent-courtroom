import { postJson, ProviderError, type CompletionRequest, type FetchLike, type HttpProviderOptions, type ModelProvider } from "./provider.js";

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5";

/** Anthropic Messages API over fetch. */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly url: string;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: HttpProviderOptions) {
    if (!opts.apiKey) throw new ProviderError("ANTHROPIC_API_KEY is not set");
    this.model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    this.url = `${(opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`;
    this.fetch = opts.fetch ?? ((i, init) => fetch(i, init));
  }

  async complete(req: CompletionRequest): Promise<string> {
    const json = (await postJson(
      this.fetch,
      this.url,
      { "x-api-key": this.opts.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 600,
        temperature: req.temperature ?? 0.4,
        system: req.system,
        messages: req.messages,
      },
      { timeoutMs: this.opts.timeoutMs, maxRetries: this.opts.maxRetries },
    )) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) throw new ProviderError("Anthropic response contained no text");
    return text;
  }
}
