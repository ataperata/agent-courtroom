import { systemPrompt, BURDEN_TEXT } from "../agents/roles.js";
import { RULE_TEXT } from "../court/aggregation.js";
import type { ModelProvider } from "../providers/provider.js";
import type { Evidence, JurorVote, Participant, Role, Side, Temperament, Turn } from "../types.js";
import type { CourtEngine, JudgeMoment, JurorDecision, TrialContext, WitnessReply } from "./engine.js";

// Live mode. Each agent is a model call with its role's system prompt, the
// evidence file and the transcript so far. The orchestrator still checks every
// citation and rules on every objection, so a model that invents a quote gets
// struck just like the demo engine's planted mistakes.

function evidenceBlock(ctx: TrialContext): string {
  return ctx.store.items
    .map(
      (e) =>
        `### ${e.id}: ${e.title}\nkind: ${e.kind} | source: ${e.source} | reliability: ${e.reliability} | favors: ${e.favors}\n${e.body}`,
    )
    .join("\n\n");
}

function speaker(ctx: TrialContext, t: Turn): string {
  return ctx.participants.find((p) => p.id === t.speakerId)?.name ?? t.speakerId;
}

/** The transcript as text. Jurors never see struck statements. */
export function transcriptBlock(ctx: TrialContext, forJury = false): string {
  return ctx.turns
    .filter((t) => !(forJury && t.struck))
    .filter((t) => !(forJury && (t.kind === "objection" || t.kind === "ruling")))
    .map((t) => `#${t.seq} [${t.phase}] ${speaker(ctx, t)}${t.struck ? " (STRUCK)" : ""}: ${t.text}`)
    .join("\n");
}

/** Remove a leading "Prosecution:" style label and wrapping quotes the model may add. */
export function cleanSpeech(text: string): string {
  return text
    .trim()
    .replace(/^\**\s*(prosecution|defense|defence|witness|judge|juror[^:*]*|counsel)\s*\**\s*:\s*\**\s*/i, "")
    .trim();
}

