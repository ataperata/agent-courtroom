import { describe, expect, it } from "vitest";
import { citeText } from "../src/evidence/citations.js";
import { EvidenceStore } from "../src/evidence/store.js";
import { findObjection, rule } from "../src/court/objections.js";
import { buildRecord } from "../src/court/scoring.js";
import { makeEvidence, makeTurn } from "./helpers.js";

const store = new EvidenceStore([makeEvidence()]);
const turnFor = (text: string) => makeTurn({ text, citations: citeText(text, store.byId) });

describe("findObjection (opposing counsel)", () => {
  it("objects to a statement with no citation", () => {
    expect(findObjection(turnFor("Trust me, it was the vendor."), "defense", store)?.grounds).toBe("uncited");
  });

  it("objects to an exhibit that does not exist", () => {
    const o = findObjection(turnFor("See the memo [E7]."), "defense", store);
    expect(o?.grounds).toBe("unknown-evidence");
    expect(o?.detail).toContain("E7");
  });

  it("objects to any quote that is not an exact match, even a harmless one", () => {
    expect(findObjection(turnFor('"the service returned 502 for 41 percent of calls" [E1]'), "defense", store)?.grounds).toBe("misquote");
  });

  it("raises nothing against a clean statement", () => {
    expect(findObjection(turnFor('It "returned 502 for 41 percent of calls" [E1].'), "defense", store)).toBeNull();
  });
});

describe("rule (the judge)", () => {
  it("sustains an uncited objection", () => {
    const t = turnFor("No basis.");
    expect(rule(findObjection(t, "defense", store)!, t).outcome).toBe("sustained");
  });

  it("sustains a real misquote", () => {
    const t = turnFor('"returned 502 for 90 percent of calls" [E1]');
    const r = rule(findObjection(t, "defense", store)!, t);
    expect(r.outcome).toBe("sustained");
    expect(r.reason).toContain("does not say");
  });

  it("overrules a misquote objection when only formatting differs", () => {
    const t = turnFor('"THE SERVICE returned 502  for 41 percent of calls" [E1]');
    const o = findObjection(t, "defense", store)!;
    expect(o.grounds).toBe("misquote");
    expect(rule(o, t).outcome).toBe("overruled");
  });

  it("sustains an unknown-evidence objection", () => {
    const t = turnFor("See [E4].");
    expect(rule(findObjection(t, "prosecution", store)!, t).outcome).toBe("sustained");
  });

  it("overrules an uncited objection against a cited statement", () => {
    const t = turnFor("See [E1].");
    expect(rule({ by: "defense", grounds: "uncited", detail: "" }, t).outcome).toBe("overruled");
  });
});

describe("struck statements leave the record", () => {
  it("drops citations from struck turns and counts sustained objections per side", () => {
    const good = makeTurn({ seq: 1, text: "[E1]", citations: [{ evidenceId: "E1", valid: true }] });
    const bad = makeTurn({ seq: 2, role: "defense", speakerId: "defense", struck: true, citations: [{ evidenceId: "E1", valid: true }] });
    const ruling = makeTurn({ seq: 3, role: "judge", speakerId: "judge", kind: "ruling", refersTo: 2, ruling: { outcome: "sustained", reason: "" } });
    const rec = buildRecord([good, bad, ruling]);
    expect(rec.mentions.get("E1")).toBe(1);
    expect(rec.struckTurns).toHaveLength(1);
    expect(rec.sustainedAgainst).toEqual({ prosecution: 0, defense: 1 });
  });
});
