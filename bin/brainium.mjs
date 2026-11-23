#!/usr/bin/env node
// Brainium CLI. Zero dependencies; Node 18.17+.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { addBrain, configPath, loadConfig, redactedConfig, removeBrain, resolvedSummarizer, setConfig, PROVIDERS, SCHEDULER_MODES } from "../cli/lib/config.mjs";
import { initBrain, initPersonal, PKG_ROOT } from "../cli/lib/personal.mjs";
import { wire, grokSnippet, agentSnippet, APPS, CLI_PATH } from "../cli/lib/wire.mjs";
import { BRAIN_NAME, RESERVED_BRAIN_NAMES, brainRoots, defaultBrainName, listAgents } from "../cli/lib/brain.mjs";
import { approveRoutine, describe, listRoutines, loadApprovals, loadState, needsApproval, newRoutine, revokeRoutine, runRoutine, setEnabled, tick } from "../cli/lib/routines.mjs";
import * as scheduler from "../cli/lib/scheduler.mjs";
import { capture, distill, listPending, sessionStartMessage } from "../cli/lib/capture.mjs";
import { remoteUrl, findRepoRoot } from "../cli/lib/git.mjs";
import { serve } from "../cli/lib/mcp.mjs";

const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;

const HELP = `brainium ${VERSION} — git-backed second brain for your agents

Usage:
  brainium init-personal [DIR]          Create the personal brain (default ~/Brainium) and remember it
  brainium config show                  Show settings (stored keys are hidden)
  brainium config set KEY VALUE         KEY: personalBrain, rawStore, capture, commit,
                                          summarizer.provider (${PROVIDERS.join("|")}),
                                          summarizer.url, summarizer.model,
                                          summarizer.apiKeyEnv, summarizer.apiKey
                                        defaultBrain, scheduler.mode (${SCHEDULER_MODES.join("|")}),
                                          routines.claudePath, routines.codexPath

Brains (one per team, Prism group, profile or project — besides personal):
  brainium brains                       List brains, their agents and routines
  brainium brain add NAME DIR [--create] [--default]
                                        Use DIR as brain NAME (--create scaffolds shared/, agents/, routines/)
  brainium brain remove NAME            Forget a brain (its folder is left alone)
  brainium brain default NAME           Brain used when a call names none
  brainium agents [--brain NAME]        Agents and their cards

Routines (scheduled prompts, upkeep jobs and shell commands in a brain's routines/):
  brainium routines [--brain NAME]      List with next/last run and approval
  brainium routines new NAME --brain B [--type prompt|upkeep|shell] [--agent A] [--profile DIR] [--app claude-code|codex]
                                        (routines run on schedule:, on: <globs> when files change, or both;
                                         stage: shadow|limited|full controls how much they may do)
  brainium routines approve REF|--all   Allow a prompt/shell routine to run on this machine
  brainium routines revoke REF
  brainium routines enable|disable REF
  brainium routines run REF             Run one now (REF = brain/routine)
  brainium routines tick                Start whatever is due (the scheduler calls this)
  brainium scheduler install|uninstall|status
                                        Run ticks every minute with launchd / systemd / Task Scheduler
  brainium preflight [--agent NAME] [--no-pull]  Before any work: fast-forward the repos .brainium.json lists
                                        and list rule files changed since this agent last looked
  brainium organize [--brain NAME] [--apply] [--agent NAME]
                                        Fix what lint finds that has one right answer (misfiled records,
                                        unsigned notes with evidence, old or broken links); dry run by default
  brainium lint [--brain NAME] [--write] [--stale-days N]
                                        Check for context rot; --write saves shared/health.md
  brainium record get FOLDER/ID [--brain NAME]
                                        A record plus what it links to and what links back

Apps:
  brainium wire --app APP [--profile DIR] [--brain NAME] [--system] [--capture]
  brainium unwire --app APP [--profile DIR] [--system]
                                        APP: ${APPS.join(", ")}
  brainium snippet grok [--agent NAME] [--brain NAME]
                                        Instructions to paste into a Grok Bot agent
  brainium snippet agent --agent NAME [--brain NAME]
                                        Lines for any agent's instructions (subagents, Desktop projects…)
  brainium status                       Summary (add --json for machines)
  brainium pending                      Captured sessions waiting to be filed
  brainium distill [--mechanical] [--older-than-days N]
                                        File pending captures with the configured summarizer
  brainium mcp                          Run the MCP server (stdio)
  brainium capture | session-start      Claude Code hook entry points (read hook JSON on stdin)

Add --json to most commands for machine-readable output.
Project brains: run scripts/install.sh in a repo (docs/brainium/).`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) out[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--") && !["system", "capture", "json", "mechanical", "help", "create", "default", "all", "force"].includes(k)) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function print(args, value, human) {
  if (args.json) process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  else process.stdout.write((typeof human === "function" ? human(value) : human ?? JSON.stringify(value, null, 2)) + "\n");
}

