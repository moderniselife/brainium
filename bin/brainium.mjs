#!/usr/bin/env node
// Brainium CLI. Zero dependencies; Node 18.17+.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { configPath, loadConfig, redactedConfig, resolvedSummarizer, setConfig, PROVIDERS } from "../cli/lib/config.mjs";
import { initPersonal, PKG_ROOT } from "../cli/lib/personal.mjs";
import { wire, grokSnippet, APPS, CLI_PATH } from "../cli/lib/wire.mjs";
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
  brainium wire --app APP [--profile DIR] [--system] [--capture]
  brainium unwire --app APP [--profile DIR] [--system]
                                        APP: ${APPS.join(", ")}
  brainium snippet grok [--agent NAME]  Instructions to paste into a Grok Bot agent
  brainium status                       Summary (add --json for machines)
  brainium pending                      Captured sessions waiting to be filed
  brainium distill [--mechanical] [--older-than-days N]
                                        File pending captures with the configured summarizer
  brainium mcp                          Run the MCP server (stdio)
  brainium capture | session-start      Claude Code hook entry points (read hook JSON on stdin)

Add --json to wire/unwire/status/pending/distill for machine-readable output.
Project brains: run scripts/install.sh in a repo (docs/brainium/).`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) out[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--") && !["system", "capture", "json", "mechanical", "help"].includes(k)) out[k] = argv[++i];
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
      }, cmd === "wire");
      print(args, r, (v) => [
        v.changed.length ? `${cmd === "wire" ? "Wired" : "Unwired"} ${app}:\n${v.changed.map((c) => `  ${c}`).join("\n")}` : `${app}: already ${cmd === "wire" ? "wired" : "unwired"}.`,
        ...v.notes,
        v.snippet ? `\nPaste into the Grok Bot agent's instructions:\n\n${v.snippet}` : "",
      ].filter(Boolean).join("\n"));
      return;
    }

    case "snippet": {
      if (rest[0] !== "grok") throw new Error("usage: brainium snippet grok [--agent NAME]");
      console.log(grokSnippet(config.personalBrain, typeof args.agent === "string" ? args.agent : ""));
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
      };
      print(args, value, (v) => [
        `Brainium ${v.version}`,
        `Personal brain: ${v.personalBrain}${v.personalExists ? "" : " (not created — run brainium init-personal)"}`,
        `Capture: ${v.capture ? "on" : "off"} · summarizer: ${v.summarizer.provider}${v.summarizer.model ? ` (${v.summarizer.model})` : ""}`,
        `Pending captures: ${v.pending}`,
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
        capture(hook, config);
      } catch (err) {
        process.stderr.write(`brainium capture: ${err.message}\n`);
      }
      return;
    }

    case "session-start": {
      try {
        await readStdin();
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
