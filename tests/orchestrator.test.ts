import { describe, expect, it } from "vitest";
import { runTrial, impeachmentFactor } from "../src/court/orchestrator.js";
import { ScriptedEngine } from "../src/engines/scripted.js";
import { LlmEngine, extractJson, cleanSpeech } from "../src/engines/llm.js";
import type { CompletionRequest, ModelProvider } from "../src/providers/provider.js";
import { validateTranscript } from "../src/schema/validate.js";
import { PHASES, type Transcript } from "../src/types.js";
import { loadBundled, makeEvidence } from "./helpers.js";

const checkout = loadBundled("checkout-outage");

function phaseOrder(t: Transcript): string[] {
  return t.turns.map((x) => x.phase).filter((p, i, all) => all.indexOf(p) === i);
}

describe("runTrial with the scripted engine", () => {
  it("runs every phase in order and produces a schema-valid transcript", async () => {
    const t = await runTrial(checkout, new ScriptedEngine(), { seed: "1", generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(phaseOrder(t)).toEqual([...PHASES]);
    const v = validateTranscript(t);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it("every surviving counsel statement cites valid evidence", async () => {
    const t = await runTrial(checkout, new ScriptedEngine(), { seed: "3" });
    const counsel = t.turns.filter((x) => (x.role === "prosecution" || x.role === "defense") && (x.kind === "statement" || x.kind === "question"));
    expect(counsel.length).toBeGreaterThan(8);
    for (const turn of counsel) {
      if (turn.struck) continue;
      expect(turn.citations.length, `turn ${turn.seq}`).toBeGreaterThan(0);
      expect(turn.citations.every((c) => c.valid), `turn ${turn.seq}`).toBe(true);
    }
  });

  it("follows each objection with a ruling and strikes only sustained turns", async () => {
    const t = await runTrial(checkout, new ScriptedEngine(), { seed: "1" });
    const objections = t.turns.filter((x) => x.kind === "objection");
    expect(objections.length).toBeGreaterThan(0);
    for (const o of objections) {
      const ruling = t.turns[o.seq]!; // next turn (seq is 1-based)
      expect(ruling.kind).toBe("ruling");
      expect(ruling.refersTo).toBe(o.refersTo);
      const target = t.turns[o.refersTo! - 1]!;
      expect(Boolean(target.struck)).toBe(ruling.ruling!.outcome === "sustained");
    }
    expect(t.stats.sustained + t.stats.overruled).toBe(t.stats.objections);
  });

  it("a struck cross-examination question gets no answer", async () => {
    const t = await runTrial(checkout, new ScriptedEngine(), { seed: "1" });
    const struckQs = t.turns.filter((x) => x.kind === "question" && x.struck);
    expect(struckQs.length).toBeGreaterThan(0);
    for (const q of struckQs) {
      expect(t.turns.some((x) => x.kind === "answer" && x.refersTo === q.seq)).toBe(false);
    }
  });

  it("seats the requested jury, runs two rounds, and the tally matches round two", async () => {
    const t = await runTrial(checkout, new ScriptedEngine(), { seed: "1", jurors: 5, rule: "unanimous" });
    expect(t.participants.filter((p) => p.role === "juror")).toHaveLength(5);
    expect(t.deliberation.map((r) => r.votes.length)).toEqual([5, 5]);
    const final = t.deliberation[1]!.votes;
    expect(t.verdict.tally.uphold).toBe(final.filter((v) => v.vote === "uphold").length);
    expect(t.verdict.rule).toBe("unanimous");
    for (const v of final) expect(v.citations.some((c) => c.valid)).toBe(true);
  });

  it("with planted mistakes off, nothing is objected to", async () => {
    const t = await runTrial(checkout, new ScriptedEngine({ flaws: false }), { seed: "1" });
    expect(t.stats.objections).toBe(0);
    expect(t.stats.invalidCitations).toBe(0);
  });

  it("bundled cases reach different outcomes under the default seed", async () => {
    const outcomes = await Promise.all(
      ["checkout-outage", "fastener-lot-2417", "four-day-week"].map(async (id) => (await runTrial(loadBundled(id), new ScriptedEngine(), { seed: "1" })).verdict.outcome),
    );
    expect(outcomes).toEqual(["upheld", "hung", "rejected"]);
  });
});

describe("impeachmentFactor", () => {
  it("removes the exhibit's impact when conceded, half of it with a rebuttal", () => {
    expect(impeachmentFactor(makeEvidence({ impact: 0.4 }), true)).toBe(0.6);
    expect(impeachmentFactor(makeEvidence({ impact: 0.4, rebuttal: "But..." }), true)).toBe(0.8);
    expect(impeachmentFactor(makeEvidence({ impact: 0.4 }), false)).toBe(1);
  });
});

/** A fake model: answers by role, and invents a quote when presenting E2. */
class FakeModel implements ModelProvider {
  readonly name = "fake";
  readonly model = "test";
  readonly calls: CompletionRequest[] = [];
  async complete(req: CompletionRequest): Promise<string> {
    this.calls.push(req);
    const task = req.messages[0]!.content.split("## Your task")[1] ?? "";
    if (req.system.includes("You are a juror")) {
      return '```json\n{"vote": "uphold", "belief": 0.72, "confidence": 0.8, "reasoning": "The log settles it [E1]."}\n```';
    }
    if (req.system.includes("You are a witness")) return '{"answer": "Yes, the excerpt is limited [E1].", "concedes": true}';
    if (req.system.includes("presiding JUDGE")) return "Judge: Court is in session.";
    if (task.includes("Present exhibit E2")) return 'Prosecution: The vendor wrote "we accept full responsibility" [E2].';
    if (task.includes("Present exhibit E5")) return "Defense: The release notes matter [E9].";
    return "The record shows it [E1].";
  }
}

describe("runTrial with the live engine and a fake model", () => {
  it("strikes a fabricated quote and a made-up exhibit from the model", async () => {
    const model = new FakeModel();
    const t = await runTrial(checkout, new LlmEngine(model), { seed: "x", jurors: 3 });
    expect(t.mode).toBe("live");
    expect(t.engine).toBe("fake:test");
    const fabricated = t.turns.find((x) => x.text.includes("full responsibility"))!;
    expect(fabricated.struck).toBe(true);
    expect(fabricated.citations[0]).toMatchObject({ evidenceId: "E2", valid: false, issue: "misquote" });
    const madeUp = t.turns.find((x) => x.text.includes("[E9]"))!;
    expect(madeUp.struck).toBe(true);
    expect(t.verdict.outcome).toBe("upheld");
    expect(validateTranscript(t).valid).toBe(true);
    expect(fabricated.text.startsWith("Prosecution:")).toBe(false);
  });

  it("never shows jurors a struck statement", async () => {
    const model = new FakeModel();
    await runTrial(checkout, new LlmEngine(model), { seed: "x", jurors: 2 });
    const jurorPrompts = model.calls.filter((c) => c.system.includes("You are a juror"));
    expect(jurorPrompts.length).toBe(4);
    for (const p of jurorPrompts) {
      const transcript = p.messages[0]!.content.split("## Transcript so far")[1]!.split("## Your task")[0]!;
      expect(transcript).not.toContain("full responsibility");
      expect(transcript).not.toContain("STRUCK");
    }
  });
});

describe("LLM output helpers", () => {
  it("extracts JSON from fenced or chatty replies", () => {
    expect(extractJson('Sure! {"vote":"reject"} hope that helps')).toEqual({ vote: "reject" });
    expect(extractJson("no json here")).toBeNull();
  });
  it("strips speaker labels", () => {
    expect(cleanSpeech("**Defense:** We object.")).toBe("We object.");
  });
});
