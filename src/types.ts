// Shared types for the courtroom. The transcript types mirror
// schema/transcript.schema.json; keep the two in sync.

export const SCHEMA_VERSION = "1.0";

export type Side = "prosecution" | "defense";
export type Role = "judge" | Side | "witness" | "juror" | "clerk";
export type Favors = Side | "neutral";

export type Phase =
  | "opening"
  | "evidence"
  | "cross"
  | "closing"
  | "deliberation"
  | "verdict";

export const PHASES: readonly Phase[] = [
  "opening",
  "evidence",
  "cross",
  "closing",
  "deliberation",
  "verdict",
];

export type EvidenceKind = "log" | "data" | "document" | "testimony" | "inspection";

/** Standard of proof the prosecution must meet. */
export type BurdenOfProof = "preponderance" | "clear-and-convincing" | "beyond-reasonable-doubt";

export type VoteRule = "majority" | "supermajority" | "unanimous";

export interface Evidence {
  id: string;
  title: string;
  kind: EvidenceKind;
  /** Who produced or vouches for the item. Doubles as the witness on cross. */
  source: string;
  /** 0..1, how much a careful reader should trust this item on its face. */
  reliability: number;
  favors: Favors;
  /** One sentence: what this item shows. */
  summary: string;
  /** A sentence from the body that counsel can quote verbatim. */
  quote: string;
  /** The soft spot opposing counsel will press on cross-examination. */
  weakness?: string;
  /** 0..1, how much of the item's weight a conceded weakness removes. Default 0.45. */
  impact?: number;
  /** How the witness answers when the weakness is pressed. */
  rebuttal?: string;
  /** Demo engine only: an overstated version of the quote, used to exercise the judge. */
  misquote?: string;
  body: string;
  file?: string;
}

export interface CaseFile {
  id: string;
  title: string;
  claim: string;
  background: string;
  burden: BurdenOfProof;
  prosecutionTheory: string;
  defenseTheory: string;
  evidence: Evidence[];
}

export type CitationIssue = "unknown-evidence" | "misquote";

export interface Citation {
  evidenceId: string;
  quote?: string;
  valid: boolean;
  issue?: CitationIssue;
}

export type ObjectionGround = "uncited" | "unknown-evidence" | "misquote";

export interface Objection {
  by: Side;
  grounds: ObjectionGround;
  detail: string;
}

export type RulingOutcome = "sustained" | "overruled";

export interface Ruling {
  outcome: RulingOutcome;
  reason: string;
}

export type TurnKind =
  | "remark"
  | "instruction"
  | "statement"
  | "question"
  | "answer"
  | "objection"
  | "ruling"
  | "deliberation"
  | "verdict";

export interface Turn {
  seq: number;
  phase: Phase;
  speakerId: string;
  role: Role;
  kind: TurnKind;
  text: string;
  citations: Citation[];
  /** Set when the judge sustains an objection against this turn. */
  struck?: boolean;
  /** For objections and rulings: the seq of the turn being objected to. */
  refersTo?: number;
  objection?: Objection;
  ruling?: Ruling;
  /** Cross-examination effect on an evidence item, if any. */
  impeachment?: Impeachment;
}

export interface Impeachment {
  evidenceId: string;
  /** Multiplier applied to the item's weight, 0..1. */
  factor: number;
  conceded: boolean;
}

export interface Temperament {
  key: string;
  label: string;
  description: string;
  /** Multipliers per evidence kind. */
  kindWeights: Record<EvidenceKind, number>;
  /** Exponent on reliability; higher means low-reliability items count for less. */
  reliabilityExponent: number;
  /** Added to the burden threshold. Positive is harder to convince. */
  thresholdShift: number;
  /** Weight penalty per sustained objection against a side. */
  procedurePenalty: number;
  /** 0..1, how far the juror moves toward the room in round two. */
  conformity: number;
}

export interface Participant {
  id: string;
  role: Role;
  name: string;
  temperament?: string;
}

export type Vote = "uphold" | "reject";

export interface JurorVote {
  jurorId: string;
  vote: Vote;
  /** 0..1 */
  confidence: number;
  /** Juror's estimate that the claim is true, 0..1. */
  belief: number;
  reasoning: string;
  citations: Citation[];
}

export interface DeliberationRound {
  round: number;
  votes: JurorVote[];
}

export type VerdictOutcome = "upheld" | "rejected" | "hung";

export interface Verdict {
  outcome: VerdictOutcome;
  rule: VoteRule;
  tally: { uphold: number; reject: number };
  /** 0..1, how settled the outcome is. */
  confidence: number;
  summary: string;
}

export interface TrialStats {
  turns: number;
  citations: number;
  invalidCitations: number;
  objections: number;
  sustained: number;
  overruled: number;
  struckTurns: number;
  impeachments: number;
}

export interface Transcript {
  schemaVersion: string;
  id: string;
  mode: "demo" | "live";
  engine: string;
  seed: string;
  generatedAt: string;
  case: {
    id: string;
    title: string;
    claim: string;
    background: string;
    burden: BurdenOfProof;
  };
  evidence: Array<Omit<Evidence, "body" | "file" | "misquote">>;
  participants: Participant[];
  turns: Turn[];
  deliberation: DeliberationRound[];
  verdict: Verdict;
  stats: TrialStats;
}
