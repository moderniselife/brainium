import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, fake } from "./helpers.mjs";
import { PKG_ROOT } from "../lib/personal.mjs";

const CLI = join(PKG_ROOT, "bin", "brainium.mjs");

test("CLI: init, configure every provider, status, wire a profile", () => {
  const s = sandbox();
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env: s.env, encoding: "utf8" });
  assert.match(run("init-personal", s.personal), /Created personal brain/);
  run("config", "set", "rawStore", s.raw);
  for (const p of ["agent", "none", "anthropic", "openai", "bonsai", "openai-compatible"]) run("config", "set", "summarizer.provider", p);
  run("config", "set", "summarizer.apiKey", fake("sk-", "secret-value-123456"));
  const shown = run("config", "show");
  assert.doesNotMatch(shown, /sk-secret-value/);
  assert.match(shown, /\(stored\)/);
  assert.throws(() => run("config", "set", "summarizer.provider", "gemini"), /must be one of/);
  run("config", "set", "capture", "true");

  const status = JSON.parse(run("status", "--json"));
  assert.equal(status.personalBrain, s.personal);
  assert.equal(status.personalIsRepo, true);
  assert.equal(status.capture, true);
  assert.equal(status.summarizer.provider, "openai-compatible");
  assert.equal(status.summarizer.hasKey, true);
  assert.equal(status.pending, 0);

  const profile = join(s.root, "Work");
  const wired = JSON.parse(run("wire", "--app", "claude-code", "--profile", profile, "--capture", "--json"));
  assert.ok(wired.changed.some((p) => p.endsWith("settings.json")));
  const hook = JSON.parse(readFileSync(join(profile, "settings.json"), "utf8")).hooks.SessionEnd[0].hooks[0].command;
  assert.ok(hook.includes(process.execPath) && hook.endsWith(" capture"), "hook uses absolute node + CLI");
  const grok = JSON.parse(run("wire", "--app", "grok-bot", "--json"));
  assert.match(grok.snippet, /Second brain \(Brainium\)/);
  // The hook entry point never fails the session, even on garbage input.
  execFileSync(process.execPath, [CLI, "capture"], { env: s.env, input: "not json" });
});
