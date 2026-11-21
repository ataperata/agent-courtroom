import { BURDEN_TEXT } from "../agents/roles.js";
import { RULE_TEXT, votesRequired } from "../court/aggregation.js";
import { assess, buildRecord, voteConfidence, type RecordView } from "../court/scoring.js";
import { rngFor } from "../rng.js";
import type { BurdenOfProof, Evidence, JurorVote, Participant, Side, Temperament } from "../types.js";
import type { CourtEngine, JudgeMoment, JurorDecision, TrialContext, WitnessReply } from "./engine.js";

// Demo mode. No network, no model: every line is built from the case file
// with seeded choices, and every juror reasons from the filtered record with
// the scoring model in court/scoring.ts. Same seed, same trial, byte for byte.
//
// To keep the judge busy the engine plants a few realistic mistakes, chosen
// by the seed: an overstated quote (sustained), a quote that only differs in
// formatting (overruled), and a cross-examination question with no basis in
// the record (sustained, witness need not answer).

const BURDEN_SHORT: Record<BurdenOfProof, string> = {
  preponderance: "more likely than not",
  "clear-and-convincing": "clear and convincing",
  "beyond-reasonable-doubt": "beyond a reasonable doubt",
};

const ex = (e: Evidence) => `Exhibit ${e.id} (${e.title})`;

/** Lowercase the first letter unless it starts an acronym like "SRE". */
export function lcFirst(s: string): string {
  if (s.length > 1 && /[A-Z]/.test(s[0]!) && /[a-z ]/.test(s[1]!)) return s[0]!.toLowerCase() + s.slice(1);
  return s;
}

/** Put a citation inside the sentence: "Text [E1]." */
export function cite(sentence: string, id: string): string {
  return `${sentence.trim().replace(/[.!?]+$/, "")} [${id}].`;
}

/** "Priya Shah, SRE on call" needs a closing comma mid-sentence. */
const named = (source: string) => (source.includes(", ") ? `${source},` : source);

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const asQuestion = (s: string) => s.trim().replace(/[.!]+$/, "") + "?";
const pct = (x: number) => `${Math.round(x * 100)}%`;

const OVERSTATEMENTS: Array<[RegExp, string]> = [
  [/\bmay\b/, "will"],
  [/\bsome\b/, "all"],
  [/\blikely\b/, "certain"],
  [/\bpartial\b/, "complete"],
  [/\bcould\b/, "did"],
  [/\bmost\b/, "every"],
  [/\bseveral\b/, "dozens of"],
  [/\bminor\b/, "major"],
];

/** Turn an accurate quote into a plausible overstatement of it. */
export function overstate(quote: string): string {
  for (const [re, rep] of OVERSTATEMENTS) {
    if (re.test(quote)) return quote.replace(re, rep);
  }
  const num = /\d+(?:\.\d+)?/.exec(quote);
  if (num) {
    const n = Number(num[0]);
    const bumped = Number.isInteger(n) ? String(n === 0 ? 1 : n * 2) : (n * 2).toFixed(1);
    return quote.slice(0, num.index) + bumped + quote.slice(num.index + num[0].length);
  }
  const sp = quote.indexOf(" ");
  return sp === -1 ? `clearly ${quote}` : `${quote.slice(0, sp)} clearly${quote.slice(sp)}`;
}

/** Same words, different formatting: flipped first-letter case and a doubled space. */
export function reformat(quote: string): string {
  const first = quote[0] ?? "";
  const flipped = first === first.toLowerCase() ? first.toUpperCase() : first.toLowerCase();
  return (flipped + quote.slice(1)).replace(" ", "  ");
}

interface FlawPlan {
  misquote?: string;
  reformat?: string;
  uncitedCross?: Side;
}

export class ScriptedEngine implements CourtEngine {
  readonly name = "scripted";
  readonly mode = "demo" as const;
  private plan: FlawPlan | null = null;
  private usedUncited = false;

  constructor(private readonly options: { flaws?: boolean } = {}) {}

