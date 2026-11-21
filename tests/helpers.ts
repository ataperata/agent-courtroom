import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase, listCaseDirs } from "../src/evidence/store.js";
import type { CaseFile, Evidence, Turn } from "../src/types.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CASES = join(ROOT, "cases");
export const caseDirs = () => listCaseDirs(CASES);
export const loadBundled = (id: string): CaseFile => loadCase(join(CASES, id));

export function makeEvidence(over: Partial<Evidence> = {}): Evidence {
  return {
    id: "E1",
    title: "Test log",
    kind: "log",
    source: "Test source",
    reliability: 0.9,
    favors: "prosecution",
    summary: "A test exhibit.",
    quote: "The service returned 502 for 41 percent of calls.",
    body: "Header line.\n\nThe service returned 502 for 41 percent of calls.\n\n> Quoted **note** here.",
    ...over,
  };
}

export function makeTurn(over: Partial<Turn> = {}): Turn {
  return { seq: 1, phase: "evidence", speakerId: "prosecution", role: "prosecution", kind: "statement", text: "x", citations: [], ...over };
}
