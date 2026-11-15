import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sandbox, put } from "./helpers.mjs";
import { wire, grokSnippet } from "../lib/wire.mjs";
import { initPersonal } from "../lib/personal.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const NODE = "/opt/homebrew/bin/node";
const CLI = "/Users/joe/brainium/bin/brainium.mjs";

test("claude-code: wire is idempotent, preserves the user's config, and unwire reverses it", () => {
  const { root, personal } = sandbox();
  const dir = join(root, "profiles", "Work");
  put(join(dir, "CLAUDE.md"), "# My rules\n\nBe concise.\n");
  put(join(dir, "settings.json"), JSON.stringify({ model: "opus", hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "say bye" }] }] } }));
  put(join(dir, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" }, mcpServers: { gh: { command: "gh-mcp" } } }));
  const opts = { app: "claude-code", profileDir: dir, personalBrain: personal, capture: true, node: NODE, cli: CLI };

  const first = wire(opts);
  assert.equal(first.changed.length, 4);
  assert.equal(wire(opts).changed.length, 0, "second wire changes nothing");

  const skill = readFileSync(join(dir, "skills", "brainium", "SKILL.md"), "utf8");
  assert.match(skill, new RegExp(personal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const md = readFileSync(join(dir, "CLAUDE.md"), "utf8");
  assert.match(md, /^# My rules\n\nBe concise\.\n\n<!-- brainium:begin/);
  const state = readJson(join(dir, ".claude.json"));
  assert.deepEqual(state.oauthAccount, { emailAddress: "a@b.c" });
  assert.deepEqual(state.mcpServers.gh, { command: "gh-mcp" });
  assert.deepEqual(state.mcpServers.brainium, { type: "stdio", command: NODE, args: [CLI, "mcp"], env: {} });
  const settings = readJson(join(dir, "settings.json"));
  assert.equal(settings.model, "opus");
  const end = settings.hooks.SessionEnd.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(end, ["say bye", `${NODE} ${CLI} capture`]);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, `${NODE} ${CLI} session-start`);

  // Turning capture off removes only our hooks.
  wire({ ...opts, capture: false });
  const s2 = readJson(join(dir, "settings.json"));
  assert.deepEqual(s2.hooks.SessionEnd.flatMap((g) => g.hooks.map((h) => h.command)), ["say bye"]);
  assert.equal(s2.hooks.SessionStart, undefined);

  wire(opts, false);
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# My rules\n\nBe concise.\n");
  assert.equal(existsSync(join(dir, "skills", "brainium")), false);
  const s3 = readJson(join(dir, ".claude.json"));
  assert.deepEqual(Object.keys(s3.mcpServers), ["gh"]);
  assert.deepEqual(readJson(join(dir, "settings.json")).hooks.SessionEnd[0].hooks[0].command, "say bye");
});

test("claude-code: paths with spaces are quoted in hook commands", () => {
  const { root, personal } = sandbox();
  const dir = join(root, "p");
  wire({ app: "claude-code", profileDir: dir, personalBrain: personal, capture: true, node: "/Users/Joe Shenton/node", cli: CLI });
  const cmd = readJson(join(dir, "settings.json")).hooks.SessionEnd[0].hooks[0].command;
  assert.equal(cmd, `"/Users/Joe Shenton/node" ${CLI} capture`);
});

test("claude-code: the built-in profile keeps MCP in ~/.claude.json only when CLAUDE_CONFIG_DIR is unset", async () => {
  const { claudeStateFile } = await import("../lib/wire.mjs");
  assert.match(claudeStateFile("/home/x/.claude", { system: true, env: {} }), /\.claude\.json$/);
  assert.equal(claudeStateFile("/p/Work", { system: false, env: {} }), "/p/Work/.claude.json");
  assert.equal(claudeStateFile("/custom", { system: true, env: { CLAUDE_CONFIG_DIR: "/custom" } }), "/custom/.claude.json");
});

test("claude-desktop and cursor get an MCP entry; unknown JSON keys survive", () => {
  const { root, personal } = sandbox();
  const desk = join(root, "desk");
  put(join(desk, "claude_desktop_config.json"), JSON.stringify({ preferences: { menuBarEnabled: true }, mcpServers: {} }));
  wire({ app: "claude-desktop", profileDir: desk, personalBrain: personal, node: NODE, cli: CLI });
  const d = readJson(join(desk, "claude_desktop_config.json"));
  assert.equal(d.preferences.menuBarEnabled, true);
  assert.equal(d.mcpServers.brainium.command, NODE);

  const cursorHome = join(root, ".cursor");
  wire({ app: "cursor", cursorHome, personalBrain: personal, node: NODE, cli: CLI });
  assert.deepEqual(readJson(join(cursorHome, "mcp.json")).mcpServers.brainium.args, [CLI, "mcp"]);
  wire({ app: "cursor", cursorHome, personalBrain: personal }, false);
  assert.equal(readJson(join(cursorHome, "mcp.json")).mcpServers, undefined);
});

test("refuses to rewrite a config it can't parse", () => {
  const { root, personal } = sandbox();
  const desk = join(root, "desk");
  put(join(desk, "claude_desktop_config.json"), "{ broken");
  assert.throws(() => wire({ app: "claude-desktop", profileDir: desk, personalBrain: personal }));
  assert.equal(readFileSync(join(desk, "claude_desktop_config.json"), "utf8"), "{ broken");
});

test("grok-bot: returns a snippet naming the personal brain's remote", () => {
  const { personal, env } = sandbox();
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    initPersonal(personal);
    execFileSync("git", ["remote", "add", "origin", "https://github.com/joe/brain.git"], { cwd: personal });
    const r = wire({ app: "grok-bot", personalBrain: personal });
    assert.equal(r.changed.length, 0);
    assert.match(r.snippet, /https:\/\/github\.com\/joe\/brain\.git/);
    assert.match(grokSnippet(personal, "Ticket Triage"), /agents\/ticket-triage\.md/);
    assert.match(grokSnippet(join(personal, "missing")), /add a remote first/);
  } finally {
    Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; });
    Object.assign(process.env, saved);
  }
});
