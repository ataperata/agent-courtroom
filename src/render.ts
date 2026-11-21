import type { Participant, Transcript, Turn } from "./types.js";

// Console rendering for the CLI. ANSI colors only when the stream is a TTY.

const CODES = { reset: 0, bold: 1, dim: 2, strike: 9, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90 } as const;
type Code = keyof typeof CODES;

export function painter(enabled: boolean) {
  return (text: string, ...codes: Code[]) =>
    enabled && codes.length ? `\x1b[${codes.map((c) => CODES[c]).join(";")}m${text}\x1b[0m` : text;
}

const PHASE_TITLES: Record<string, string> = {
  opening: "OPENING STATEMENTS",
  evidence: "PRESENTATION OF EVIDENCE",
  cross: "CROSS-EXAMINATION",
  closing: "CLOSING ARGUMENTS",
  deliberation: "JURY DELIBERATION",
  verdict: "VERDICT",
};

const ROLE_COLOR: Record<string, Code> = {
  judge: "yellow",
  clerk: "gray",
  prosecution: "red",
  defense: "blue",
  witness: "magenta",
  juror: "cyan",
};

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

export function renderTurn(turn: Turn, people: Map<string, Participant>, color: boolean, lastPhase?: string): string {
  const p = painter(color);
  const out: string[] = [];
  if (turn.phase !== lastPhase) {
    out.push("", p(`== ${PHASE_TITLES[turn.phase] ?? turn.phase} ==`, "bold"));
  }
  const who = people.get(turn.speakerId);
  let name = who?.name ?? turn.speakerId;
  if (turn.kind === "objection") name += " (objection)";
  const tag = p(name.toUpperCase(), ROLE_COLOR[turn.role] ?? "reset", "bold");
  let body = turn.text;
  if (turn.struck) body = p(body, "strike", "dim") + " " + p("[STRICKEN]", "red", "bold");
  else if (turn.kind === "ruling") body = p(body, turn.ruling?.outcome === "sustained" ? "red" : "green");
  out.push(`${p(String(turn.seq).padStart(3), "gray")} ${tag}`);
  out.push(wrap(body, 92, "    "));
  return out.join("\n");
}

export function renderSummary(t: Transcript, color: boolean): string {
  const p = painter(color);
  const v = t.verdict;
  const outcomeColor: Code = v.outcome === "upheld" ? "green" : v.outcome === "rejected" ? "red" : "yellow";
  const people = new Map(t.participants.map((x) => [x.id, x]));
  const finalRound = t.deliberation[t.deliberation.length - 1];
  const firstRound = t.deliberation[0];
  const lines = [
    "",
    p("-".repeat(96), "gray"),
    `${p("CASE", "bold")}     ${t.case.title}`,
    `${p("CLAIM", "bold")}    ${t.case.claim}`,
    `${p("VERDICT", "bold")}  ${p(v.outcome.toUpperCase(), outcomeColor, "bold")}  ${v.tally.uphold}-${v.tally.reject} (${v.rule})  confidence ${v.confidence.toFixed(2)}`,
    `${p("RECORD", "bold")}   ${t.stats.turns} turns, ${t.stats.citations} citations, ${t.stats.objections} objections (${t.stats.sustained} sustained, ${t.stats.overruled} overruled), ${t.stats.struckTurns} struck, ${t.stats.impeachments} impeachments`,
    p("JURY", "bold"),
  ];
  for (const vote of finalRound?.votes ?? []) {
    const juror = people.get(vote.jurorId);
    const first = firstRound?.votes.find((x) => x.jurorId === vote.jurorId);
    const moved = first && first.vote !== vote.vote ? p(` (was ${first.vote})`, "yellow") : "";
    lines.push(
      `  ${(juror?.name ?? vote.jurorId).padEnd(22)} ${(juror?.temperament ?? "").padEnd(11)} ${p(vote.vote.padEnd(7), vote.vote === "uphold" ? "green" : "red")} conf ${vote.confidence.toFixed(2)}${moved}`,
    );
  }
  lines.push(p("-".repeat(96), "gray"));
  return lines.join("\n");
}

export function renderTranscript(t: Transcript, color: boolean): string {
  const people = new Map(t.participants.map((x) => [x.id, x]));
  let last: string | undefined;
  const parts = [painter(color)(`${t.case.title}  [${t.mode} mode, engine ${t.engine}, seed ${t.seed}]`, "bold")];
  for (const turn of t.turns) {
    parts.push(renderTurn(turn, people, color, last));
    last = turn.phase;
  }
  parts.push(renderSummary(t, color));
  return parts.join("\n");
}
