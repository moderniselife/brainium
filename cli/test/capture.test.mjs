import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sandbox, put, useEnv, fake } from "./helpers.mjs";
import { initPersonal } from "../lib/personal.mjs";
import { loadConfig } from "../lib/config.mjs";
import { capture, distill, listPending, parseTranscript, sessionStartMessage } from "../lib/capture.mjs";
import { callTool } from "../lib/mcp.mjs";
import { localDate, writeJsonAtomic } from "../lib/fsutil.mjs";

// Captures are dated by the local day they happen on (CI runs in UTC).
const today = () => localDate(new Date());

const line = (o) => JSON.stringify(o);
function transcript(cwd) {
  return [
    line({ type: "user", cwd, timestamp: "2026-11-16T09:00:00Z", message: { role: "user", content: `Fix the flaky deploy, my key is ${fake("sk-", "ant-api03-", "abcdefghijklmnopqrstu")}` } }),
    line({ type: "assistant", timestamp: "2026-11-16T09:01:00Z", message: { content: [
      { type: "text", text: "Looking at the deploy script." },
      { type: "tool_use", name: "Edit", input: { file_path: `${cwd}/deploy.sh` } },
      { type: "tool_use", name: "Bash", input: { command: `export ${"TOK"}EN=${fake("abc", "def123456")} && ./deploy.sh` } },
    ] } }),
    line({ type: "user", timestamp: "2026-11-16T09:02:00Z", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } }),
    line({ type: "assistant", timestamp: "2026-11-16T09:03:00Z", message: { content: [{ type: "text", text: "Done: added a retry to deploy.sh." }] } }),
  ].join("\n");
}

function setup(summarizer = {}) {
  const s = sandbox();
  writeJsonAtomic(s.env.BRAINIUM_CONFIG, { personalBrain: s.personal, rawStore: s.raw, capture: true, summarizer });
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const repo = join(s.root, "repo");
  mkdirSync(join(repo, "docs", "brainium", "sessions"), { recursive: true });
  const t = join(s.root, "t.jsonl");
  put(t, transcript(repo));
  return { ...s, restore, repo, t, config: () => loadConfig(s.env) };
}

test("parseTranscript pulls prompts, tools, files and commands", () => {
  const p = parseTranscript(transcript("/r"));
  assert.equal(p.prompts.length, 1);
  assert.deepEqual([...p.files], ["/r/deploy.sh"]);
  assert.equal(p.tools.Bash, 1);
  assert.equal(p.replies.at(-1), "Done: added a retry to deploy.sh.");
});

test("capture stores a redacted private copy and queues a digest; agent mode waits for the AI", async () => {
  const { t, repo, raw, config, restore, env } = setup();
  try {
    assert.equal(capture({ transcript_path: t, session_id: "abc", cwd: repo }, { ...config(), capture: false }), null, "off means off");
    const rec = capture({ transcript_path: t, session_id: "abc-123", cwd: repo }, config(), { spawnDistill: false });
    assert.ok(rec);
    assert.doesNotMatch(rec.digest, /sk-ant-api03|abcdef123456/);
    assert.match(rec.digest, /deploy\.sh/);
    const rawText = readFileSync(rec.raw, "utf8");
    assert.doesNotMatch(rawText, /sk-ant-api03/);
    assert.equal(statSync(rec.raw).mode & 0o777, 0o600);
    assert.equal(statSync(join(raw, "pending")).mode & 0o777, 0o700);
    assert.match(sessionStartMessage(config()), /1 captured session is waiting/);

    const r = await distill(config());
    assert.deepEqual(r.map((x) => x.status), ["waiting-for-agent"]);

    // The user's own AI files it over MCP.
    const pending = JSON.parse(await callTool("brain_pending", {}, { env }));
    assert.equal(pending[0].brain, "project");
    assert.match(await callTool("brain_pending_get", { id: pending[0].id }, { env }), /Fix the flaky deploy/);
    const filed = await callTool("brain_resolve", { id: pending[0].id, title: "Flaky deploy fixed", body: "**What we did** — added retry" }, { env });
    assert.ok(filed.includes(`Filed to project:sessions/${today()}.md`), filed);
    assert.equal(listPending(config()).length, 0);
    assert.match(readFileSync(join(repo, "docs", "brainium", "sessions", `${today()}.md`), "utf8"), /Flaky deploy fixed _\(captured\)_/);
  } finally { restore(); }
});

