import type { EvidenceKind, Participant, Temperament } from "../types.js";

function weights(w: Partial<Record<EvidenceKind, number>>): Record<EvidenceKind, number> {
  return { log: 1, data: 1, document: 1, testimony: 1, inspection: 1, ...w };
}

// Each juror reads the same record through a different lens. The numbers are
// small nudges, not caricatures: a skeptic still convicts on strong evidence.
export const TEMPERAMENTS: Temperament[] = [
  {
    key: "engineer",
    label: "The Engineer",
    description: "Trusts logs, measurements and inspections. Discounts recollection.",
    kindWeights: weights({ log: 1.35, data: 1.3, inspection: 1.25, testimony: 0.6 }),
    reliabilityExponent: 1.4,
    thresholdShift: 0,
    procedurePenalty: 0.05,
    conformity: 0.15,
  },
  {
    key: "skeptic",
    label: "The Skeptic",
    description: "Needs more than the standard requires before moving. Weak items barely register.",
    kindWeights: weights({}),
    reliabilityExponent: 2.2,
    thresholdShift: 0.08,
    procedurePenalty: 0.1,
    conformity: 0.05,
  },
  {
    key: "empath",
    label: "The Empath",
    description: "Listens closely to people. Gives first-hand testimony real weight.",
    kindWeights: weights({ testimony: 1.45, document: 0.95, log: 0.9 }),
    reliabilityExponent: 0.8,
    thresholdShift: -0.02,
    procedurePenalty: 0.05,
    conformity: 0.35,
  },
  {
    key: "stickler",
    label: "The Stickler",
    description: "Cares about process. A side that gets caught misquoting loses credibility.",
    kindWeights: weights({ document: 1.25 }),
    reliabilityExponent: 1.2,
    thresholdShift: 0.03,
    procedurePenalty: 0.35,
    conformity: 0.1,
  },
  {
    key: "pragmatist",
    label: "The Pragmatist",
    description: "Asks what most likely happened, weighs everything evenly, and moves on.",
    kindWeights: weights({}),
    reliabilityExponent: 1,
    thresholdShift: -0.03,
    procedurePenalty: 0.05,
    conformity: 0.3,
  },
  {
    key: "contrarian",
    label: "The Contrarian",
    description: "Distrusts whichever side argues loudest. Gives the underdog a second look.",
    kindWeights: weights({ testimony: 1.1, data: 0.9 }),
    reliabilityExponent: 1.1,
    thresholdShift: 0.02,
    procedurePenalty: 0.15,
    conformity: -0.1,
  },
  {
    key: "auditor",
    label: "The Auditor",
    description: "Follows the paper trail. Documents and records beat opinions.",
    kindWeights: weights({ document: 1.35, data: 1.15, testimony: 0.8 }),
    reliabilityExponent: 1.5,
    thresholdShift: 0.02,
    procedurePenalty: 0.2,
    conformity: 0.1,
  },
];

const FIRST_NAMES = ["Dana", "Morgan", "Rosa", "Theo", "Imani", "Walt", "Keiko", "Luis", "Priya", "Owen", "Hana", "Ezra"];

export function temperamentByKey(key: string): Temperament {
  const t = TEMPERAMENTS.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown temperament "${key}"`);
  return t;
}

/** Seat a jury of n. Temperaments cycle in a fixed order so seating is deterministic. */
export function seatJury(n: number): Participant[] {
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error("Jury size must be between 1 and 12");
  return Array.from({ length: n }, (_, i) => {
    const t = TEMPERAMENTS[i % TEMPERAMENTS.length]!;
    return {
      id: `juror-${i + 1}`,
      role: "juror" as const,
      name: `Juror ${i + 1} (${FIRST_NAMES[i]})`,
      temperament: t.key,
    };
  });
}
