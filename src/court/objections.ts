import { quoteMatchesExactly } from "../evidence/citations.js";
import type { EvidenceStore } from "../evidence/store.js";
import type { Objection, Ruling, Side, Turn } from "../types.js";

/**
 * Opposing counsel's check. Counsel is eager: any quote that is not a
 * character-for-character match draws an objection. The judge is more
 * careful (see rule()), so some of these objections get overruled.
 */
export function findObjection(turn: Turn, by: Side, store: EvidenceStore): Objection | null {
  if (turn.citations.length === 0) {
    return { by, grounds: "uncited", detail: "Counsel's statement cites no evidence." };
  }
  const unknown = turn.citations.find((c) => !store.get(c.evidenceId));
  if (unknown) {
    return { by, grounds: "unknown-evidence", detail: `There is no exhibit ${unknown.evidenceId} in evidence.` };
  }
  for (const c of turn.citations) {
    const item = store.get(c.evidenceId);
    if (c.quote && item && !quoteMatchesExactly(c.quote, item.body)) {
      const end = /[.!?]$/.test(c.quote) ? "" : ".";
      return { by, grounds: "misquote", detail: `Exhibit ${c.evidenceId} does not read "${c.quote}"${end}` };
    }
  }
  return null;
}

/**
 * The judge's ruling. Decided by the citation checker, never by a model, so
 * no agent can argue its way past a quote that is not in the record.
 */
export function rule(objection: Objection, turn: Turn): Ruling {
  switch (objection.grounds) {
    case "uncited":
      return turn.citations.length === 0
        ? { outcome: "sustained", reason: "Counsel pointed to nothing in the record. The statement is struck and the jury will disregard it." }
        : { outcome: "overruled", reason: "The statement does cite the record." };
    case "unknown-evidence": {
      const bad = turn.citations.find((c) => c.issue === "unknown-evidence");
      return bad
        ? { outcome: "sustained", reason: `There is no exhibit ${bad.evidenceId} before this court. The statement is struck.` }
        : { outcome: "overruled", reason: "Every exhibit cited is in evidence." };
    }
    case "misquote": {
      const bad = turn.citations.find((c) => c.issue === "misquote");
      return bad
        ? { outcome: "sustained", reason: `Exhibit ${bad.evidenceId} does not say "${bad.quote}"${/[.!?]$/.test(bad.quote ?? "") ? "" : "."} Counsel may not put words in the record. The statement is struck.` }
        : { outcome: "overruled", reason: "The quoted words are in the exhibit. The difference is formatting, not substance." };
    }
  }
}
