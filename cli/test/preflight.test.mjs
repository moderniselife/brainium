import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, useEnv } from "./helpers.mjs";
import { loadConfig, setConfig } from "../lib/config.mjs";
import { preflight } from "../lib/preflight.mjs";
import { callTool } from "../lib/mcp.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", ...a], { cwd, stdio: "pipe", encoding: "utf8" }).trim();

function setup() {
  const s = sandbox();
  const restore = useEnv(s.env);
  setConfig("rawStore", s.raw, s.env);
  const origin = join(s.root, "rules-origin.git");
  mkdirSync(origin);
  git(origin, "init", "--bare", "-q");
  const author = join(s.root, "author");
  git(s.root, "clone", "-q", origin, author);
  mkdirSync(join(author, "rules"));
  writeFileSync(join(author, "rules", "a.md"), "rule a\n");
  writeFileSync(join(author, "notes.md"), "not a rule\n");
  writeFileSync(join(author, "rules", "a.test.js"), "a test, not a rule\n");
  mkdirSync(join(author, "tess"));
  writeFileSync(join(author, "tess", "PROMPT.md"), "tess's own prompt\n");
  git(author, "add", "-A");
  git(author, "commit", "-qm", "first");
  git(author, "push", "-q", "origin", "HEAD:main");
  const project = join(s.root, "project");
  mkdirSync(project);
  git(project, "clone", "-q", origin, "rules-repo");
  writeFileSync(join(project, ".brainium.json"), JSON.stringify({ brain: "x", update: ["rules-repo", "missing-repo"], rules: ["rules-repo/rules", "rules-repo/{agent}", "!rules-repo/**/*.test.js"] }));
  const change = (file, text, msg) => {
    writeFileSync(join(author, file), text);
    git(author, "add", "-A");
    git(author, "commit", "-qm", msg);
    git(author, "push", "-q", "origin", "HEAD:main");
  };
  return { ...s, restore, project, change, config: () => loadConfig(s.env) };
}

test("preflight pulls listed repos and lists rule files changed since each agent last looked", () => {
  const { project, change, config, restore } = setup();
  try {
    const first = preflight(config(), { cwd: join(project, "rules-repo"), agent: "tess" });
    assert.equal(first.configured, true);
    assert.equal(first.firstRun, true);
    assert.deepEqual(first.changed.sort(), ["rules-repo/rules/a.md", "rules-repo/tess/PROMPT.md"]);
    assert.match(first.text, /missing-repo: not checked out/);

    const again = preflight(config(), { cwd: project, agent: "tess" });
    assert.deepEqual(again.changed, []);
    assert.match(again.text, /No rule changes since your last session/);

    change("rules/b.md", "rule b\n", "add b");
    change("notes.md", "still not a rule\n", "notes");
    const later = preflight(config(), { cwd: project, agent: "tess" });
    assert.equal(later.repos.find((r) => r.path === "rules-repo").status, "updated");
    assert.deepEqual(later.changed, ["rules-repo/rules/b.md"]);
    assert.match(later.text, /changed since your last session/);

    // Another agent starts from scratch: it's told to read every rule file.
    const other = preflight(config(), { cwd: project, agent: "ali" });
    assert.deepEqual(other.changed.sort(), ["rules-repo/rules/a.md", "rules-repo/rules/b.md"]);
  } finally { restore(); }
});

test("preflight leaves a pinned (detached) checkout and blocked pulls alone, and says so", () => {
  const { project, change, config, restore } = setup();
  try {
    const repo = join(project, "rules-repo");
    git(repo, "checkout", "-q", "--detach");
    change("rules/a.md", "rule a v2\n", "edit a");
    const r = preflight(config(), { cwd: project, agent: "tess" });
    assert.equal(r.repos.find((x) => x.path === "rules-repo").status, "skipped");
    assert.match(r.text, /detached HEAD \(pinned\); not pulled/);

    git(repo, "checkout", "-q", "main");
    writeFileSync(join(repo, "rules", "a.md"), "local edit\n");
    const blocked = preflight(config(), { cwd: project, agent: "tess" });
    assert.equal(blocked.repos.find((x) => x.path === "rules-repo").status, "failed");
    assert.match(blocked.text, /can't fast-forward/);
  } finally { restore(); }
});

test("brain_preflight reports when a project has no preflight set up", async () => {
  const { root, restore } = setup();
  try {
    const out = await callTool("brain_preflight", { agent: "tess" }, { cwd: root });
    assert.match(out, /No preflight set up/);
  } finally { restore(); }
});
