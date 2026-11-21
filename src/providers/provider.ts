// Model provider abstraction. Plain fetch, no SDKs. Each provider turns a
// system prompt plus a short message list into one text completion.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<string>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST JSON with a timeout and retries on 429 and 5xx. */
export async function postJson(
  f: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  { timeoutMs = 60_000, maxRetries = 3 }: { timeoutMs?: number; maxRetries?: number } = {},
): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(500 * 2 ** attempt++);
        continue;
      }
      throw new ProviderError(`Request to ${url} failed: ${(err as Error).message}`);
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxRetries) {
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt);
      attempt++;
      continue;
    }
    const text = await res.text().catch(() => "");
    throw new ProviderError(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`, res.status);
  }
}
