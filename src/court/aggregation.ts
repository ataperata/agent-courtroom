import type { JurorVote, Verdict, VoteRule } from "../types.js";

export function votesRequired(n: number, rule: VoteRule): number {
  switch (rule) {
    case "majority":
      return Math.floor(n / 2) + 1;
    case "supermajority":
      return Math.ceil((2 * n) / 3);
    case "unanimous":
      return n;
  }
}

export const RULE_TEXT: Record<VoteRule, string> = {
  majority: "a simple majority",
  supermajority: "at least two thirds of the jury",
  unanimous: "a unanimous jury",
};

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/**
 * Turn individual votes into a verdict.
 *
 * Confidence blends how sure the winning jurors were with how lopsided the
 * vote was: confidence = meanConfidence(winners) * (0.5 + 0.5 * margin),
 * where margin = (winners - losers) / n. A 6-0 vote of very sure jurors comes
 * out near their own confidence; a 4-2 split is discounted.
 * A hung jury reports how far it was from a decision on the same scale.
 */
export function aggregateVotes(votes: JurorVote[], rule: VoteRule): Omit<Verdict, "summary"> {
  const n = votes.length;
  if (n === 0) throw new Error("Cannot aggregate an empty jury");
  const uphold = votes.filter((v) => v.vote === "uphold");
  const reject = votes.filter((v) => v.vote === "reject");
  const need = votesRequired(n, rule);
  const tally = { uphold: uphold.length, reject: reject.length };

  let outcome: Verdict["outcome"] = "hung";
  let winners: JurorVote[] = [];
  if (uphold.length >= need) {
    outcome = "upheld";
    winners = uphold;
  } else if (reject.length >= need) {
    outcome = "rejected";
    winners = reject;
  }

  if (outcome === "hung") {
    const leading = uphold.length >= reject.length ? uphold : reject;
    const margin = Math.abs(uphold.length - reject.length) / n;
    return { outcome, rule, tally, confidence: round2(mean(leading.map((v) => v.confidence)) * margin * 0.5) };
  }
  const margin = (winners.length - (n - winners.length)) / n;
  const confidence = mean(winners.map((v) => v.confidence)) * (0.5 + 0.5 * margin);
  return { outcome, rule, tally, confidence: round2(confidence) };
}
