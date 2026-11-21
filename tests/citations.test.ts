import { describe, expect, it } from "vitest";
import {
  citeText,
  normalizeForQuote,
  parseCitations,
  quoteMatchesExactly,
  quoteMatchesRecord,
  validateCitations,
} from "../src/evidence/citations.js";
import { makeEvidence } from "./helpers.js";

const e1 = makeEvidence();
const e2 = makeEvidence({ id: "E2", body: "Rollback did not change the error rate.", quote: "Rollback did not change the error rate." });
const store = new Map([
  ["E1", e1],
  ["E2", e2],
]);

describe("parseCitations", () => {
  it("finds plain, grouped and quoted citations", () => {
    const got = parseCitations('First [E1]. Both say so [E1, E2]. It reads "did not change" [E2].');
    expect(got).toEqual([{ evidenceId: "E1" }, { evidenceId: "E2" }, { evidenceId: "E2", quote: "did not change" }]);
  });

  it("binds a quote only to the first id in a group", () => {
    expect(parseCitations('"exact words" [E2; E1]')).toEqual([{ evidenceId: "E2", quote: "exact words" }, { evidenceId: "E1" }]);
  });

  it("accepts curly quotes", () => {
    expect(parseCitations("“did not change” [E2]")).toEqual([{ evidenceId: "E2", quote: "did not change" }]);
  });

  it("ignores brackets that are not evidence ids", () => {
    expect(parseCitations("He said [sic] and [1] and [e1] and [EX]")).toEqual([]);
  });

  it("does not attach a quoted title to a later citation", () => {
    const got = parseCitations('The report "Q3 Review" is long. Later [E1].');
    expect(got).toEqual([{ evidenceId: "E1" }]);
  });
});

describe("quote matching", () => {
  it("exact match is character for character", () => {
    expect(quoteMatchesExactly("returned 502 for 41 percent", e1.body)).toBe(true);
    expect(quoteMatchesExactly("Returned 502 for 41 percent", e1.body)).toBe(false);
  });

  it("the record test forgives case, whitespace, markdown and trailing punctuation", () => {
    expect(quoteMatchesRecord("THE SERVICE  returned 502 for 41 percent of calls", e1.body)).toBe(true);
    expect(quoteMatchesRecord("quoted note here.", e1.body)).toBe(true);
  });

  it("the record test catches changed words and numbers", () => {
    expect(quoteMatchesRecord("The service returned 502 for 82 percent of calls.", e1.body)).toBe(false);
    expect(quoteMatchesRecord("The service always returned 502.", e1.body)).toBe(false);
  });

  it("allows an ellipsis when the fragments appear in order", () => {
    expect(quoteMatchesRecord("The service returned 502 ... of calls", e1.body)).toBe(true);
    expect(quoteMatchesRecord("of calls ... The service returned", e1.body)).toBe(false);
  });

  it("normalizes curly apostrophes", () => {
    expect(normalizeForQuote("Don’t")).toBe("don't");
  });
});

describe("validateCitations", () => {
  it("flags unknown exhibits and misquotes, passes good citations", () => {
    const got = citeText('Fine [E1]. Missing [E9]. Wrong "rollback fixed it" [E2]. Right "did not change the error rate" [E2].', store);
    expect(got).toEqual([
      { evidenceId: "E1", valid: true },
      { evidenceId: "E9", valid: false, issue: "unknown-evidence" },
      { evidenceId: "E2", quote: "rollback fixed it", valid: false, issue: "misquote" },
      { evidenceId: "E2", quote: "did not change the error rate", valid: true },
    ]);
  });

  it("returns an empty list for uncited text", () => {
    expect(validateCitations(parseCitations("No citations at all."), store)).toEqual([]);
  });
});
