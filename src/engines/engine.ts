import type { EvidenceStore } from "../evidence/store.js";
import type {
  CaseFile,
  Evidence,
  JurorVote,
  Participant,
  Side,
  Temperament,
  Turn,
  Verdict,
  VoteRule,
} from "../types.js";

/** Everything an agent may look at when it takes its turn. */
export interface TrialContext {
  caseFile: CaseFile;
  store: EvidenceStore;
  turns: readonly Turn[];
  participants: readonly Participant[];
  seed: string;
  rule: VoteRule;
}

export interface WitnessReply {
  text: string;
  /** Did the witness admit the limitation the question pressed on? */
  concedes: boolean;
}

export interface JurorDecision {
  vote: JurorVote["vote"];
  confidence: number;
  belief: number;
  reasoning: string;
}

export type JudgeMoment =
  | { kind: "open" }
  | { kind: "instruct" }
  | { kind: "verdict"; verdict: Omit<Verdict, "summary"> };

/**
 * An engine produces what each agent says. The orchestrator owns the order of
 * play, the citation checks, objections, rulings and vote counting, so every
 * engine gets the same rules applied to it.
 */
export interface CourtEngine {
  readonly name: string;
  readonly mode: "demo" | "live";
  judge(ctx: TrialContext, moment: JudgeMoment): Promise<string>;
  opening(ctx: TrialContext, side: Side): Promise<string>;
  presentEvidence(ctx: TrialContext, side: Side, item: Evidence): Promise<string>;
  crossQuestion(ctx: TrialContext, side: Side, target: Evidence): Promise<string>;
  witnessAnswer(ctx: TrialContext, target: Evidence, question: string): Promise<WitnessReply>;
  closing(ctx: TrialContext, side: Side, rebuttal: boolean): Promise<string>;
  deliberate(
    ctx: TrialContext,
    juror: Participant,
    temperament: Temperament,
    round: number,
    previous: readonly JurorVote[] | null,
  ): Promise<JurorDecision>;
}