  private flaws(ctx: TrialContext): FlawPlan {
    if (this.plan) return this.plan;
    const plan: FlawPlan = {};
    if (this.options.flaws !== false) {
      const contested = ctx.store.items.filter((e) => e.favors !== "neutral");
      const r = rngFor(ctx.seed, `${ctx.caseFile.id}:flaws`);
      if (contested.length && r.chance(0.85)) plan.misquote = r.pick(contested).id;
      const rest = contested.filter((e) => e.id !== plan.misquote);
      if (rest.length && r.chance(0.75)) plan.reformat = r.pick(rest).id;
      if (r.chance(0.7)) plan.uncitedCross = r.pick(["prosecution", "defense"] as const);
    }
    this.plan = plan;
    return plan;
  }

  private rng(ctx: TrialContext, label: string) {
    return rngFor(ctx.seed, `${ctx.caseFile.id}:${label}`);
  }

  private strongest(ctx: TrialContext, side: Side, n: number): Evidence[] {
    return ctx.store
      .favoring(side)
      .slice()
      .sort((a, b) => b.reliability - a.reliability || a.id.localeCompare(b.id))
      .slice(0, n);
  }

  async judge(ctx: TrialContext, moment: JudgeMoment): Promise<string> {
    const c = ctx.caseFile;
    if (moment.kind === "open") {
      return `Court is in session. The question for this jury is a single claim: ${c.claim} The prosecution carries the burden and must prove it by ${BURDEN_TEXT[c.burden]}. Counsel, every statement you make must cite an exhibit by its id. I will rule on objections as they come, and anything I strike is gone from the record.`;
    }
    if (moment.kind === "instruct") {
      const rec = buildRecord(ctx.turns);
      const struck = rec.struckTurns.length;
      const struckLine =
        struck === 0
          ? "Nothing was struck during this trial."
          : `${struck === 1 ? "One statement was" : `${struck} statements were`} struck. You will not consider ${struck === 1 ? "it" : "them"}.`;
      const jurors = ctx.participants.filter((p) => p.role === "juror").length;
      const need = votesRequired(jurors, ctx.rule);
      return `Members of the jury, you may weigh only exhibits that were properly cited and statements that were not struck. ${struckLine} The standard is ${BURDEN_TEXT[c.burden]}. You will vote twice: first on your own, then again after hearing each other. A verdict requires ${RULE_TEXT[ctx.rule]}. With ${jurors} of you, that means ${need} must agree, one way or the other.`;
    }
    const v = moment.verdict;
    const tally = `${v.tally.uphold} to ${v.tally.reject}`;
    if (v.outcome === "hung") {
      const need = votesRequired(v.tally.uphold + v.tally.reject, v.rule);
      return `A verdict needed ${need} votes one way or the other, and neither side reached it. The final vote stands at ${v.tally.uphold} to uphold and ${v.tally.reject} to reject. I declare a hung jury. The claim is neither upheld nor rejected on this record.`;
    }
    const word = v.outcome === "upheld" ? "UPHELD" : "REJECTED";
    return `The jury has reached a verdict. By a vote of ${tally}, the claim is ${word}: ${c.claim} The court records a verdict confidence of ${v.confidence.toFixed(2)}. I thank the jury for its service.`;
  }

  async opening(ctx: TrialContext, side: Side): Promise<string> {
    const c = ctx.caseFile;
    const r = this.rng(ctx, `opening:${side}`);
    if (side === "prosecution") {
      const [a, b] = this.strongest(ctx, "prosecution", 2);
      const intro = r.pick(["Members of the jury, this case comes down to one claim.", "Members of the jury, the question in front of you is narrow.", "Good morning. You are here to decide one thing."]);
      const parts = [intro, c.claim, c.prosecutionTheory];
      if (a) parts.push(`You will see ${ex(a)} [${a.id}]. ${a.summary}`);
      if (b) parts.push(`You will also see ${ex(b)} [${b.id}]. ${b.summary}`);
      parts.push(`Our burden is ${BURDEN_TEXT[c.burden]}. The record meets it.`);
      return parts.join(" ");
    }
    const [d] = this.strongest(ctx, "defense", 1);
    const [pa] = this.strongest(ctx, "prosecution", 1);
    const intro = r.pick(["The prosecution has told you what it hopes the evidence shows.", "You've heard a confident story. Confidence is not proof.", "Listen carefully to what the prosecution has to prove."]);
    const parts = [intro, `They must prove it ${BURDEN_SHORT[c.burden]}.`, c.defenseTheory];
    if (d) parts.push(`Consider ${ex(d)} [${d.id}]. ${d.summary}`);
    if (pa?.weakness) parts.push(`And keep in mind what their own exhibit cannot tell you: ${cite(lcFirst(pa.weakness), pa.id)}`);
    return parts.join(" ");
  }

