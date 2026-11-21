import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { selectProvider } from "../src/providers/index.js";
import type { FetchLike } from "../src/providers/provider.js";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init: init! });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "retry-after": "0" } });
  };
  return { f, calls };
}

describe("AnthropicProvider", () => {
  it("sends a Messages API request and joins text blocks", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { content: [{ type: "text", text: "Hello " }, { type: "text", text: "court" }] } }]);
    const p = new AnthropicProvider({ apiKey: "k", model: "m1", fetch: f });
    const out = await p.complete({ system: "sys", messages: [{ role: "user", content: "hi" }] });
    expect(out).toBe("Hello court");
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "m1", system: "sys", messages: [{ role: "user", content: "hi" }] });
  });

  it("retries on 429 and then succeeds", async () => {
    const { f, calls } = fakeFetch([
      { status: 429, body: {} },
      { status: 200, body: { content: [{ type: "text", text: "ok" }] } },
    ]);
    vi.useFakeTimers();
    const p = new AnthropicProvider({ apiKey: "k", fetch: f });
    const pending = p.complete({ system: "", messages: [] });
    await vi.runAllTimersAsync();
    expect(await pending).toBe("ok");
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it("does not retry a 401 and reports the status", async () => {
    const { f, calls } = fakeFetch([{ status: 401, body: { error: "bad key" } }]);
    const p = new AnthropicProvider({ apiKey: "k", fetch: f });
    await expect(p.complete({ system: "", messages: [] })).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });
});

describe("OpenAIProvider", () => {
  it("puts the system prompt first and reads the first choice", async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { choices: [{ message: { content: " Objection. " } }] } }]);
    const p = new OpenAIProvider({ apiKey: "sk", baseUrl: "http://local/v1/", fetch: f });
    expect(await p.complete({ system: "S", messages: [{ role: "user", content: "U" }] })).toBe("Objection.");
    expect(calls[0]!.url).toBe("http://local/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk");
    expect(JSON.parse(calls[0]!.init.body as string).messages[0]).toEqual({ role: "system", content: "S" });
  });
});

describe("selectProvider", () => {
  it("returns null without keys, which means demo mode", () => {
    expect(selectProvider({ env: {} })).toBeNull();
  });
  it("prefers Anthropic when both keys are set", () => {
    expect(selectProvider({ env: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" } })?.name).toBe("anthropic");
  });
  it("honors an explicit provider and model", () => {
    const p = selectProvider({ provider: "openai", model: "x", env: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" } });
    expect(p?.name).toBe("openai");
    expect(p?.model).toBe("x");
  });
  it("reads COURTROOM_MODEL", () => {
    expect(selectProvider({ env: { OPENAI_API_KEY: "o", COURTROOM_MODEL: "custom" } })?.model).toBe("custom");
  });
  it("fails clearly when the chosen provider has no key", () => {
    expect(() => selectProvider({ provider: "anthropic", env: {} })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
