import type { Participant, Phase, Transcript, Turn } from "../../src/types.js";

// Transcript viewer. Loads the demo transcripts from transcripts/index.json,
// or any transcript file the user opens or drops on the page, and replays it
// turn by turn.

interface IndexEntry {
  file: string;
  id: string;
  title: string;
  claim: string;
  outcome: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  opening: "Opening statements",
  evidence: "Evidence",
  cross: "Cross-examination",
  closing: "Closing arguments",
  deliberation: "Jury deliberation",
  verdict: "Verdict",
};
const PHASES = Object.keys(PHASE_LABEL) as Phase[];
const BURDEN_LABEL: Record<string, string> = {
  preponderance: "Preponderance of the evidence (more likely than not)",
  "clear-and-convincing": "Clear and convincing evidence",
  "beyond-reasonable-doubt": "Beyond a reasonable doubt",
};
const RULE_LABEL: Record<string, string> = { majority: "majority rule", supermajority: "two-thirds rule", unanimous: "unanimity rule" };
const TEMPER_LABEL: Record<string, string> = {
  engineer: "The Engineer",
  skeptic: "The Skeptic",
  empath: "The Empath",
  stickler: "The Stickler",
  pragmatist: "The Pragmatist",
  contrarian: "The Contrarian",
  auditor: "The Auditor",
};
const BAR: Record<string, number> = { preponderance: 0.5, "clear-and-convincing": 0.7, "beyond-reasonable-doubt": 0.85 };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  entries: [] as Array<{ key: string; label: string; outcome: string; load: () => Promise<Transcript> }>,
  activeKey: "",
  t: null as Transcript | null,
  shown: 0,
  lastShown: 0,
  timer: 0 as number,
  people: new Map<string, Participant>(),
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Turn citation markers into chips and quotes into highlighted spans. */
function richText(turn: Turn | { text: string; citations: Turn["citations"] }): string {
  const re = /("[^"]{1,400}"|“[^”]{1,400}”)|\[(E\d+(?:\s*[,;]\s*E\d+)*)\]([.,;:?!]?)/g;
  let out = "";
  let last = 0;
  for (const m of turn.text.matchAll(re)) {
    out += esc(turn.text.slice(last, m.index));
    if (m[1]) {
      const inner = m[1].slice(1, -1).trim();
      const bad = turn.citations.some((c) => c.quote === inner && !c.valid);
      out += `<span class="q${bad ? " bad" : ""}">${esc(m[1])}</span>`;
    } else if (m[2]) {
      // Wrap chips and trailing punctuation so a period never starts a line.
      const chips = m[2]
        .split(/\s*[,;]\s*/)
        .map((id) => {
          const bad = turn.citations.some((c) => c.evidenceId === id && !c.valid);
          return `<button class="chip${bad ? " bad" : ""}" data-ex="${id}" title="${bad ? "Invalid citation" : "Show exhibit"}">${id}</button>`;
        })
        .join("");
      out += `<span class="nowrap">${chips}${esc(m[3] ?? "")}</span>`;
    }
    last = m.index! + m[0].length;
  }
  return out + esc(turn.text.slice(last));
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

// ---------- Rendering ----------

function renderTabs(): void {
  const nav = $("case-tabs");
  nav.innerHTML = state.entries
    .map(
      (e) =>
        `<button class="case-tab${e.key === state.activeKey ? " active" : ""}" data-key="${esc(e.key)}"><span class="dot ${esc(e.outcome)}"></span>${esc(e.label)}</button>`,
    )
    .join("");
}

function renderDocket(t: Transcript): void {
  const s = t.stats;
  $("docket").innerHTML = `
    <div>
      <div class="docket-meta"><span>Case ${esc(t.case.id)}</span><span class="mode">${t.mode === "demo" ? "Demo mode" : "Live mode"}</span><span>Engine ${esc(t.engine)}</span><span>Seed ${esc(t.seed)}</span></div>
      <h1>${esc(t.case.title)}</h1>
      <p class="claim"><b>The claim</b>${esc(t.case.claim)}</p>
      <div class="burden">Standard of proof: ${esc(BURDEN_LABEL[t.case.burden] ?? t.case.burden)}. ${t.evidence.length} exhibits, ${t.participants.filter((p) => p.role === "juror").length} jurors.</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${s.turns}</div><div class="l">Turns</div></div>
      <div class="stat"><div class="n">${s.citations}</div><div class="l">Citations</div></div>
      <div class="stat"><div class="n">${s.objections}</div><div class="l">Objections</div></div>
      <div class="stat warn"><div class="n">${s.sustained}</div><div class="l">Sustained</div></div>
      <div class="stat"><div class="n">${s.struckTurns}</div><div class="l">Struck</div></div>
      <div class="stat"><div class="n">${s.impeachments}</div><div class="l">Impeached</div></div>
    </div>`;
}

function renderPhaseRail(t: Transcript): void {
  const visible = t.turns.slice(0, state.shown);
  const current = visible[visible.length - 1]?.phase;
  const reached = new Set(visible.map((x) => x.phase));
  $("phase-rail").innerHTML = `<ol>${PHASES.map((p, i) => {
    const n = t.turns.filter((x) => x.phase === p).length;
    const cls = p === current ? "current reached" : reached.has(p) ? "reached" : "";
    return `<li class="phase-item ${cls}" data-phase="${p}"><span class="pip">${i + 1}</span><span><div class="name">${PHASE_LABEL[p]}</div><div class="count">${n} turns</div></span></li>`;
  }).join("")}</ol>`;
}

function turnHtml(turn: Turn, t: Transcript, fresh: boolean): string {
  const who = state.people.get(turn.speakerId);
  const classes = ["turn", `r-${turn.role}`];
  if (turn.kind === "objection") classes.push("objection");
  if (turn.kind === "ruling") classes.push("ruling");
  if (turn.struck) classes.push("struck");
  const style = fresh ? "" : ` style="animation:none"`;
  const kind = turn.kind === "question" ? "question" : turn.kind === "answer" ? "on cross" : turn.kind === "instruction" ? "jury instructions" : "";
  if (turn.kind === "ruling" && turn.ruling) {
    return `<article class="${classes.join(" ")}" id="turn-${turn.seq}"${style}>
      <span class="ruling-badge ${turn.ruling.outcome}">${turn.ruling.outcome.toUpperCase()}</span>
      <div><div class="who"><span class="name">${esc(who?.name ?? "Judge")}</span><span class="seq">#${turn.seq}</span></div>
      <div class="text">${richText(turn)}</div></div></article>`;
  }
  let extra = "";
  if (turn.impeachment?.conceded) {
    extra = `<div class="impeach">Conceded on cross &middot; weight on ${turn.impeachment.evidenceId} now x${turn.impeachment.factor.toFixed(2)}</div>`;
  }
  const ex = t.evidence.find((e) => turn.impeachment && e.id === turn.impeachment.evidenceId);
  const witnessNote = turn.role === "witness" && ex ? `<span class="kind">source of ${ex.id}</span>` : "";
  return `<article class="${classes.join(" ")}" id="turn-${turn.seq}"${style}>
    <div class="who"><span class="name">${esc(who?.name ?? turn.speakerId)}</span>${kind ? `<span class="kind">${kind}</span>` : ""}${witnessNote}<span class="seq">#${turn.seq}</span></div>
    <div class="text">${richText(turn)}</div>${extra}
    ${turn.struck ? `<span class="stamp">STRICKEN</span>` : ""}
  </article>`;
}

function juryHtml(t: Transcript, visible: Turn[]): string {
  const jurors = t.participants.filter((p) => p.role === "juror");
  const seen = new Map<string, number>();
  for (const turn of visible) if (turn.role === "juror") seen.set(turn.speakerId, (seen.get(turn.speakerId) ?? 0) + 1);
  const bar = BAR[t.case.burden] ?? 0.5;
  return `<div class="jury-room">${jurors
    .map((j) => {
      const rounds = seen.get(j.id) ?? 0;
      const r1 = t.deliberation[0]?.votes.find((v) => v.jurorId === j.id);
      const r2 = t.deliberation[1]?.votes.find((v) => v.jurorId === j.id);
      const latest = rounds >= 2 ? r2 : rounds >= 1 ? r1 : undefined;
      const v1 = rounds >= 1 && r1 ? `<span class="vote ${r1.vote}">${r1.vote}</span>` : `<span class="vote pending">pending</span>`;
      const v2 = rounds >= 2 && r2 ? `<span class="vote ${r2.vote}">${r2.vote}</span>` : `<span class="vote pending">round 2</span>`;
      const moved = rounds >= 2 && r1 && r2 && r1.vote !== r2.vote ? `<span class="moved">changed vote</span>` : "";
      const meter = latest
        ? `<div class="meter"><span class="bar-mark" style="left:${pct(bar)}" title="Standard of proof"></span><span class="belief" style="left:${pct(latest.belief)}" title="Belief the claim is true"></span></div>
           <div class="meter-legend"><span>belief ${pct(latest.belief)}</span><span>confidence ${latest.confidence.toFixed(2)}</span></div>`
        : "";
      const reason = latest ? `<p>${richText({ text: latest.reasoning, citations: latest.citations })}</p>` : "";
      const earlier = rounds >= 2 && r1 ? `<details><summary>Round one reasoning</summary><p>${richText({ text: r1.reasoning, citations: r1.citations })}</p></details>` : "";
      return `<div class="juror"><div class="juror-head"><span class="juror-name">${esc(j.name)}</span><span class="temper">${esc(TEMPER_LABEL[j.temperament ?? ""] ?? j.temperament ?? "")}</span></div>
        <div class="votes">${v1}<span class="arrow">&rarr;</span>${v2}${moved}</div>${meter}${reason}${earlier}</div>`;
    })
    .join("")}</div>`;
}

function renderTranscript(t: Transcript): void {
  const visible = t.turns.slice(0, state.shown);
  let html = "";
  let phase: Phase | undefined;
  let juryDrawn = false;
  for (const turn of visible) {
    if (turn.phase !== phase) {
      phase = turn.phase;
      html += `<h2 class="phase-head" id="phase-${phase}">${PHASE_LABEL[phase]}</h2>`;
    }
    if (turn.kind === "deliberation") {
      if (!juryDrawn) {
        html += juryHtml(t, visible);
        juryDrawn = true;
      }
      continue;
    }
    html += turnHtml(turn, t, turn.seq > state.lastShown);
  }
  $("transcript").innerHTML = html;
}

function ring(conf: number, color: string): string {
  const r = 34;
  const c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 86 86" aria-label="Verdict confidence ${conf.toFixed(2)}">
    <circle cx="43" cy="43" r="${r}" fill="none" stroke="#eee5d4" stroke-width="7"/>
    <circle cx="43" cy="43" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(c * conf).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 43 43)"/>
    <text x="43" y="47" text-anchor="middle">${conf.toFixed(2)}</text>
    <text x="43" y="60" text-anchor="middle" class="lbl">CONFIDENCE</text></svg>`;
}

function renderVerdict(t: Transcript): void {
  const reached = t.turns.slice(0, state.shown).some((x) => x.phase === "verdict");
  const v = t.verdict;
  if (!reached) {
    $("verdict-card").innerHTML = `<h3>Verdict</h3><div class="verdict-stamp pending">AWAITING VERDICT</div><p class="verdict-summary">The jury has not ruled yet. Press play or step forward to continue the trial.</p>`;
    return;
  }
  const label = v.outcome === "hung" ? "HUNG JURY" : v.outcome.toUpperCase();
  const color = v.outcome === "upheld" ? "#2f6b3f" : v.outcome === "rejected" ? "#9b2c2c" : "#a86b12";
  const n = v.tally.uphold + v.tally.reject;
  $("verdict-card").innerHTML = `<h3>Verdict</h3>
    <div class="verdict-stamp ${v.outcome}">${label}</div>
    <div class="verdict-row">${ring(v.confidence, color)}
      <div class="tally"><div class="big">${v.tally.uphold}&ndash;${v.tally.reject}</div><div class="rule">uphold&ndash;reject<br>${RULE_LABEL[v.rule] ?? v.rule}</div></div></div>
    <div class="tallybar"><div class="u" style="width:${(v.tally.uphold / n) * 100}%"></div><div class="r" style="width:${(v.tally.reject / n) * 100}%"></div></div>
    <p class="verdict-summary">${esc(v.summary)}</p>`;
}

function renderExhibits(t: Transcript): void {
  $("exhibits").innerHTML =
    `<h3>Exhibits</h3>` +
    t.evidence
      .map(
        (e) => `<div class="exhibit" id="ex-${e.id}" data-ex="${e.id}">
        <div class="ex-head"><span class="ex-id">${e.id}</span><span class="ex-title">${esc(e.title)}</span></div>
        <div class="ex-tags"><span class="tag ${e.favors}">${e.favors}</span><span>${e.kind}</span><span class="rel" title="Reliability ${e.reliability}"><i style="width:${pct(e.reliability)}"></i></span><span>${e.reliability.toFixed(2)}</span></div>
        <div class="ex-body"><div>${esc(e.summary)}</div><blockquote>${esc(e.quote)}</blockquote>
          <div>Source: ${esc(e.source)}</div>${e.weakness ? `<div class="weak">Weak spot: ${esc(e.weakness)}</div>` : ""}</div>
      </div>`,
      )
      .join("");
}

function renderPlayer(t: Transcript): void {
  const total = t.turns.length;
  $("progress-fill").style.width = `${(state.shown / total) * 100}%`;
  $("counter").textContent = `${state.shown} / ${total}`;
  $("btn-play").innerHTML = state.timer ? "&#10073;&#10073;" : "&#9654;";
  $("btn-play").setAttribute("aria-label", state.timer ? "Pause" : "Play");
}

function render(scroll = false): void {
  const t = state.t;
  if (!t) return;
  renderPhaseRail(t);
  renderTranscript(t);
  renderVerdict(t);
  renderPlayer(t);
  if (scroll && state.shown > 0) {
    const last = t.turns[state.shown - 1]!;
    const el = last.kind === "deliberation" ? document.querySelector(".jury-room") : document.getElementById(`turn-${last.seq}`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  state.lastShown = state.shown;
}

// ---------- Playback ----------

function stop(): void {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = 0;
  if (state.t) renderPlayer(state.t);
}

function step(delta: number): void {
  const t = state.t;
  if (!t) return;
  state.shown = Math.max(0, Math.min(t.turns.length, state.shown + delta));
  if (delta < 0) state.lastShown = state.shown;
  render(delta > 0);
  if (state.shown >= t.turns.length) stop();
}

function play(): void {
  const t = state.t;
  if (!t) return;
  if (state.timer) return stop();
  if (state.shown >= t.turns.length) {
    state.shown = 0;
    state.lastShown = 0;
    render();
    window.scrollTo({ top: 0 });
  }
  const speed = Number(($("speed") as HTMLSelectElement).value);
  state.timer = window.setInterval(() => step(1), speed);
  step(1);
}

// ---------- Loading ----------

function looksLikeTranscript(x: unknown): x is Transcript {
  const t = x as Transcript;
  return !!t && typeof t === "object" && Array.isArray(t.turns) && !!t.case && !!t.verdict && Array.isArray(t.evidence);
}

function show(t: Transcript, key: string, opts: { all?: boolean } = {}): void {
  stop();
  state.t = t;
  state.activeKey = key;
  state.people = new Map(t.participants.map((p) => [p.id, p]));
  state.shown = opts.all === false ? 0 : t.turns.length;
  state.lastShown = state.shown;
  $("empty-state").hidden = true;
  renderTabs();
  renderDocket(t);
  renderExhibits(t);
  render();
  const url = new URL(window.location.href);
  if (!key.startsWith("file:")) url.searchParams.set("case", key);
  history.replaceState(null, "", url);
}

async function openEntry(key: string, opts: { all?: boolean } = {}): Promise<void> {
  const e = state.entries.find((x) => x.key === key);
  if (!e) return;
  show(await e.load(), key, opts);
}

function addFile(file: File): void {
  file.text().then((text) => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      alert(`${file.name} is not valid JSON.`);
      return;
    }
    if (!looksLikeTranscript(data)) {
      alert(`${file.name} does not look like a courtroom transcript.`);
      return;
    }
    const t = data;
    const key = `file:${file.name}`;
    state.entries = state.entries.filter((x) => x.key !== key);
    state.entries.push({ key, label: t.case.title, outcome: t.verdict.outcome, load: async () => t });
    show(t, key);
  });
}

async function boot(): Promise<void> {
  try {
    const res = await fetch("transcripts/index.json");
    if (!res.ok) throw new Error(String(res.status));
    const index = (await res.json()) as IndexEntry[];
    const cache = new Map<string, Transcript>();
    state.entries = index.map((e) => ({
      key: e.id,
      label: e.title,
      outcome: e.outcome,
      load: async () => {
        if (!cache.has(e.id)) cache.set(e.id, (await (await fetch(`transcripts/${e.file}`)).json()) as Transcript);
        return cache.get(e.id)!;
      },
    }));
  } catch {
    state.entries = [];
  }
  const params = new URLSearchParams(window.location.search);
  const wanted = params.get("case");
  const first = state.entries.find((e) => e.key === wanted) ?? state.entries[0];
  if (!first) {
    $("empty-state").hidden = false;
    renderTabs();
    return;
  }
  const step0 = params.get("turn");
  await openEntry(first.key, { all: params.get("view") !== "replay" });
  if (step0 && state.t) {
    state.shown = Math.min(state.t.turns.length, Math.max(0, Number(step0)));
    state.lastShown = state.shown;
    render();
  }
  if (params.get("play") === "1") play();
}

// ---------- Events ----------

document.addEventListener("click", (ev) => {
  const target = ev.target as HTMLElement;
  const tab = target.closest<HTMLElement>(".case-tab");
  if (tab) return void openEntry(tab.dataset.key!);
  const chip = target.closest<HTMLElement>(".chip");
  if (chip) {
    const card = document.getElementById(`ex-${chip.dataset.ex}`);
    if (card) {
      card.classList.add("open", "hot");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      window.setTimeout(() => card.classList.remove("hot"), 1600);
    }
    return;
  }
  const ex = target.closest<HTMLElement>(".exhibit");
  if (ex) return void ex.classList.toggle("open");
  const phase = target.closest<HTMLElement>(".phase-item");
  if (phase && state.t) {
    const p = phase.dataset.phase as Phase;
    const idx = state.t.turns.findIndex((x) => x.phase === p);
    if (idx >= 0 && state.shown <= idx) {
      stop();
      state.shown = state.t.turns.filter((x) => PHASES.indexOf(x.phase) <= PHASES.indexOf(p)).length;
      render();
    }
    document.getElementById(`phase-${p}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

document.addEventListener("mouseover", (ev) => {
  const chip = (ev.target as HTMLElement).closest<HTMLElement>(".chip");
  document.querySelectorAll(".exhibit.hot, .chip.hot").forEach((el) => el.classList.remove("hot"));
  if (!chip) return;
  document.getElementById(`ex-${chip.dataset.ex}`)?.classList.add("hot");
  document.querySelectorAll<HTMLElement>(`.chip[data-ex="${chip.dataset.ex}"]`).forEach((c) => c.classList.add("hot"));
});

$("btn-play").addEventListener("click", play);
$("btn-next").addEventListener("click", () => (stop(), step(1)));
$("btn-prev").addEventListener("click", () => (stop(), step(-1)));
$("btn-all").addEventListener("click", () => {
  stop();
  if (state.t) step(state.t.turns.length);
});
$("speed").addEventListener("change", () => {
  if (state.timer) {
    stop();
    play();
  }
});
$("progress").addEventListener("click", (ev) => {
  const t = state.t;
  if (!t) return;
  const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  stop();
  state.shown = Math.round(((ev.clientX - box.left) / box.width) * t.turns.length);
  state.lastShown = state.shown;
  render(true);
});
$<HTMLInputElement>("file-input").addEventListener("change", (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) addFile(f);
});

document.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement).matches("input, select, textarea")) return;
  if (ev.key === " ") (ev.preventDefault(), play());
  else if (ev.key === "ArrowRight") (stop(), step(1));
  else if (ev.key === "ArrowLeft") (stop(), step(-1));
  else if (ev.key === "End") (stop(), step(Infinity));
  else if (ev.key === "Home") (stop(), step(-Infinity));
});

let dragDepth = 0;
window.addEventListener("dragenter", (e) => (e.preventDefault(), dragDepth++, document.body.classList.add("dragging")));
window.addEventListener("dragleave", () => (--dragDepth <= 0 ? document.body.classList.remove("dragging") : undefined));
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files?.[0];
  if (f) addFile(f);
});

void boot();