  async presentEvidence(ctx: TrialContext, side: Side, item: Evidence): Promise<string> {
    const plan = this.flaws(ctx);
    const r = this.rng(ctx, `present:${item.id}`);
    let quote = item.quote;
    if (plan.misquote === item.id) quote = item.misquote ?? overstate(quote);
    else if (plan.reformat === item.id) quote = reformat(quote);
    const who = side === "prosecution" ? "The prosecution" : "The defense";
    const forms = [
      () => `${who} offers ${ex(item)}, from ${item.source}. ${item.summary} In its own words: "${quote}" [${item.id}].`,
      () => `${who} calls attention to ${ex(item)}. The key line reads "${quote}" [${item.id}]. ${item.summary}`,
      () => `Next, ${ex(item)}, provided by ${item.source}. ${item.summary} The record is direct on this point: "${quote}" [${item.id}].`,
    ];
    return r.pick(forms)();
  }

  async crossQuestion(ctx: TrialContext, side: Side, target: Evidence): Promise<string> {
    const plan = this.flaws(ctx);
    if (plan.uncitedCross === side && !this.usedUncited) {
      this.usedUncited = true;
      const r = this.rng(ctx, `uncited:${side}`);
      return r.pick([
        `Isn't it true that ${target.source} has gotten this kind of thing wrong before?`,
        `Wouldn't you agree that nobody really trusts reports like this one?`,
        `You were under a lot of pressure to produce this, weren't you?`,
      ]);
    }
    const r = this.rng(ctx, `cross:${side}:${target.id}`);
    const weakness = target.weakness ?? "this exhibit has limits";
    const lead = r.pick([
      `Your exhibit says "${target.quote}" [${target.id}].`,
      `Let's look at ${ex(target)} [${target.id}].`,
      `You stand behind ${ex(target)} [${target.id}], correct?`,
    ]);
    return `${lead} But isn't it true that ${lcFirst(asQuestion(weakness))}`;
  }

  async witnessAnswer(ctx: TrialContext, target: Evidence, _question: string): Promise<WitnessReply> {
    const r = this.rng(ctx, `answer:${target.id}`);
    const weakness = target.weakness ?? "The exhibit has limits.";
    const admit = r.pick(["That's fair.", "Yes, that's true.", "I'll grant that."]);
    if (target.rebuttal) {
      return { text: `${admit} ${cite(weakness, target.id)} But ${cite(lcFirst(target.rebuttal), target.id)}`, concedes: true };
    }
    return { text: `${admit} ${cite(weakness, target.id)} I can only speak to what the exhibit covers.`, concedes: true };
  }

  private impeached(ctx: TrialContext, rec: RecordView, side: Side): Evidence[] {
    return ctx.store.favoring(side).filter((e) => (rec.impeachment.get(e.id) ?? 1) < 1);
  }

  private surviving(ctx: TrialContext, rec: RecordView, side: Side): Evidence[] {
    return ctx.store
      .favoring(side)
      .filter((e) => (rec.mentions.get(e.id) ?? 0) > 0)
      .sort((a, b) => b.reliability * (rec.impeachment.get(b.id) ?? 1) - a.reliability * (rec.impeachment.get(a.id) ?? 1));
  }

