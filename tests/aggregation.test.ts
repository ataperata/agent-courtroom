import { describe, expect, it } from "vitest";
import { aggregateVotes, votesRequired } from "../src/court/aggregation.js";
import type { JurorVote, Vote } from "../src/types.js";

const votes = (spec: Array<[Vote, number]>): JurorVote[] =>
  spec.map(([vote, confidence], i) => ({ jurorId: `j${i}`, vote, confidence, belief: 0.5, reasoning: "", citations: [] }));

describe("votesRequired", () => {
  it.each([
    [7, "majority", 4],
    [6, "majority", 4],
    [7, "supermajority", 5],
    [6, "supermajority", 4],
    [12, "supermajority", 8],
    [7, "unanimous", 7],
    [1, "majority", 1],
  ] as const)("n=%i %s needs %i", (n, rule, need) => {
    expect(votesRequired(n, rule)).toBe(need);
  });
});

describe("aggregateVotes", () => {
  it("unanimous jury takes the jurors' own confidence", () => {
    const v = aggregateVotes(votes([["uphold", 0.8], ["uphold", 0.8], ["uphold", 0.8]]), "unanimous");
    expect(v).toMatchObject({ outcome: "upheld", tally: { uphold: 3, reject: 0 }, confidence: 0.8 });
  });

  it("discounts confidence for a split decision", () => {
    const v = aggregateVotes(votes([["reject", 0.7], ["reject", 0.7], ["reject", 0.7], ["reject", 0.7], ["uphold", 0.9], ["uphold", 0.9]]), "supermajority");
    expect(v.outcome).toBe("rejected");
    // 0.7 * (0.5 + 0.5 * (4 - 2) / 6) = 0.4667
    expect(v.confidence).toBeCloseTo(0.47, 2);
  });

  it("returns hung when no side reaches the rule", () => {
    const v = aggregateVotes(votes([["uphold", 0.6], ["uphold", 0.6], ["uphold", 0.6], ["uphold", 0.6], ["reject", 0.6], ["reject", 0.6], ["reject", 0.6]]), "supermajority");
    expect(v.outcome).toBe("hung");
    expect(v.tally).toEqual({ uphold: 4, reject: 3 });
    expect(v.confidence).toBeLessThan(0.1);
  });

  it("an even split under majority rule is hung", () => {
    expect(aggregateVotes(votes([["uphold", 0.9], ["reject", 0.9]]), "majority").outcome).toBe("hung");
  });

  it("the same votes can pass majority but fail unanimity", () => {
    const v = votes([["uphold", 0.8], ["uphold", 0.8], ["reject", 0.6]]);
    expect(aggregateVotes(v, "majority").outcome).toBe("upheld");
    expect(aggregateVotes(v, "unanimous").outcome).toBe("hung");
  });

  it("refuses an empty jury", () => {
    expect(() => aggregateVotes([], "majority")).toThrow();
  });
});
