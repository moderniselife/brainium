import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sandbox } from "./helpers.mjs";
import { PKG_ROOT } from "../lib/personal.mjs";
import { writeJsonAtomic } from "../lib/fsutil.mjs";

test("stdio MCP session: initialize, list tools, log, search, read", async () => {
  const s = sandbox();
  const repo = join(s.root, "repo");
  mkdirSync(join(repo, "docs", "brainium", "sessions"), { recursive: true });
  writeJsonAtomic(s.env.BRAINIUM_CONFIG, { personalBrain: s.personal, rawStore: s.raw });
  // personal brain
  const { initPersonal } = await import("../lib/personal.mjs");
  const saved = { ...process.env }; Object.assign(process.env, s.env);
  try { initPersonal(s.personal); } finally { Object.keys(process.env).forEach((k) => { if (!(k in saved)) delete process.env[k]; }); Object.assign(process.env, saved); }

  const child = spawn(process.execPath, [join(PKG_ROOT, "bin", "brainium.mjs"), "mcp"], { cwd: repo, env: s.env, stdio: ["pipe", "pipe", "inherit"] });
  const lines = createInterface({ input: child.stdout });
  const waiting = new Map();
  lines.on("line", (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
  let n = 0;
  const call = (method, params) => new Promise((res) => { const id = ++n; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const tool = async (name, args) => (await call("tools/call", { name, arguments: args })).result;

  try {
    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.result.serverInfo.name, "brainium");
    assert.match(init.result.instructions, /brain_pending/);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const tools = (await call("tools/list", {})).result.tools.map((t) => t.name);
    for (const t of ["brain_search", "brain_log", "brain_share", "agent_list", "agent_card_save", "routine_list", "routine_save", "brain_pending", "brain_resolve"]) assert.ok(tools.includes(t), t);

    const logged = await tool("brain_log", { kind: "session", title: "MCP works", body: "**What we did** — tested the server" });
    assert.match(logged.content[0].text, /Logged to project:sessions\//);
    const card = await tool("agent_card_save", { name: "Researcher", instructions: "Find sources." });
    assert.match(card.content[0].text, /Created personal:agents\/researcher\.md/);
    const hit = await tool("brain_search", { query: "tested server" });
    assert.match(hit.content[0].text, /project:sessions\//);
    const got = await tool("agent_card_get", { name: "Researcher" });
    assert.match(got.content[0].text, /Find sources\./);
    const bad = await tool("brain_read", { path: "personal:../../etc/passwd" });
    assert.equal(bad.isError, true);
    const unknown = await call("tools/call", { name: "nope", arguments: {} });
    assert.equal(unknown.error.code, -32602);
    const missing = await call("does/not/exist", {});
    assert.equal(missing.error.code, -32601);
  } finally {
    child.kill();
  }
});
