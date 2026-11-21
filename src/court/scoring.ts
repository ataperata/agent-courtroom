import { BURDEN_THRESHOLD } from "../agents/roles.js";
import type { EvidenceStore } from "../evidence/store.js";
import type { BurdenOfProof, Evidence, Side, Temperament, Turn } from "../types.js";

// The record as a juror is allowed to see it: only valid citations in
// statements that were not struck, plus what cross-examination did to each
// exhibit. Used by the scripted engine and by tests; live jurors reason in
// natural language from the same filtered record.

export interface RecordView {
  /** evidence id -> number of valid citations in surviving counsel turns */
  mentions: Map<string, number>;
  /** evidence id -> weight multiplier from cross-examination */
  impeachment: Map<string, number>;
  sustainedAgainst: Record<Side, number>;
  struckTurns: Turn[];
}

const COUNSEL: ReadonlySet<string> = new Set(["prosecution", "defense", "witness", "clerk"]);

export function buildRecord(turns: readonly Turn[]): RecordView {
  const mentions = new Map<string, number>();
  const impeachment = new Map<string, number>();
  const sustainedAgainst: Record<Side, number> = { prosecution: 0, defense: 0 };
  const struckTurns: Turn[] = [];
  const bySeq = new Map(turns.map((t) => [t.seq, t]));

  for (const t of turns) {
    if (t.struck) {
      struckTurns.push(t);
      continue;
    }
    if (COUNSEL.has(t.role) && (t.kind === "statement" || t.kind === "question" || t.kind === "answer" || t.kind === "remark")) {
      for (const c of t.citations) {
        if (c.valid) mentions.set(c.evidenceId, (mentions.get(c.evidenceId) ?? 0) + 1);
      }
    }
    if (t.impeachment) {
      const prev = impeachment.get(t.impeachment.evidenceId) ?? 1;
      impeachment.set(t.impeachment.evidenceId, prev * t.impeachment.factor);
    }
    if (t.kind === "ruling" && t.ruling?.outcome === "sustained" && t.refersTo !== undefined) {
      const target = bySeq.get(t.refersTo);
      if (target && (target.role === "prosecution" || target.role === "defense")) {
        sustainedAgainst[target.role] += 1;
      }
    }
  }
  return { mentions, impeachment, sustainedAgainst, struckTurns };
}

export interface Contribution {
  evidence: Evidence;
  /** Signed: positive helps the claim, negative hurts it. */
  value: number;
}

export interface Assessment {
  belief: number;
  threshold: number;
  contributions: Contribution[];
  procedureDelta: number;
}

/** Pseudo-weight of doubt added to both sides of the scale. */
export const DOUBT = 0.6;

export function assess(temperament: Temperament, record: RecordView, store: EvidenceStore, burden: BurdenOfProof): Assessment {
  const contributions: Contribution[] = [];
  for (const e of store.items) {
    const m = record.mentions.get(e.id) ?? 0;
    if (m === 0 || e.favors === "neutral") continue;
    const dir = e.favors === "prosecution" ? 1 : -1;
    const emphasis = 1 + 0.12 * Math.min(m - 1, 3);
    const weight =
      temperament.kindWeights[e.kind] *
      Math.pow(e.reliability, temperament.reliabilityExponent) *
      (record.impeachment.get(e.id) ?? 1) *
      emphasis;
    contributions.push({ evidence: e, value: dir * weight });
  }
  const procedureDelta =
    temperament.procedurePenalty * (record.sustainedAgainst.defense - record.sustainedAgainst.prosecution);
  // Belief is the share of weight behind the claim, with a fixed amount of
  // doubt added to each side so a thin record stays close to 50/50.
  const forClaim = contributions.filter((c) => c.value > 0).reduce((a, c) => a + c.value, 0) + Math.max(0, procedureDelta);
  const against = -contributions.filter((c) => c.value < 0).reduce((a, c) => a + c.value, 0) + Math.max(0, -procedureDelta);
  const belief = (forClaim + DOUBT) / (forClaim + against + 2 * DOUBT);
  const threshold = Math.min(0.97, Math.max(0.05, BURDEN_THRESHOLD[burden] + temperament.thresholdShift));
  contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { belief, threshold, contributions, procedureDelta };
}

/** How sure a juror is of their own vote, 0.5 at the threshold up to 0.99. */
export function voteConfidence(belief: number, threshold: number): number {
  const c = 0.5 + 0.5 * Math.min(1, Math.abs(belief - threshold) / 0.3);
  return Math.round(Math.min(0.99, c) * 100) / 100;
}