function brainPathOf(config, name) {
  if (name === "personal") return config.personalBrain;
  const b = (config.brains || {})[name];
  if (!b) throw new Error(`no brain called "${name}" (see brainium brains)`);
  return b.path || b;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  const config = loadConfig();

  switch (cmd) {
    case undefined:
    case "help":
      console.log(HELP);
      return;

    case "version":
      console.log(VERSION);
      return;

    case "init-personal": {
      const dir = resolve(rest[0] || config.personalBrain);
      const r = initPersonal(dir);
      setConfig("personalBrain", dir);
      print(args, r, `${r.existed ? "Refreshed" : "Created"} personal brain at ${r.path}${r.createdRepo ? " (new git repo)" : ""}.`);
      return;
    }

    case "config": {
      const [sub, key, ...valueParts] = rest;
      if (sub === "set") {
        if (!key || valueParts.length === 0) throw new Error("usage: brainium config set KEY VALUE");
        const next = setConfig(key, valueParts.join(" "));
        print(args, redactedConfig(next), `Set ${key}.`);
      } else if (sub === "get") {
        const v = key.split(".").reduce((o, k) => (o ? o[k] : undefined), redactedConfig(config));
        console.log(typeof v === "object" ? JSON.stringify(v) : String(v ?? ""));
      } else {
        print({ json: true }, { path: configPath(), ...redactedConfig(config) });
      }
      return;
    }

    case "wire":
    case "unwire": {
      const app = args.app;
      if (!APPS.includes(app)) throw new Error(`--app must be one of: ${APPS.join(", ")}`);
      const r = wire({
        app,
        profileDir: args.profile ? resolve(args.profile) : undefined,
        system: !!args.system,
        capture: !!args.capture,
        personalBrain: config.personalBrain,
        brain: typeof args.brain === "string" ? args.brain : "",
        brainPath: typeof args.brain === "string" ? brainPathOf(config, args.brain) : "",
      }, cmd === "wire");
      print(args, r, (v) => [
        v.changed.length ? `${cmd === "wire" ? "Wired" : "Unwired"} ${app}:\n${v.changed.map((c) => `  ${c}`).join("\n")}` : `${app}: already ${cmd === "wire" ? "wired" : "unwired"}.`,
        ...v.notes,
        v.snippet ? `\nPaste into the Grok Bot agent's instructions:\n\n${v.snippet}` : "",
      ].filter(Boolean).join("\n"));
      return;
    }

    case "snippet": {
      const agentName = typeof args.agent === "string" ? args.agent : "";
      const brainName = typeof args.brain === "string" ? args.brain : "";
      if (rest[0] === "grok") {
        console.log(grokSnippet(brainName ? brainPathOf(config, brainName) : config.personalBrain, agentName));
      } else if (rest[0] === "agent") {
        console.log(agentSnippet(agentName, brainName));
      } else {
        throw new Error("usage: brainium snippet grok|agent [--agent NAME] [--brain NAME]");
      }
      return;
    }

    case "brains": {
      const roots = brainRoots(config, null);
      const def = defaultBrainName(config);
      const state = loadState();
      const approvals = loadApprovals();
      const routines = listRoutines(config).map((r) => describe(r, state, approvals));
      const names = ["personal", ...Object.keys(config.brains || {})];
      const value = names.map((name) => {
        const path = name === "personal" ? config.personalBrain : brainPathOf(config, name);
        const exists = !!roots[name];
        return {
          name,
          path,
          exists,
          default: name === def,
          isRepo: exists && !!findRepoRoot(path),
          remote: exists ? remoteUrl(path) : null,
          agents: exists ? listAgents(roots, { brain: name }).map(({ name: n, slug, tldr, card, folder }) => ({ name: n, slug, tldr, card, folder })) : [],
          routines: routines.filter((r) => r.brain === name).length,
        };
      });
      print(args, value, (v) => v.map((b) => `${b.default ? "*" : " "} ${b.name.padEnd(16)} ${b.path}${b.exists ? "" : "  (missing)"}${b.agents.length ? `  · ${b.agents.length} agent${b.agents.length === 1 ? "" : "s"}` : ""}${b.routines ? `  · ${b.routines} routine${b.routines === 1 ? "" : "s"}` : ""}`).join("\n"));
      return;
    }

    case "brain": {
      const [sub, name, dir] = rest;
      if (sub === "add") {
        if (!name || !dir) throw new Error("usage: brainium brain add NAME DIR [--create] [--default]");
        if (!BRAIN_NAME.test(name) || RESERVED_BRAIN_NAMES.has(name)) throw new Error(`brain names are lowercase letters, numbers and dashes (not ${[...RESERVED_BRAIN_NAMES].join(", ")})`);
        const path = resolve(dir);
        let created = null;
        if (args.create) created = initBrain(path);
        else if (!existsSync(path)) throw new Error(`${path} doesn't exist (add --create to make it)`);
        addBrain(name, path);
        if (args.default) setConfig("defaultBrain", name);
        print(args, { name, path, created }, `${created ? (created.existed ? "Refreshed" : "Created") : "Added"} brain "${name}" at ${path}${args.default ? " (now the default)" : ""}.`);
      } else if (sub === "remove") {
        if (!name) throw new Error("usage: brainium brain remove NAME");
        removeBrain(name);
        print(args, { name }, `Forgot brain "${name}" (its folder is untouched).`);
      } else if (sub === "default") {
        if (!name) throw new Error("usage: brainium brain default NAME");
        setConfig("defaultBrain", name);
        print(args, { name }, `Default brain: ${name}.`);
      } else {
        throw new Error("usage: brainium brain add|remove|default …");
      }
      return;
    }

    case "init-brain": {
      // Shorthand for `brain add NAME DIR --create`.
      const [name, dir] = rest;
      if (!name || !dir) throw new Error("usage: brainium init-brain NAME DIR");
      if (!BRAIN_NAME.test(name) || RESERVED_BRAIN_NAMES.has(name)) throw new Error("brain names are lowercase letters, numbers and dashes");
      const r = initBrain(resolve(dir));
      addBrain(name, r.path);
      print(args, { name, ...r }, `${r.existed ? "Refreshed" : "Created"} brain "${name}" at ${r.path}.`);
      return;
    }

    case "agents": {
      const roots = brainRoots(config, null);
      const value = listAgents(roots, { brain: typeof args.brain === "string" ? args.brain : "all" });
      print(args, value, (v) => (v.length ? v.map((a) => `${a.brain}/${a.slug}  ${a.name}${a.tldr ? ` — ${a.tldr}` : ""}`).join("\n") : "No agents yet."));
      return;
    }

    case "routines": {
      const [sub = "list", ref] = rest;
      if (sub === "list") {
        const state = loadState();
        const approvals = loadApprovals();
        const value = listRoutines(config, { brain: typeof args.brain === "string" ? args.brain : undefined }).map((r) => describe(r, state, approvals));
        const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");
        print(args, value, (v) => (v.length ? v.map((r) => [
          `${r.ref}  ${r.name}  [${r.type}${r.agent ? ` · ${r.agent}` : ""}${r.stage && r.stage !== "full" && r.type !== "upkeep" ? ` · ${r.stage}` : ""}]  ${[r.schedule, r.on ? `on ${r.on.join(", ")}` : ""].filter(Boolean).join(" · ")}`,
          r.errors.length ? `    problem: ${r.errors.join("; ")}`
            : !r.enabled ? "    off"
            : !r.approved ? `    needs approval${r.changedSinceApproval ? " (changed since approved)" : ""}: brainium routines approve ${r.ref}`
            : `    next ${when(r.nextRun)} · last ${when(r.lastRun)}${r.lastStatus ? ` (${r.lastStatus})` : ""}${r.running ? " · running now" : ""}`,
        ].join("\n")).join("\n") : "No routines yet. Create one with: brainium routines new NAME --brain BRAIN"));
      } else if (sub === "approve") {
        const refs = args.all
          ? listRoutines(config, { brain: typeof args.brain === "string" ? args.brain : undefined }).filter((r) => needsApproval(r) && !r.errors.length).map((r) => r.ref)
          : [ref];
        if (!refs[0]) throw new Error("usage: brainium routines approve REF|--all [--brain NAME]");
        const done = refs.map((r) => approveRoutine(config, r));
        print(args, done, (v) => (v.length ? `Approved on this machine: ${v.join(", ")}` : "Nothing to approve."));
      } else if (sub === "revoke") {
        if (!ref) throw new Error("usage: brainium routines revoke REF");
        print(args, revokeRoutine(config, ref), `Revoked ${ref}.`);
      } else if (sub === "enable" || sub === "disable") {
        if (!ref) throw new Error(`usage: brainium routines ${sub} REF`);
        print(args, setEnabled(config, ref, sub === "enable"), `${ref} ${sub === "enable" ? "on" : "off"}.`);
      } else if (sub === "new") {
        if (!ref || typeof args.brain !== "string") throw new Error("usage: brainium routines new NAME --brain BRAIN [--type prompt|upkeep|shell]");
        const opt = (k) => (typeof args[k] === "string" ? args[k] : "");
        const r = newRoutine(config, { brain: args.brain, name: ref, type: opt("type") || "prompt", profile: opt("profile"), agent: opt("agent"), app: opt("app") || "claude-code" });
        print(args, r, `Created ${r.ref} (off): ${r.file}\nEdit it, then: brainium routines enable ${r.ref} && brainium routines approve ${r.ref}`);
      } else if (sub === "run") {
        if (!ref) throw new Error("usage: brainium routines run REF");
        const r = await runRoutine(config, ref, { scheduledFor: typeof args["scheduled-for"] === "string" ? args["scheduled-for"] : null, force: !args["scheduled-for"] });
        print(args, r, (v) => `${v.ref}: ${v.status}${v.durationMs !== undefined ? ` in ${Math.round(v.durationMs / 1000)}s` : ""}${v.log ? ` → ${v.log}` : ""}${v.output ? `\n\n${v.output}` : ""}`);
        if (r.status === "failed" || r.status === "timed out") process.exitCode = 1;
      } else if (sub === "tick") {
        const actions = tick(config);
        print(args, actions, (v) => v.map((a) => `${a.ref}: ${a.action}`).join("\n"));
      } else {
        throw new Error(`unknown routines command "${sub}"`);
      }
      return;
    }

    case "preflight": {
      const { preflight } = await import("../cli/lib/preflight.mjs");
      const r = preflight(config, { cwd: process.cwd(), agent: typeof args.agent === "string" ? args.agent : process.env.BRAINIUM_AGENT || "", pull: args.pull !== false && !args["no-pull"] });
      print(args, r, (v) => (v.configured ? v.text : "No preflight set up here: add \"update\" and/or \"rules\" to .brainium.json."));
      return;
    }

    case "organize": {
      const { organizeBrain, organizeReport } = await import("../cli/lib/organize.mjs");
      const { brainRoots, pickBrain, defaultBrainName } = await import("../cli/lib/brain.mjs");
      const roots = brainRoots(config, process.cwd());
      const name = pickBrain(roots, typeof args.brain === "string" ? args.brain : "auto", defaultBrainName(config));
      const r = organizeBrain(roots, name, { apply: !!args.apply, agent: typeof args.agent === "string" ? args.agent : "" });
      print(args, r, organizeReport);
      return;
    }

    case "lint": {
      const { lintBrain, lintReport, writeHealth } = await import("../cli/lib/records.mjs");
      const { brainRoots, pickBrain, defaultBrainName } = await import("../cli/lib/brain.mjs");
      const roots = brainRoots(config, process.cwd());
      const name = pickBrain(roots, typeof args.brain === "string" ? args.brain : "auto", defaultBrainName(config));
      const opts = { staleDays: Number(args["stale-days"]) || 30 };
      const r = args.write ? writeHealth(config, name, opts) : lintBrain(roots, name, opts);
      print(args, r, (v) => lintReport(v) + (v.path ? `\nSaved to ${v.path}` : ""));
      return;
    }

    case "record": {
      const [sub, ref] = rest;
      if (sub !== "get" || !ref) throw new Error("usage: brainium record get FOLDER/ID [--brain NAME]");
      const { getRecord } = await import("../cli/lib/records.mjs");
      const { brainRoots, defaultBrainName } = await import("../cli/lib/brain.mjs");
      const r = getRecord(brainRoots(config, process.cwd()), ref, { brain: typeof args.brain === "string" ? args.brain : "auto", defaultBrain: defaultBrainName(config) });
      print(args, r, (v) => [`${v.ref}  (${v.path})`, "", ...Object.entries(v.meta).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : x}`), "", "Links:", ...(v.links.length ? v.links.map((l) => `  ${l.ref}${l.missing ? "  (missing)" : `  ${l.title || ""}${l.status ? ` [${l.status}]` : ""}`}`) : ["  none"]), "Linked from:", ...(v.backlinks.length ? v.backlinks.map((b) => `  ${b}`) : ["  none"])].join("\n"));
      return;
    }

    case "scheduler": {
      const [sub = "status"] = rest;
      let value;
      if (sub === "install") {
        value = scheduler.install({ rawStore: config.rawStore });
        setConfig("scheduler.mode", "os");
      } else if (sub === "uninstall") {
        value = scheduler.uninstall();
        if (loadConfig().scheduler.mode === "os") setConfig("scheduler.mode", "off");
      } else if (sub === "status") {
        value = { ...scheduler.status(), current: scheduler.isCurrent(), mode: config.scheduler.mode };
      } else {
        throw new Error("usage: brainium scheduler install|uninstall|status");
      }
      print(args, value, (v) => `${v.platform}: ${v.installed ? `installed${v.loaded ? " and running" : " (not loaded)"}` : "not installed"}${v.file ? ` — ${v.file}` : ""}`);
      return;
    }

    case "status": {
      const s = resolvedSummarizer(config);
      const personalExists = existsSync(config.personalBrain);
      const value = {
        version: VERSION,
        node: process.execPath,
        cli: CLI_PATH,
        configPath: configPath(),
        personalBrain: config.personalBrain,
        personalExists,
        personalIsRepo: personalExists && !!findRepoRoot(config.personalBrain),
        personalRemote: personalExists ? remoteUrl(config.personalBrain) : null,
        capture: config.capture,
        summarizer: { provider: s.provider, url: s.url, model: s.model, apiKeyEnv: s.apiKeyEnv, hasKey: !!s.apiKey },
        pending: existsSync(config.rawStore) ? listPending(config).length : 0,
        defaultBrain: defaultBrainName(config),
        brains: Object.fromEntries(Object.entries(config.brains || {}).map(([n, b]) => [n, b.path || b])),
        scheduler: { mode: config.scheduler.mode, ...scheduler.status() },
      };
      print(args, value, (v) => [
        `Brainium ${v.version}`,
        `Personal brain: ${v.personalBrain}${v.personalExists ? "" : " (not created — run brainium init-personal)"}`,
        `Capture: ${v.capture ? "on" : "off"} · summarizer: ${v.summarizer.provider}${v.summarizer.model ? ` (${v.summarizer.model})` : ""}`,
        `Pending captures: ${v.pending}`,
        `Brains: personal${Object.keys(v.brains).length ? ", " + Object.keys(v.brains).join(", ") : ""} (default: ${v.defaultBrain})`,
        `Routines scheduler: ${v.scheduler.mode}${v.scheduler.mode === "os" ? (v.scheduler.loaded ? " (running)" : " (not running — brainium scheduler install)") : ""}`,
      ].join("\n"));
      return;
    }

    case "pending": {
      const items = existsSync(config.rawStore) ? listPending(config).map(({ digest, ...m }) => m) : [];
      print(args, items, (v) => (v.length ? v.map((p) => `${p.id}  ${p.topic}`).join("\n") : "No captured sessions waiting."));
      return;
    }

    case "distill": {
      const results = await distill(config, {
        mechanical: !!args.mechanical,
        olderThanDays: args["older-than-days"] !== undefined ? Number(args["older-than-days"]) : null,
      });
      print(args, results, (v) => (v.length ? v.map((r) => `${r.id}: ${r.status}${r.path ? ` → ${r.path}` : ""}${r.error ? ` (${r.error})` : ""}`).join("\n") : "Nothing pending."));
      return;
    }

    case "mcp":
      serve();
      return;

    case "capture": {
      // Hook: never fail loudly, never block the session.
      try {
        const hook = JSON.parse((await readStdin()) || "{}");
        capture(hook, config, { brain: typeof args.brain === "string" ? args.brain : "" });
      } catch (err) {
        process.stderr.write(`brainium capture: ${err.message}\n`);
      }
      return;
    }

    case "session-start": {
      try {
        const input = await readStdin();
        let cwd = process.cwd();
        try { cwd = JSON.parse(input || "{}").cwd || cwd; } catch { /* not JSON */ }
        try {
          const { preflight } = await import("../cli/lib/preflight.mjs");
          const r = preflight(config, { cwd, agent: process.env.BRAINIUM_AGENT || "" });
          if (r.configured) process.stdout.write(r.text + "\n");
        } catch { /* never block a session */ }
        const msg = sessionStartMessage(config);
        if (msg) process.stdout.write(msg + "\n");
      } catch { /* never block a session */ }
      return;
    }

    default:
      throw new Error(`unknown command "${cmd}" — run brainium help`);
  }
}

main().catch((err) => {
  process.stderr.write(`brainium: ${err.message}\n`);
  process.exit(1);
});
