import AjvModule from "ajv";
import schema from "./transcript.schema.json" with { type: "json" };
import type { Transcript } from "../types.js";

// ajv ships CommonJS; under NodeNext the class sits on .default.
const Ajv = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule.default;
const ajv = new Ajv({ allErrors: true, strict: false });
const check = ajv.compile(schema);

export { schema as transcriptSchema };

export interface SchemaResult {
  valid: boolean;
  errors: string[];
}

/** Validate structure against the JSON schema, then cross-check references. */
export function validateTranscript(data: unknown): SchemaResult {
  const errors: string[] = [];
  if (!check(data)) {
    for (const e of check.errors ?? []) errors.push(`${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
    return { valid: false, errors };
  }
  const t = data as unknown as Transcript;
  const people = new Set(t.participants.map((p) => p.id));
  const exhibits = new Set(t.evidence.map((e) => e.id));
  t.turns.forEach((turn, i) => {
    if (turn.seq !== i + 1) errors.push(`/turns/${i} seq ${turn.seq} is out of order`);
    if (!people.has(turn.speakerId)) errors.push(`/turns/${i} unknown speaker ${turn.speakerId}`);
    if (turn.refersTo !== undefined && turn.refersTo >= turn.seq) errors.push(`/turns/${i} refers forward to #${turn.refersTo}`);
    for (const c of turn.citations) {
      if (c.valid && !exhibits.has(c.evidenceId)) errors.push(`/turns/${i} marks unknown ${c.evidenceId} as valid`);
    }
  });
  const last = t.deliberation[t.deliberation.length - 1];
  if (last) {
    const up = last.votes.filter((v) => v.vote === "uphold").length;
    if (up !== t.verdict.tally.uphold || last.votes.length - up !== t.verdict.tally.reject) {
      errors.push("/verdict tally does not match the final round of votes");
    }
  }
  return { valid: errors.length === 0, errors };
}