test("agent mode: old captures fall back to a mechanical entry so nothing is lost", async () => {
  const { t, repo, config, restore } = setup();
  try {
    capture({ transcript_path: t, session_id: "old", cwd: repo }, config(), { spawnDistill: false });
    const later = Date.now() + 8 * 86400000;
    const r = await distill(config(), { olderThanDays: 7, now: later });
    assert.equal(r[0].status, "filed");
    assert.match(readFileSync(join(repo, "docs", "brainium", "sessions", `${today()}.md`), "utf8"), /mechanical capture/);
  } finally { restore(); }
});

async function mockServer(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(handler(req)));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() };
}

for (const provider of ["openai-compatible", "bonsai", "openai"]) {
  test(`${provider}: summarizes over Chat Completions`, async () => {
    const mock = await mockServer(() => ({ choices: [{ message: { content: `TITLE: Deploy retry added\n**What we did** — added retry\nsecret ${fake("sk-", "proj-", "abcdefghijklmnopqrstuvwx")}` } }] }));
    const { t, repo, config, restore } = setup({ provider, url: `${mock.url}/v1`, model: "m1", apiKey: provider === "openai" ? "k-test" : "" });
    try {
      capture({ transcript_path: t, session_id: "x", cwd: repo }, config(), { spawnDistill: false });
      const r = await distill(config());
      assert.equal(r[0].status, "filed", r[0].error);
      assert.equal(mock.seen[0].url, "/v1/chat/completions");
      assert.equal(mock.seen[0].body.model, "m1");
      assert.equal(mock.seen[0].headers.authorization, provider === "openai" ? `${fake("Bea", "rer")} k-test` : undefined);
      assert.doesNotMatch(JSON.stringify(mock.seen[0].body), /sk-ant-api03/, "digest sent to the model is redacted");
      const day = readFileSync(join(repo, "docs", "brainium", "sessions", `${today()}.md`), "utf8");
      assert.match(day, new RegExp(`Deploy retry added _\\(captured · ${provider}\\)_`));
      assert.doesNotMatch(day, /sk-proj-/);
    } finally { restore(); mock.close(); }
  });
}

test("anthropic: summarizes over the Messages API with the key from the environment", async () => {
  const mock = await mockServer(() => ({ content: [{ type: "text", text: "TITLE: Deploy fixed\n**What we did** — retry" }] }));
  const { t, repo, config, restore } = setup({ provider: "anthropic", url: mock.url, apiKeyEnv: "MY_ANTHROPIC" });
  try {
    process.env.MY_ANTHROPIC = "ant-key";
    capture({ transcript_path: t, session_id: "y", cwd: repo }, config(), { spawnDistill: false });
    const r = await distill(config());
    assert.equal(r[0].status, "filed", r[0].error);
    assert.equal(mock.seen[0].url, "/v1/messages");
    assert.equal(mock.seen[0].headers["x-api-key"], "ant-key");
    assert.equal(mock.seen[0].headers["anthropic-version"], "2023-06-01");
    assert.equal(mock.seen[0].body.model, "claude-haiku-5-5");
  } finally { restore(); mock.close(); }
});

test("summarizer failures keep the capture queued with the error", async () => {
  const { t, repo, config, restore } = setup({ provider: "openai", model: "m" });
  try {
    capture({ transcript_path: t, session_id: "z", cwd: repo }, config(), { spawnDistill: false });
    const r = await distill(config());
    assert.equal(r[0].status, "error");
    assert.match(r[0].error, /no OpenAI API key/);
    assert.equal(listPending(config())[0].attempts, 1);
    const none = await distill({ ...config(), summarizer: { provider: "none" } });
    assert.equal(none[0].status, "filed");
  } finally { restore(); }
});
