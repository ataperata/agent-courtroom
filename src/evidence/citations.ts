import type { Citation, Evidence } from "../types.js";

// Citation syntax used by every agent:
//   plain:   ... the outage started at 09:02 [E2]
//   several: ... as both logs show [E2, E4]
//   quoted:  ... the log reads "handshake failure" [E2]
// A quote binds to the first id in the bracket that follows it.

const CITE_RE = /(?:["“]([^"“”]{1,400})["”]\s*)?\[(E\d+(?:\s*[,;]\s*E\d+)*)\]/g;

export interface RawCitation {
  evidenceId: string;
  quote?: string;
}

export function parseCitations(text: string): RawCitation[] {
  const out: RawCitation[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CITE_RE)) {
    const quote = m[1]?.trim();
    const ids = (m[2] ?? "").split(/\s*[,;]\s*/).filter(Boolean);
    ids.forEach((id, i) => {
      const c: RawCitation = i === 0 && quote ? { evidenceId: id, quote } : { evidenceId: id };
      const key = `${c.evidenceId}|${c.quote ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(c);
      }
    });
  }
  return out;
}

/**
 * Normalize text for quote comparison: case, curly quotes, markdown markers
 * and whitespace are ignored. Wording, numbers and order are not.
 */
export function normalizeForQuote(text: string): string {
  return text
    .replace(/^\s*(?:>|-|\*|\|)\s?/gm, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[*`_|]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "");
}

/** Exact, character for character. This is what an eager lawyer checks. */
export function quoteMatchesExactly(quote: string, body: string): boolean {
  return body.includes(quote);
}

/**
 * The judge's test. Ignores formatting differences and allows an ellipsis
 * ("..." or "…") to skip text, as long as the fragments appear in order.
 */
export function quoteMatchesRecord(quote: string, body: string): boolean {
  const hay = normalizeForQuote(body);
  const fragments = quote
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map(normalizeForQuote)
    .filter((f) => f.length > 0);
  if (fragments.length === 0) return false;
  let from = 0;
  for (const frag of fragments) {
    const at = hay.indexOf(frag, from);
    if (at === -1) return false;
    from = at + frag.length;
  }
  return true;
}

export function validateCitations(raw: RawCitation[], evidence: Map<string, Evidence>): Citation[] {
  return raw.map((c) => {
    const item = evidence.get(c.evidenceId);
    const base: Citation = c.quote ? { evidenceId: c.evidenceId, quote: c.quote, valid: true } : { evidenceId: c.evidenceId, valid: true };
    if (!item) return { ...base, valid: false, issue: "unknown-evidence" };
    if (c.quote && !quoteMatchesRecord(c.quote, item.body)) {
      return { ...base, valid: false, issue: "misquote" };
    }
    return base;
  });
}

export function citeText(text: string, evidence: Map<string, Evidence>): Citation[] {
  return validateCitations(parseCitations(text), evidence);
}
