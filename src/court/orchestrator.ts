import { seatJury, temperamentByKey } from "../agents/jurors.js";
import { citeText } from "../evidence/citations.js";
import { EvidenceStore } from "../evidence/store.js";
import type { CourtEngine, TrialContext } from "../engines/engine.js";
import { aggregateVotes, RULE_TEXT } from "./aggregation.js";
import { findObjection, rule as ruleOn } from "./objections.js";
import {
  SCHEMA_VERSION,
  type CaseFile,
  type DeliberationRound,
  type Evidence,
  type JurorVote,
  type Participant,
  type Phase,
  type Role,
  type Side,
  type Transcript,
  type Turn,
  type TurnKind,
  type VoteRule,
} from "../types.js";

export interface TrialOptions {
  seed?: string;
  jurors?: number;
  rule?: VoteRule;
  /** ISO timestamp to stamp on the transcript. Demo runs pass a fixed value. */
  generatedAt?: string;
  /** How many opposing exhibits each side cross-examines. */
  crossPerSide?: number;
  /** Called after each turn is recorded, for live progress output. */
  onTurn?: (turn: Turn, participants: readonly Participant[]) => void;
}

/** Fixed stamp for demo transcripts so reruns are byte-identical. */
export const DEMO_TIMESTAMP = "2026-01-01T09:00:00.000Z";

export const DEFAULTS = { jurors: 7, rule: "supermajority" as VoteRule, seed: "1", crossPerSide: 2 };

export const DEFAULT_IMPACT = 0.45;

/**
 * Weight left on an exhibit after cross-examination. A conceded weakness
 * removes `impact` of its weight; a rebuttal on the record wins half of that back.
 */
export function impeachmentFactor(e: Evidence, conceded: boolean): number {
  if (!conceded) return 1;
  const impact = (e.impact ?? DEFAULT_IMPACT) * (e.rebuttal ? 0.5 : 1);
  return Math.round((1 - impact) * 1000) / 1000;
}

const other = (s: Side): Side => (s === "prosecution" ? "defense" : "prosecution");

function crossTargets(store: EvidenceStore, owner: Side, n: number): Evidence[] {
  return store
    .favoring(owner)
    .filter((e) => e.weakness)
    .sort((a, b) => b.reliability - a.reliability || a.id.localeCompare(b.id))
    .slice(0, n);
}

