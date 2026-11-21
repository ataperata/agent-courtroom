import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { quoteMatchesExactly, quoteMatchesRecord } from "./citations.js";
import type { BurdenOfProof, CaseFile, Evidence, EvidenceKind, Favors } from "../types.js";

const KINDS: EvidenceKind[] = ["log", "data", "document", "testimony", "inspection"];
const FAVORS: Favors[] = ["prosecution", "defense", "neutral"];
const BURDENS: BurdenOfProof[] = ["preponderance", "clear-and-convincing", "beyond-reasonable-doubt"];

function required(data: Record<string, string>, key: string, label: string): string {
  const v = data[key];
  if (v === undefined || v === "") throw new Error(`${label}: missing required field "${key}"`);
  return v;
}

export function parseEvidence(source: string, file = "evidence"): Evidence {
  const { data, body } = parseFrontmatter(source, file);
  const id = required(data, "id", file);
  if (!/^E\d+$/.test(id)) throw new Error(`${file}: id "${id}" must look like E1, E2, ...`);
  const kind = required(data, "kind", file) as EvidenceKind;
  if (!KINDS.includes(kind)) throw new Error(`${file}: kind must be one of ${KINDS.join(", ")}`);
  const favors = required(data, "favors", file) as Favors;
  if (!FAVORS.includes(favors)) throw new Error(`${file}: favors must be one of ${FAVORS.join(", ")}`);
  const reliability = Number(required(data, "reliability", file));
  if (!Number.isFinite(reliability) || reliability < 0 || reliability > 1) {
    throw new Error(`${file}: reliability must be a number between 0 and 1`);
  }
  const quote = required(data, "quote", file);
  if (!quoteMatchesExactly(quote, body)) {
    throw new Error(`${file}: quote does not appear verbatim in the body: "${quote}"`);
  }
  const ev: Evidence = {
    id,
    title: required(data, "title", file),
    kind,
    source: required(data, "source", file),
    reliability,
    favors,
    summary: required(data, "summary", file),
    quote,
    body,
    file,
  };
  if (data.weakness) ev.weakness = data.weakness;
  if (data.rebuttal) ev.rebuttal = data.rebuttal;
  if (data.impact !== undefined) {
    const impact = Number(data.impact);
    if (!Number.isFinite(impact) || impact < 0 || impact > 1) throw new Error(`${file}: impact must be between 0 and 1`);
    ev.impact = impact;
  }
  if (data.misquote) {
    if (quoteMatchesRecord(data.misquote, body)) throw new Error(`${file}: misquote must not match the record`);
    ev.misquote = data.misquote;
  }
  return ev;
}

export function loadCase(dir: string): CaseFile {
  const casePath = join(dir, "case.md");
  if (!existsSync(casePath)) throw new Error(`No case.md found in ${dir}`);
  const { data, body } = parseFrontmatter(readFileSync(casePath, "utf8"), casePath);
  const burden = (data.burden ?? "preponderance") as BurdenOfProof;
  if (!BURDENS.includes(burden)) throw new Error(`${casePath}: burden must be one of ${BURDENS.join(", ")}`);

  const evDir = join(dir, "evidence");
  const files = existsSync(evDir)
    ? readdirSync(evDir).filter((f) => f.endsWith(".md")).sort()
    : [];
  const evidence = files.map((f) => parseEvidence(readFileSync(join(evDir, f), "utf8"), `evidence/${f}`));
  const ids = new Set<string>();
  for (const e of evidence) {
    if (ids.has(e.id)) throw new Error(`${dir}: duplicate evidence id ${e.id}`);
    ids.add(e.id);
  }
  if (evidence.length === 0) throw new Error(`${dir}: a case needs at least one evidence file`);
  evidence.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));

  return {
    id: data.id ?? basename(dir),
    title: required(data, "title", casePath),
    claim: required(data, "claim", casePath),
    burden,
    prosecutionTheory: required(data, "prosecution_theory", casePath),
    defenseTheory: required(data, "defense_theory", casePath),
    background: body,
    evidence,
  };
}

export function listCaseDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((d) => join(root, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, "case.md")))
    .sort();
}

export class EvidenceStore {
  readonly byId: Map<string, Evidence>;
  constructor(readonly items: Evidence[]) {
    this.byId = new Map(items.map((e) => [e.id, e]));
  }
  get(id: string): Evidence | undefined {
    return this.byId.get(id);
  }
  favoring(side: Favors): Evidence[] {
    return this.items.filter((e) => e.favors === side);
  }
}