  async closing(ctx: TrialContext, side: Side, rebuttal: boolean): Promise<string> {
    const c = ctx.caseFile;
    const rec = buildRecord(ctx.turns);
    const r = this.rng(ctx, `closing:${side}:${rebuttal}`);
    const mine = this.surviving(ctx, rec, side);
    const theirs = this.surviving(ctx, rec, side === "prosecution" ? "defense" : "prosecution");

    if (rebuttal) {
      const top = mine[0];
      const them = theirs[0];
      const parts = ["Briefly, in rebuttal."];
      if (them) parts.push(`The defense wants you to focus on ${ex(them)} [${them.id}].`);
      if (top) parts.push(`But the record also says "${top.quote}" [${top.id}].`);
      parts.push("Weigh the whole record, not one exhibit in isolation.");
      return parts.join(" ");
    }

    if (side === "prosecution") {
      const parts = [r.pick(["Let's take stock of what you've seen.", "Here is where the record leaves us.", "Step back and look at the whole record."])];
      const list = mine.slice(0, 3);
      if (list.length) parts.push(`${listJoin(list.map((e) => `${ex(e)} [${e.id}]`))} ${list.length > 2 ? "all point the same way" : list.length === 2 ? "both point the same way" : "points one way"}.`);
      const hit = this.impeached(ctx, rec, "prosecution")[0];
      if (hit?.rebuttal) parts.push(`The defense pressed ${named(hit.source)} on a limitation, and the answer held up: ${cite(lcFirst(hit.rebuttal), hit.id)}`);
      else if (hit?.weakness) parts.push(`Yes, ${cite(lcFirst(hit.weakness), hit.id)} That narrows the exhibit. It does not erase it.`);
      if (rec.sustainedAgainst.defense > 0) parts.push(`And remember that the court struck part of the defense case for straying from the record [${(mine[0] ?? ctx.store.items[0]!).id}].`);
      parts.push(`The standard is ${BURDEN_SHORT[c.burden]}. On this record, it is met.`);
      return parts.join(" ");
    }

    const parts = [r.pick(["The burden never moved. It sits with the prosecution.", "The prosecution had one job: meet the standard.", "Let me tell you what the prosecution didn't prove."])];
    for (const e of this.impeached(ctx, rec, "prosecution").slice(0, 2)) {
      parts.push(`Under cross-examination, ${named(e.source)} admitted that ${cite(lcFirst(e.weakness ?? "the exhibit has limits."), e.id)}`);
    }
    const top = mine[0];
    if (top) parts.push(`Then there is ${ex(top)} [${top.id}]. ${top.summary}`);
    if (rec.sustainedAgainst.prosecution > 0) {
      parts.push(`The court also struck part of the prosecution's case for reaching past the record. Ask yourselves why they needed to [${(top ?? ctx.store.items[0]!).id}].`);
    }
    parts.push(`That is not ${BURDEN_SHORT[c.burden]}. The claim has not been proven.`);
    return parts.join(" ");
  }

