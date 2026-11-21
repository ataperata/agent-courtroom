import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/evidence/frontmatter.js";
import { parseEvidence } from "../src/evidence/store.js";
import { caseDirs, loadBundled } from "./helpers.js";
import { loadCase } from "../src/evidence/store.js";

const doc = (head: string, body = "The line we quote is here.") => `---\n${head}\n---\n${body}\n`;
const good = `id: E3
title: Test
kind: data
source: Someone
reliability: 0.7
favors: defense
summary: A summary.
quote: "The line we quote is here."`;

describe("frontmatter", () => {
  it("reads key/value pairs and strips quotes", () => {
    const { data, body } = parseFrontmatter(doc('a: 1\nb: "two words"'), "t");
    expect(data).toEqual({ a: "1", b: "two words" });
    expect(body).toBe("The line we quote is here.");
  });

  it("rejects a file with no frontmatter", () => {
    expect(() => parseFrontmatter("hello", "t")).toThrow(/missing frontmatter/);
  });
});

describe("parseEvidence", () => {
  it("parses a valid exhibit", () => {
    const e = parseEvidence(doc(good));
    expect(e).toMatchObject({ id: "E3", kind: "data", reliability: 0.7, favors: "defense" });
  });

  it.each([
    ["bad id", good.replace("id: E3", "id: X3"), /must look like/],
    ["bad kind", good.replace("kind: data", "kind: rumor"), /kind must be/],
    ["reliability out of range", good.replace("0.7", "1.4"), /reliability/],
    ["quote not in body", good.replace("The line we quote", "A line we never wrote"), /does not appear verbatim/],
    ["missing summary", good.replace("summary: A summary.\n", ""), /summary/],
  ])("rejects %s", (_name, head, err) => {
    expect(() => parseEvidence(doc(head))).toThrow(err);
  });

  it("rejects a misquote that actually matches the record", () => {
    expect(() => parseEvidence(doc(`${good}\nmisquote: the LINE we quote is here`))).toThrow(/must not match/);
  });
});

describe("bundled cases", () => {
  it("ships at least three cases", () => {
    expect(caseDirs().length).toBeGreaterThanOrEqual(3);
  });

  it.each(caseDirs())("%s loads, with evidence for both sides", (dir) => {
    const c = loadCase(dir);
    expect(c.evidence.some((e) => e.favors === "prosecution")).toBe(true);
    expect(c.evidence.some((e) => e.favors === "defense")).toBe(true);
    expect(new Set(c.evidence.map((e) => e.id)).size).toBe(c.evidence.length);
  });

  it("orders exhibits numerically", () => {
    expect(loadBundled("four-day-week").evidence.map((e) => e.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  });
});