export async function runTrial(caseFile: CaseFile, engine: CourtEngine, opts: TrialOptions = {}): Promise<Transcript> {
  const seed = opts.seed ?? DEFAULTS.seed;
  const rule = opts.rule ?? DEFAULTS.rule;
  const crossPerSide = opts.crossPerSide ?? DEFAULTS.crossPerSide;
  const store = new EvidenceStore(caseFile.evidence);
  const jury = seatJury(opts.jurors ?? DEFAULTS.jurors);

  const participants: Participant[] = [
    { id: "judge", role: "judge", name: "Judge Okafor" },
    { id: "clerk", role: "clerk", name: "Clerk" },
    { id: "prosecution", role: "prosecution", name: "Prosecution" },
    { id: "defense", role: "defense", name: "Defense" },
    ...caseFile.evidence
      .filter((e) => e.weakness)
      .map((e) => ({ id: `witness-${e.id}`, role: "witness" as const, name: e.source })),
    ...jury,
  ];

  const turns: Turn[] = [];
  const ctx: TrialContext = { caseFile, store, turns, participants, seed, rule };

  const record = (phase: Phase, speakerId: string, role: Role, kind: TurnKind, text: string, extra: Partial<Turn> = {}): Turn => {
    const turn: Turn = {
      seq: turns.length + 1,
      phase,
      speakerId,
      role,
      kind,
      text: text.trim(),
      citations: extra.citations ?? citeText(text, store.byId),
      ...extra,
    };
    turns.push(turn);
    opts.onTurn?.(turn, participants);
    return turn;
  };

  /** Record a counsel turn, then let the other side object and the judge rule. */
  const counsel = (phase: Phase, side: Side, kind: TurnKind, text: string): Turn => {
    const turn = record(phase, side, side, kind, text);
    const objection = findObjection(turn, other(side), store);
    if (objection) {
      record(phase, other(side), other(side), "objection", `Objection. ${objection.detail}`, {
        citations: [],
        refersTo: turn.seq,
        objection,
      });
      const ruling = ruleOn(objection, turn);
      record(phase, "judge", "judge", "ruling", `${ruling.outcome === "sustained" ? "Sustained" : "Overruled"}. ${ruling.reason}`, {
        citations: [],
        refersTo: turn.seq,
        ruling,
      });
      if (ruling.outcome === "sustained") turn.struck = true;
    }
    return turn;
  };

  // Opening
  record("opening", "clerk", "clerk", "remark", `All rise. The court will hear the matter of ${caseFile.title}.`, { citations: [] });
  record("opening", "judge", "judge", "remark", await engine.judge(ctx, { kind: "open" }), { citations: [] });
  for (const side of ["prosecution", "defense"] as const) {
    counsel("opening", side, "statement", await engine.opening(ctx, side));
  }

  // Evidence
  const neutral = store.favoring("neutral");
  if (neutral.length) {
    const list = neutral.map((e) => `Exhibit ${e.id} (${e.title}) [${e.id}]`).join("; ");
    record("evidence", "clerk", "clerk", "remark", `The parties stipulate to the following joint exhibits: ${list}.`);
  }
  for (const side of ["prosecution", "defense"] as const) {
    for (const item of store.favoring(side)) {
      counsel("evidence", side, "statement", await engine.presentEvidence(ctx, side, item));
    }
  }

  // Cross-examination: each side presses on the other side's strongest exhibits.
  for (const side of ["defense", "prosecution"] as const) {
    for (const target of crossTargets(store, other(side), crossPerSide)) {
      const q = counsel("cross", side, "question", await engine.crossQuestion(ctx, side, target));
      const witnessId = `witness-${target.id}`;
      if (q.struck) {
        record("cross", "judge", "judge", "remark", "The witness need not answer. Counsel, move on.", { citations: [], refersTo: q.seq });
        continue;
      }
      const reply = await engine.witnessAnswer(ctx, target, q.text);
      const factor = impeachmentFactor(target, reply.concedes);
      record("cross", witnessId, "witness", "answer", reply.text, {
        refersTo: q.seq,
        impeachment: { evidenceId: target.id, factor, conceded: reply.concedes },
      });
    }
  }

  // Closing
  counsel("closing", "prosecution", "statement", await engine.closing(ctx, "prosecution", false));
  counsel("closing", "defense", "statement", await engine.closing(ctx, "defense", false));
  counsel("closing", "prosecution", "statement", await engine.closing(ctx, "prosecution", true));

  // Deliberation: an independent round, then a round after hearing the room.
  record("deliberation", "judge", "judge", "instruction", await engine.judge(ctx, { kind: "instruct" }), { citations: [] });
  const deliberation: DeliberationRound[] = [];
  let previous: JurorVote[] | null = null;
  for (const round of [1, 2]) {
    const votes: JurorVote[] = [];
    for (const juror of jury) {
      const t = temperamentByKey(juror.temperament!);
      const d = await engine.deliberate(ctx, juror, t, round, previous);
      const turn = record("deliberation", juror.id, "juror", "deliberation", d.reasoning);
      votes.push({
        jurorId: juror.id,
        vote: d.vote,
        confidence: d.confidence,
        belief: Math.round(d.belief * 1000) / 1000,
        reasoning: turn.text,
        citations: turn.citations,
      });
    }
    deliberation.push({ round, votes });
    previous = votes;
  }

  // Verdict
  const counted = aggregateVotes(previous!, rule);
  const judgeText = await engine.judge(ctx, { kind: "verdict", verdict: counted });
  const label = counted.outcome === "upheld" ? "Claim upheld" : counted.outcome === "rejected" ? "Claim rejected" : "Hung jury";
  const summary = `${label}, ${counted.tally.uphold} to ${counted.tally.reject}. The rule required ${RULE_TEXT[rule]}. Verdict confidence ${counted.confidence.toFixed(2)}.`;
  record("verdict", "judge", "judge", "verdict", judgeText, { citations: [] });
  record("verdict", "clerk", "clerk", "remark", `${summary} Court is adjourned.`, { citations: [] });

  const counselTurns = turns.filter((t) => t.role === "prosecution" || t.role === "defense");
  const allCitations = turns.flatMap((t) => t.citations);
  const rulings = turns.filter((t) => t.kind === "ruling");

  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${caseFile.id}--seed-${seed}`,
    mode: engine.mode,
    engine: engine.name,
    seed,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    case: {
      id: caseFile.id,
      title: caseFile.title,
      claim: caseFile.claim,
      background: caseFile.background,
      burden: caseFile.burden,
    },
    evidence: caseFile.evidence.map(({ body: _b, file: _f, misquote: _m, ...rest }) => rest),
    participants,
    turns,
    deliberation,
    verdict: { ...counted, summary },
    stats: {
      turns: turns.length,
      citations: allCitations.length,
      invalidCitations: allCitations.filter((c) => !c.valid).length,
      objections: turns.filter((t) => t.kind === "objection").length,
      sustained: rulings.filter((t) => t.ruling?.outcome === "sustained").length,
      overruled: rulings.filter((t) => t.ruling?.outcome === "overruled").length,
      struckTurns: counselTurns.filter((t) => t.struck).length,
      impeachments: turns.filter((t) => t.impeachment?.conceded).length,
    },
  };
}