  async deliberate(
    ctx: TrialContext,
    juror: Participant,
    t: Temperament,
    round: number,
    previous: readonly JurorVote[] | null,
  ): Promise<JurorDecision> {
    const rec = buildRecord(ctx.turns);
    const a = assess(t, rec, ctx.store, ctx.caseFile.burden);
    let belief = a.belief;
    const before = previous?.find((v) => v.jurorId === juror.id);
    if (round > 1 && previous && previous.length) {
      const room = previous.reduce((s, v) => s + v.belief, 0) / previous.length;
      belief = Math.min(0.99, Math.max(0.01, belief + t.conformity * (room - belief)));
    }
    const vote = belief >= a.threshold ? "uphold" : "reject";
    const confidence = voteConfidence(belief, a.threshold);
    const r = this.rng(ctx, `juror:${juror.id}:${round}`);

    const LEADS: Record<string, [string, string]> = {
      engineer: ["The measurements carry this one.", "The hard data doesn't close the gap."],
      skeptic: ["I came in doubtful, and the record still got me over the line.", "This doesn't clear the bar, and the bar matters."],
      empath: ["The people closest to this told a story that holds together.", "I believe the witnesses, but what they told us doesn't add up to proof."],
      stickler: ["The record supports the claim, and it was argued properly.", "Too much of this case leaned on things the record doesn't say."],
      pragmatist: ["Plainly, this is the most likely explanation.", "There's a reasonable version of events where the claim is wrong."],
      contrarian: ["I tried to argue myself out of it and couldn't.", "Everyone seems sure. I'm not, and I don't think the record is either."],
      auditor: ["The paper trail lines up.", "The documents don't line up well enough to sign off on."],
    };
    const [upLead, downLead] = LEADS[t.key] ?? ["The record supports the claim.", "The record falls short."];
    const sign = vote === "uphold" ? 1 : -1;
    const forMe = a.contributions.filter((c) => Math.sign(c.value) === sign);
    const against = a.contributions.filter((c) => Math.sign(c.value) === -sign);
    const lead = forMe[0];
    const odds = `I put the claim at about ${pct(belief)} likely, against a bar of ${pct(a.threshold)}.`;
    const parts: string[] = [];

    // Round two: short, and about what changed.
    if (round > 1 && before) {
      if (before.vote !== vote) {
        parts.push(r.pick(["Having heard the others, I'm changing my vote.", "The discussion moved me. I'm switching my vote."]));
        const ally = previous!.find((v) => v.vote === vote && v.citations.some((c) => c.valid));
        const allyName = ctx.participants.find((p) => p.id === ally?.jurorId)?.name.match(/\((.*)\)/)?.[1];
        const point = ally?.citations.find((c) => c.valid);
        if (ally && point) parts.push(`${allyName}'s point about ${ex(ctx.store.get(point.evidenceId)!)} [${point.evidenceId}] was the one I couldn't answer.`);
        else if (lead) parts.push(`On a second look, ${ex(lead.evidence)} [${lead.evidence.id}] matters more than I gave it credit for.`);
      } else {
        parts.push(r.pick(["I've listened to the room and I'm staying where I was.", "Nothing I heard changes my mind."]));
        if (lead) parts.push(`${ex(lead.evidence)} [${lead.evidence.id}] still carries the most weight for me.`);
      }
      if (!parts.some((x) => /\[E\d+\]/.test(x))) {
        const any = (lead ?? against[0])?.evidence ?? ctx.store.items[0]!;
        parts.push(`My view rests on ${ex(any)} [${any.id}].`);
      }
      parts.push(odds);
      return { vote, confidence, belief, reasoning: parts.join(" ") };
    }

    parts.push(vote === "uphold" ? upLead : downLead);
    if (confidence < 0.58) parts.push(r.pick(["It's close, though.", "I'll admit it's close.", "Not by much, though.", "I went back and forth on this."]));
    if (lead) {
      const imp = (rec.impeachment.get(lead.evidence.id) ?? 1) < 1;
      parts.push(`${ex(lead.evidence)} [${lead.evidence.id}] weighs most for me${imp ? ", even after what came out on cross" : ""}.`);
    } else if (against[0]) {
      parts.push(`Nothing on the other side was decisive, but ${ex(against[0].evidence)} [${against[0].evidence.id}] isn't enough on its own.`);
    }
    if (lead && against[0]) {
      parts.push(`${ex(against[0].evidence)} [${against[0].evidence.id}] cuts the other way, but not far enough.`);
    }
    if (t.procedurePenalty >= 0.2) {
      const p = rec.sustainedAgainst.prosecution;
      const d = rec.sustainedAgainst.defense;
      if (p > d) parts.push("I also noticed the prosecution got caught reaching past the record, and that costs them with me.");
      else if (d > p) parts.push("I also noticed the defense got caught reaching past the record, and that costs them with me.");
    }
    if (!lead && !against[0]) {
      const any = ctx.store.items[0]!;
      parts.push(`Very little of the record was argued properly. What remains, like ${ex(any)} [${any.id}], doesn't move me.`);
    }
    parts.push(odds);
    return { vote, confidence, belief, reasoning: parts.join(" ") };
  }
}
