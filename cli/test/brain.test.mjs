import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sandbox, put, useEnv, fake } from "./helpers.mjs";
import { initPersonal } from "../lib/personal.mjs";
import { brainRoots, findProjectBrain, logEntry, saveAgentCard, search, readEntry, listFolder } from "../lib/brain.mjs";
import { loadConfig } from "../lib/config.mjs";

function setup() {
  const s = sandbox();
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const config = { ...loadConfig(s.env), personalBrain: s.personal };
  return { ...s, restore, config };
}

test("init-personal scaffolds a git repo with agent cards and is idempotent", () => {
  const { personal, restore } = setup();
  try {
    for (const f of ["README.md", "agents/_template.md", "agents/README.md", "sessions/README.md", "memories/_template.md"]) {
      assert.ok(existsSync(join(personal, f)), f);
    }
    const log = execFileSync("git", ["log", "--oneline"], { cwd: personal, encoding: "utf8" });
    assert.match(log, /create personal brain/);
    put(join(personal, "memories", "mine.md"), "# keep me");
    const again = initPersonal(personal);
    assert.equal(again.existed, true);
    assert.equal(readFileSync(join(personal, "memories", "mine.md"), "utf8"), "# keep me");
  } finally { restore(); }
});

test("session and typed entries are written, indexed, redacted and committed", () => {
  const { personal, config, restore } = setup();
  try {
    const roots = brainRoots(config, "/nowhere");
    const now = new Date(2026, 10, 16, 9, 5);
    const s1 = logEntry(roots, config, { kind: "session", title: "Wire Prism", body: `**What we did** — used key ${fake("sk-", "ant-api03-", "abcdefghijklmnopqrstu")}`, now });
    assert.equal(s1.path, "personal:sessions/2026-11-16.md");
    assert.equal(s1.redacted, true);
    assert.equal(s1.commit, "committed");
    logEntry(roots, config, { kind: "session", title: "Second", body: "more", now: new Date(2026, 10, 16, 10, 0) });
    const day = readFileSync(join(personal, "sessions", "2026-11-16.md"), "utf8");
    assert.match(day, /### 09:05 — Wire Prism/);
    assert.match(day, /### 10:00 — Second/);
    assert.doesNotMatch(day, /sk-ant-api03/);

    const l = logEntry(roots, config, { kind: "learning", title: "Grok agents live on the account", body: "Use templates.", tags: "grok", now });
    assert.equal(l.path, "personal:learnings/2026-11-16-grok-agents-live-on-the-account.md");
    const idx = readFileSync(join(personal, "learnings", "README.md"), "utf8");
    assert.match(idx, /\| 2026-11-16 \| \[2026-11-16-grok-agents-live-on-the-account\]\(\.\/2026-11-16-grok-agents-live-on-the-account\.md\) \| grok \| Grok agents live on the account \|/);
    assert.doesNotMatch(idx, /\| — \| — \|/);
    assert.throws(() => logEntry(roots, config, { kind: "nope", title: "x", body: "y" }), /kind must be/);
  } finally { restore(); }
});

test("agent cards are created, updated with a changelog, and indexed once", () => {
  const { personal, config, restore } = setup();
  try {
    const roots = brainRoots(config, "/nowhere");
    const r1 = saveAgentCard(roots, config, { name: "Ticket Triage", apps: "Grok Bot", instructions: "Triage tickets.", templateLink: "https://grok.example/t/abc" }, new Date(2026, 10, 1));
    assert.equal(r1.created, true);
    const r2 = saveAgentCard(roots, config, { name: "Ticket Triage", apps: "Grok Bot, Claude Code", instructions: `Triage tickets v2. ${"tok"}en=${fake("abc", "def123456")}` }, new Date(2026, 10, 16));
    assert.equal(r2.created, false);
    const card = readFileSync(join(personal, "agents", "ticket-triage.md"), "utf8");
    assert.match(card, /Triage tickets v2/);
    assert.doesNotMatch(card, /abcdef123456/);
    assert.match(card, /- 2026-11-16: updated\n- 2026-11-01: created/);
    const idx = readFileSync(join(personal, "agents", "README.md"), "utf8");
    assert.equal(idx.match(/ticket-triage\.md/g).length, 1);
    assert.match(idx, /Grok Bot, Claude Code/);
  } finally { restore(); }
});

test("project brain is found by walking up; search spans both brains; reads can't escape", () => {
  const { root, personal, config, restore } = setup();
  try {
    const repo = join(root, "repo");
    mkdirSync(join(repo, "docs", "brainium", "learnings"), { recursive: true });
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    put(join(repo, "docs", "brainium", "learnings", "2026-11-01-flaky.md"), "# Flaky deploy\n\n## TLDR\n\nRetry the deploy hook.\n");
    put(join(personal, "memories", "2026-11-01-tone.md"), "# Tone\n\n## TLDR\n\nJoe likes concise deploy notes.\n");
    assert.equal(findProjectBrain(join(repo, "src", "deep")), join(repo, "docs", "brainium"));
    const roots = brainRoots(config, join(repo, "src", "deep"));
    const hits = search(roots, "deploy", { scope: "all" });
    assert.deepEqual(hits.map((h) => h.path).sort(), ["personal:memories/2026-11-01-tone.md", "project:learnings/2026-11-01-flaky.md"]);
    assert.match(readEntry(roots, "project:learnings/2026-11-01-flaky.md"), /Retry the deploy hook/);
    assert.throws(() => readEntry(roots, "personal:../config.json"), /escapes/);
    const list = listFolder(roots, "learnings", { scope: "project" });
    assert.equal(list.entries[0].tldr, "Retry the deploy hook.");
    // auto scope prefers the project brain
    const r = logEntry(roots, config, { kind: "session", title: "in repo", body: "x" });
    assert.match(r.path, /^project:sessions\//);
  } finally { restore(); }
});

test("commits work when the brain is reached through a symlink (macOS /var → /private/var)", () => {
  const s = sandbox();
  const restore = useEnv(s.env);
  try {
    const realDir = join(s.root, "real-brain");
    initPersonal(realDir);
    const link = join(s.root, "linked-brain");
    symlinkSync(realDir, link);
    const config = { ...loadConfig(s.env), personalBrain: link };
    const r = logEntry(brainRoots(config, "/nowhere"), config, { kind: "learning", title: "Via symlink", body: "x" });
    assert.equal(r.commit, "committed");
    assert.match(execFileSync("git", ["log", "--oneline"], { cwd: realDir, encoding: "utf8" }), /Via symlink/);
  } finally { restore(); }
});
