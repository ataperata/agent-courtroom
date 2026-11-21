// Public API for using the courtroom as a library.
export * from "./types.js";
export { runTrial, DEFAULTS, DEMO_TIMESTAMP, impeachmentFactor, type TrialOptions } from "./court/orchestrator.js";
export { aggregateVotes, votesRequired } from "./court/aggregation.js";
export { findObjection, rule } from "./court/objections.js";
export { assess, buildRecord } from "./court/scoring.js";
export { parseCitations, validateCitations, citeText, quoteMatchesRecord } from "./evidence/citations.js";
export { loadCase, listCaseDirs, parseEvidence, EvidenceStore } from "./evidence/store.js";
export { ScriptedEngine } from "./engines/scripted.js";
export { LlmEngine } from "./engines/llm.js";
export type { CourtEngine, TrialContext } from "./engines/engine.js";
export { selectProvider, AnthropicProvider, OpenAIProvider } from "./providers/index.js";
export type { ModelProvider, CompletionRequest } from "./providers/provider.js";
export { seatJury, TEMPERAMENTS } from "./agents/jurors.js";
export { systemPrompt } from "./agents/roles.js";
export { validateTranscript, transcriptSchema } from "./schema/validate.js";
