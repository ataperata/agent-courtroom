import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runTrial, DEMO_TIMESTAMP } from "../src/court/orchestrator.js";
import { ScriptedEngine } from "../src/engines/scripted.js";
import { loadCase } from "../src/evidence/store.js";
import { Rng, rngFor } from "../src/rng.js";
import { caseDirs, loadBundled, ROOT } from "./helpers.js";

// First three draws of Rng("courtroom").int(1000). If this changes, every demo transcript changes.
const EXPECTED_SEQUENCE = [608, 627, 389];

const run = (id: string, seed: string) =>
  runTrial(loadBundled(id), new ScriptedEngine(), { seed, generatedAt: DEMO_TIMESTAMP }).then((t) => JSON.stringify(t));

describe("demo determinism", () => {
  it("the same seed produces byte-identical transcripts", async () => {
    expect(await run("checkout-outage", "42")).toBe(await run("checkout-outage", "42"));
  });

  it("different seeds produce different trials", async () => {
    expect(await run("four-day-week", "1")).not.toBe(await run("four-day-week", "2"));
  });

  it("the RNG is stable across platforms", () => {
    const r = new Rng("courtroom");
    expect([r.int(1000), r.int(1000), r.int(1000)]).toEqual(EXPECTED_SEQUENCE);
  });

  it("named streams do not affect each other", () => {
    const a1 = rngFor("s", "a").float();
    rngFor("s", "b").float();
    expect(rngFor("s", "a").float()).toBe(a1);
  });

  it.each(caseDirs().map((d) => d.split("/").pop()!))("bundled transcript for %s is up to date (run `npm run demo` if this fails)", async (id) => {
    const committed = JSON.parse(readFileSync(join(ROOT, "web/public/transcripts", `${id}.json`), "utf8"));
    const fresh = await runTrial(loadCase(join(ROOT, "cases", id)), new ScriptedEngine(), { seed: "1", generatedAt: DEMO_TIMESTAMP });
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(committed);
  });
});

