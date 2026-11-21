import { postJson, ProviderError, type CompletionRequest, type FetchLike, type HttpProviderOptions, type ModelProvider } from "./provider.js";

export const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";

/** OpenAI Chat Completions over fetch. Works with compatible endpoints via baseUrl. */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly url: string;
  private readonly fetch: FetchLike;

  constructor(private readonly opts: HttpProviderOptions) {
    if (!opts.apiKey) throw new ProviderError("OPENAI_API_KEY is not set");
    this.model = opts.model ?? OPENAI_DEFAULT_MODEL;
    this.url = `${(opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`;
    this.fetch = opts.fetch ?? ((i, init) => fetch(i, init));
  }

  async complete(req: CompletionRequest): Promise<string> {
    const json = (await postJson(
      this.fetch,
      this.url,
      { authorization: `Bearer ${this.opts.apiKey}` },
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 600,
        temperature: req.temperature ?? 0.4,
        messages: [{ role: "system", content: req.system }, ...req.messages],
      },
      { timeoutMs: this.opts.timeoutMs, maxRetries: this.opts.maxRetries },
    )) as { choices?: Array<{ message?: { content?: string | null } }> };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError("OpenAI response contained no text");
    return text;
  }
}
