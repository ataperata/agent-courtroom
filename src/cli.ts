#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runTrial, DEFAULTS, DEMO_TIMESTAMP } from "./court/orchestrator.js";
import { LlmEngine } from "./engines/llm.js";
import { ScriptedEngine } from "./engines/scripted.js";
import type { CourtEngine } from "./engines/engine.js";
import { listCaseDirs, loadCase } from "./evidence/store.js";
import { selectProvider, type ProviderName } from "./providers/index.js";
import { painter, renderSummary, renderTranscript, renderTurn } from "./render.js";
import { validateTranscript } from "./schema/validate.js";
import type { Participant, Transcript, VoteRule } from "./types.js";

function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

const ROOT = packageRoot();
const CASES = join(ROOT, "cases");

const HELP = `agent-courtroom: put a claim on trial

Usage
  courtroom demo [options]             Run every bundled case offline (no keys, no network)
  courtroom run <case-dir> [options]   Run one case
  courtroom list                       List bundled cases
  courtroom validate <file.json>...    Check transcripts against the schema

Options
  --live                 Use a real model (same as --mode live)
  --mode demo|live       Engine to use (default: demo)
  --provider NAME        anthropic or openai (default: whichever key is set)
  --model ID             Model id (or set COURTROOM_MODEL)
  --seed S               Seed for the demo engine (default: ${DEFAULTS.seed})
  --jurors N             Jury size, 1 to 12 (default: ${DEFAULTS.jurors})
  --rule R               majority, supermajority or unanimous (default: ${DEFAULTS.rule})
  --out PATH             run: transcript file. demo: output folder (default: web/public/transcripts)
  --summary              Print only the verdict summary
  --quiet                Print nothing but file paths
  -h, --help             Show this help

Environment
  ANTHROPIC_API_KEY, OPENAI_API_KEY, COURTROOM_MODEL, ANTHROPIC_BASE_URL, OPENAI_BASE_URL`;

const RULES: VoteRule[] = ["majority", "supermajority", "unanimous"];

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      live: { type: "boolean" },
      mode: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      seed: { type: "string" },
      jurors: { type: "string" },
      rule: { type: "string" },
      out: { type: "string" },
      summary: { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    process.stdout.write(HELP + "\n");
    return;
  }

  const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
  const p = painter(color);
  const jurors = values.jurors ? Number(values.jurors) : DEFAULTS.jurors;
  if (!Number.isInteger(jurors) || jurors < 1 || jurors > 12) fail("--jurors must be a whole number from 1 to 12");
  const rule = (values.rule ?? DEFAULTS.rule) as VoteRule;
  if (!RULES.includes(rule)) fail(`--rule must be one of ${RULES.join(", ")}`);
  const seed = values.seed ?? DEFAULTS.seed;
  const mode = values.live ? "live" : (values.mode ?? "demo");
  if (mode !== "demo" && mode !== "live") fail("--mode must be demo or live");

  const print = (t: Transcript) => {
    if (values.quiet) return;
    process.stdout.write((values.summary ? renderSummary(t, color) : renderTranscript(t, color)) + "\n");
  };

  switch (command) {
    case "list": {
      for (const dir of listCaseDirs(CASES)) {
        const c = loadCase(dir);
        process.stdout.write(`${p(c.id, "bold")}  ${c.evidence.length} exhibits, ${c.burden}\n  ${c.claim}\n`);
      }
      return;
    }

    case "validate": {
      if (rest.length === 0) fail("validate needs at least one file");
      let bad = 0;
      for (const f of rest) {
        const res = validateTranscript(JSON.parse(readFileSync(f, "utf8")));
        if (res.valid) process.stdout.write(`${p("ok", "green")}   ${f}\n`);
        else {
          bad++;
          process.stdout.write(`${p("FAIL", "red")} ${f}\n${res.errors.map((e) => `     ${e}`).join("\n")}\n`);
        }
      }
      if (bad) process.exit(1);
      return;
    }

    case "demo": {
      const outDir = resolve(values.out ?? join(ROOT, "web", "public", "transcripts"));
      const index: Array<{ file: string; id: string; title: string; claim: string; outcome: string }> = [];
      for (const dir of listCaseDirs(CASES)) {
        const caseFile = loadCase(dir);
        const t = await runTrial(caseFile, new ScriptedEngine(), { seed, jurors, rule, generatedAt: DEMO_TIMESTAMP });
        const check = validateTranscript(t);
        if (!check.valid) fail(`generated transcript for ${caseFile.id} failed validation:\n${check.errors.join("\n")}`);
        const file = `${caseFile.id}.json`;
        writeJson(join(outDir, file), t);
        index.push({ file, id: caseFile.id, title: caseFile.title, claim: caseFile.claim, outcome: t.verdict.outcome });
        print(t);
        process.stdout.write(`${p("wrote", "gray")} ${relative(process.cwd(), join(outDir, file))}\n`);
      }
      writeJson(join(outDir, "index.json"), index);
      if (!values.quiet) {
        process.stdout.write(`\nOpen the viewer with ${p("npm run viewer", "bold")} to replay these trials in the browser.\n`);
      }
      return;
    }

    case "run": {
      const dir = rest[0];
      if (!dir) fail("run needs a case folder, for example: courtroom run cases/checkout-outage");
      const caseFile = loadCase(resolve(dir));
      let engine: CourtEngine;
      if (mode === "live") {
        const provider = selectProvider({ provider: values.provider as ProviderName | undefined, model: values.model });
        if (!provider) fail("live mode needs ANTHROPIC_API_KEY or OPENAI_API_KEY. Use --mode demo to run offline.");
        engine = new LlmEngine(provider);
        if (!values.quiet) process.stderr.write(p(`Live trial with ${engine.name}. Turns stream as they happen.\n`, "gray"));
      } else {
        engine = new ScriptedEngine();
      }
      let last: string | undefined;
      const stream = mode === "live" && !values.quiet && !values.summary;
      const t = await runTrial(caseFile, engine, {
        seed,
        jurors,
        rule,
        generatedAt: mode === "demo" ? DEMO_TIMESTAMP : undefined,
        onTurn: stream
          ? (turn, participants) => {
              const people = new Map<string, Participant>(participants.map((x) => [x.id, x]));
              process.stdout.write(renderTurn(turn, people, color, last) + "\n");
              last = turn.phase;
            }
          : undefined,
      });
      if (stream) process.stdout.write(renderSummary(t, color) + "\n");
      else print(t);
      const out = values.out ?? join("out", `${caseFile.id}.json`);
      writeJson(out, t);
      process.stdout.write(`${p("wrote", "gray")} ${out}\n`);
      return;
    }

    default:
      fail(`unknown command "${command}". Try --help.`);
  }
}

// Exit quietly when piped into head or similar.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`error: ${(err as Error).message}\n`);
  process.exit(1);
});