/** Pull the first JSON object out of a model reply. */
export function extractJson(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(candidate.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const clamp01 = (x: unknown, fallback: number) => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

export class LlmEngine implements CourtEngine {
  readonly mode = "live" as const;
  readonly name: string;

  constructor(private readonly provider: ModelProvider) {
    this.name = `${provider.name}:${provider.model}`;
  }

  private async ask(ctx: TrialContext, role: Role, task: string, opts: { forJury?: boolean; temperament?: Temperament; witness?: string; maxTokens?: number } = {}): Promise<string> {
    const system = systemPrompt(role, ctx.caseFile, { temperament: opts.temperament, witness: opts.witness });
    const user = [
      `## Background\n${ctx.caseFile.background}`,
      `## Evidence in the record\n${evidenceBlock(ctx)}`,
      `## Transcript so far\n${transcriptBlock(ctx, opts.forJury) || "(nothing yet)"}`,
      `## Your task\n${task}`,
    ].join("\n\n");
    const out = await this.provider.complete({ system, messages: [{ role: "user", content: user }], maxTokens: opts.maxTokens ?? 500 });
    return out;
  }

  async judge(ctx: TrialContext, moment: JudgeMoment): Promise<string> {
    const c = ctx.caseFile;
    let task: string;
    if (moment.kind === "open") {
      task = `Open the trial in 2-3 sentences. State the claim, that the prosecution must prove it by ${BURDEN_TEXT[c.burden]}, and that every statement must cite an exhibit id.`;
    } else if (moment.kind === "instruct") {
      task = `Instruct the jury in 3-4 sentences: weigh only cited exhibits and statements that were not struck, apply ${BURDEN_TEXT[c.burden]}, and note that a verdict requires ${RULE_TEXT[ctx.rule]}. Do not hint at an outcome.`;
    } else {
      const v = moment.verdict;
      task = `Announce the verdict in 2-3 sentences. Facts you must state exactly: outcome = ${v.outcome.toUpperCase()}, vote ${v.tally.uphold} to uphold and ${v.tally.reject} to reject, rule = ${RULE_TEXT[v.rule]}, confidence = ${v.confidence.toFixed(2)}. Do not add other numbers.`;
    }
    return cleanSpeech(await this.ask(ctx, "judge", task, { maxTokens: 300 }));
  }

  async opening(ctx: TrialContext, side: Side): Promise<string> {
    return cleanSpeech(await this.ask(ctx, side, "Give your opening statement in 3 to 5 sentences. Cite exhibits by id."));
  }

  async presentEvidence(ctx: TrialContext, side: Side, item: Evidence): Promise<string> {
    return cleanSpeech(
      await this.ask(ctx, side, `Present exhibit ${item.id} (${item.title}) to the jury in 2 to 4 sentences. Quote one line from it exactly, in double quotes, followed by [${item.id}].`),
    );
  }

  async crossQuestion(ctx: TrialContext, side: Side, target: Evidence): Promise<string> {
    const hint = target.weakness ? ` A known limitation of this exhibit: ${target.weakness}` : "";
    return cleanSpeech(
      await this.ask(ctx, side, `Cross-examine ${target.source}, the witness behind exhibit ${target.id}. Ask one pointed question in 1 to 2 sentences and cite the exhibit.${hint}`),
    );
  }

  async witnessAnswer(ctx: TrialContext, target: Evidence, question: string): Promise<WitnessReply> {
    const raw = await this.ask(
      ctx,
      "witness",
      `You were asked: "${question}"\nAnswer as ${target.source}, the source of exhibit ${target.id}, in 1 to 3 sentences with citations. Reply with JSON only: {"answer": "...", "concedes": true or false}. "concedes" is true if you admit the limitation the question raises.`,
      { witness: `${target.source}, source of exhibit ${target.id}`, maxTokens: 300 },
    );
    const j = extractJson(raw);
    if (j && typeof j.answer === "string") return { text: cleanSpeech(j.answer), concedes: j.concedes === true };
    return { text: cleanSpeech(raw), concedes: /\b(yes|true|correct|fair|admit|grant)\b/i.test(raw.slice(0, 60)) };
  }

  async closing(ctx: TrialContext, side: Side, rebuttal: boolean): Promise<string> {
    const task = rebuttal
      ? "Give a short rebuttal to the defense closing in 2 to 3 sentences, with citations."
      : "Give your closing argument in 4 to 6 sentences. Address what came out on cross-examination and any struck statements. Cite exhibits.";
    return cleanSpeech(await this.ask(ctx, side, task, { maxTokens: 600 }));
  }

  async deliberate(ctx: TrialContext, juror: Participant, t: Temperament, round: number, previous: readonly JurorVote[] | null): Promise<JurorDecision> {
    const room =
      round > 1 && previous
        ? `\n\nRound one votes from the jury room:\n${previous
            .map((v) => `- ${ctx.participants.find((p) => p.id === v.jurorId)?.name}: ${v.vote} (${v.reasoning})`)
            .join("\n")}\nYou may change your vote or keep it.`
        : "";
    const raw = await this.ask(
      ctx,
      "juror",
      `You are ${juror.name}. Round ${round} of deliberation.${room}\nReply with JSON only: {"vote": "uphold" or "reject", "belief": probability 0-1 that the claim is true, "confidence": 0-1 how sure you are of your vote, "reasoning": "2 to 4 sentences citing exhibits like [E1]"}`,
      { forJury: true, temperament: t, maxTokens: 400 },
    );
    const j = extractJson(raw) ?? {};
    const belief = clamp01(j.belief, 0.5);
    const vote = j.vote === "uphold" || j.vote === "reject" ? j.vote : belief >= 0.5 ? "uphold" : "reject";
    return {
      vote,
      belief,
      confidence: clamp01(j.confidence, 0.6),
      reasoning: typeof j.reasoning === "string" && j.reasoning.trim() ? j.reasoning.trim() : cleanSpeech(raw),
    };
  }
}
