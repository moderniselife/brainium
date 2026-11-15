// Session capture (Claude Code hooks) and distillation into brain entries.
//
// capture   SessionEnd hook: copy the transcript — redacted — into the raw
//           store (outside every git repo, 0600), build a compact digest and
//           queue it as "pending". Always exits fast and never blocks Claude.
// distill   Turn pending digests into session entries with the configured
//           summarizer (anthropic / openai / bonsai / openai-compatible), or a
//           mechanical summary. With provider "agent" (the default) pending
//           captures wait for the user's own AI to file them over MCP
//           (brain_pending → brain_resolve) — no extra AI calls.
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { redact } from "./redact.mjs";
import { brainRoots, findProjectBrain, logEntry } from "./brain.mjs";
import { localDate, writeFileAtomic, writeJsonAtomic } from "./fsutil.mjs";
import { resolvedSummarizer } from "./config.mjs";

const DIGEST_LIMIT = 12000;

function privateDir(p) {
  mkdirSync(p, { recursive: true, mode: 0o700 });
  try { chmodSync(p, 0o700); } catch { /* best effort */ }
  return p;
}

const pendingDir = (config) => privateDir(join(config.rawStore, "pending"));
const doneDir = (config) => privateDir(join(config.rawStore, "done"));

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((c) => c && c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
}

/** Pull the useful shape out of a Claude Code JSONL transcript. */
export function parseTranscript(jsonl) {
  const out = { prompts: [], replies: [], files: new Set(), commands: [], tools: {}, cwd: "", start: "", end: "" };
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.timestamp) { out.start ||= ev.timestamp; out.end = ev.timestamp; }
    if (ev.cwd && !out.cwd) out.cwd = ev.cwd;
    const msg = ev.message || {};
    if (ev.type === "user" && !ev.isMeta) {
      const t = textOf(msg.content).trim();
      // Skip tool results and slash-command plumbing.
      if (t && !t.startsWith("<command-") && !t.startsWith("<local-command")) out.prompts.push(t);
    } else if (ev.type === "assistant") {
      const t = textOf(msg.content).trim();
      if (t) out.replies.push(t);
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c?.type !== "tool_use") continue;
        out.tools[c.name] = (out.tools[c.name] || 0) + 1;
        const input = c.input || {};
        for (const k of ["file_path", "path", "notebook_path"]) if (typeof input[k] === "string") out.files.add(input[k]);
        if (typeof input.command === "string") out.commands.push(input.command.split("\n")[0].slice(0, 160));
      }
    }
  }
  return out;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Compact, redacted markdown digest of a session — what a summarizer reads. */
export function buildDigest(parsed) {
  const parts = [];
  parts.push(`Working directory: ${parsed.cwd || "unknown"}`);
  if (parsed.start) parts.push(`Time: ${parsed.start} → ${parsed.end}`);
  parts.push("\n## User asked");
  parsed.prompts.slice(0, 25).forEach((p, i) => parts.push(`${i + 1}. ${clip(p.replace(/\s+/g, " "), 400)}`));
  if (parsed.prompts.length > 25) parts.push(`… ${parsed.prompts.length - 25} more`);
  const tools = Object.entries(parsed.tools).map(([k, v]) => `${k}×${v}`).join(", ");
  if (tools) parts.push(`\n## Tools used\n${tools}`);
  if (parsed.files.size) parts.push(`\n## Files touched\n${[...parsed.files].slice(0, 40).map((f) => `- ${f}`).join("\n")}`);
  if (parsed.commands.length) parts.push(`\n## Commands\n${parsed.commands.slice(0, 25).map((c) => `- \`${c}\``).join("\n")}`);
  if (parsed.replies.length) {
    parts.push("\n## Assistant's final reply");
    parts.push(clip(parsed.replies[parsed.replies.length - 1], 2500));
  }
  return clip(redact(parts.join("\n")), DIGEST_LIMIT);
}

export function topicOf(parsed) {
  const first = (parsed.prompts[0] || "Session").split("\n")[0].replace(/\s+/g, " ").trim();
  return redact(clip(first, 80));
}

/** SessionEnd hook body. Returns the pending record, or null when skipped. */
export function capture(hook, config, { spawnDistill = true } = {}) {
  if (!config.capture) return null;
  const transcript = hook.transcript_path;
  if (!transcript || !existsSync(transcript)) return null;
  const raw = readFileSync(transcript, "utf8");
  const parsed = parseTranscript(raw);
  if (parsed.prompts.length === 0) return null; // nothing said, nothing to keep
  const now = new Date();
  const sessionId = String(hook.session_id || basename(transcript, ".jsonl")).replace(/[^A-Za-z0-9_-]/g, "");
  const id = `${localDate(now)}-${sessionId.slice(0, 12)}-${now.getTime().toString(36)}`;
  const rawPath = join(privateDir(join(config.rawStore, "raw", localDate(now))), `${id}.jsonl`);
  writeFileAtomic(rawPath, redact(raw), 0o600);
  const cwd = hook.cwd || parsed.cwd || "";
  const record = {
    id,
    sessionId,
    cwd,
    projectBrain: findProjectBrain(cwd),
    endedAt: now.toISOString(),
    reason: hook.reason || "",
    topic: topicOf(parsed),
    digest: buildDigest(parsed),
    raw: rawPath,
    attempts: 0,
  };
  writeJsonAtomic(join(pendingDir(config), `${id}.json`), record, 0o600);
  if (spawnDistill && resolvedSummarizer(config).provider !== "agent") {
    // Detached so the hook returns immediately.
    const child = spawn(process.execPath, [process.argv[1], "distill"], { detached: true, stdio: "ignore", env: process.env });
    child.unref();
  }
  return record;
}

export function listPending(config) {
  const dir = pendingDir(config);
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")));
}

export function getPending(config, id) {
  const file = join(pendingDir(config), `${String(id).replace(/[^A-Za-z0-9_-]/g, "")}.json`);
  if (!existsSync(file)) throw new Error(`no pending capture "${id}"`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** File a pending capture as a session entry and mark it done. */
export function resolvePending(config, id, { title, body, scope = "auto", source = "captured" }) {
  const rec = getPending(config, id);
  const roots = brainRoots(config, rec.cwd);
  const result = logEntry(roots, config, { kind: "session", title: title || rec.topic, body, scope, source, now: new Date(rec.endedAt) });
  // Keep a small receipt (no digest); the redacted raw transcript stays in the raw store.
  const { digest, ...meta } = rec;
  writeJsonAtomic(join(doneDir(config), `${rec.id}.json`), { ...meta, filedAt: new Date().toISOString(), filedTo: result.path }, 0o600);
  rmSync(join(pendingDir(config), `${rec.id}.json`), { force: true });
  return result;
}

// ---------------------------------------------------------------------------
// Summarizers

const SYSTEM_PROMPT = `You turn a captured coding/agent session digest into a concise Brainium session entry.
Reply in exactly this shape and nothing else:
TITLE: <one-line topic, max 80 chars>
**What we did** — 2-6 bullets.
**Learnings** — bullets, or "none".
**Mistakes / near-misses** — bullets, or "none".
**Open threads** — bullets, or "none".
**Artifacts** — files, commits, PRs, tickets mentioned.
Never include secrets, keys, tokens or passwords.`;

/** Mechanical entry: no AI at all. */
export function mechanicalEntry(rec) {
  const lines = rec.digest.split("\n");
  const asked = lines.filter((l) => /^\d+\.\s/.test(l)).slice(0, 6).map((l) => `- ${l.replace(/^\d+\.\s/, "")}`);
  const files = lines.filter((l) => l.startsWith("- ") && !l.startsWith("- `")).slice(0, 10);
  const cmds = lines.filter((l) => l.startsWith("- `")).slice(0, 6);
  const body = [
    "**What we did** — (mechanical capture, not AI-summarised)",
    ...(asked.length ? asked : ["- (no prompts)"]),
    "",
    "**Artifacts**",
    ...(files.length ? files : ["- none recorded"]),
    ...(cmds.length ? ["", "**Commands**", ...cmds] : []),
  ].join("\n");
  return { title: rec.topic, body };
}

async function postJson(url, headers, body, timeoutMs = 120000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Ask the configured provider for a summary. Returns { title, body }. */
export async function summarize(config, rec, env = process.env) {
  const s = resolvedSummarizer(config, env);
  if (s.provider === "none") return mechanicalEntry(rec);
  if (s.provider === "agent") throw new Error("provider is 'agent': pending captures are filed by your AI over MCP");
  if (!s.url) throw new Error(`summarizer.url is required for provider "${s.provider}"`);
  if (!s.model) throw new Error(`summarizer.model is required for provider "${s.provider}"`);
  let text;
  if (s.provider === "anthropic") {
    if (!s.apiKey) throw new Error(`no Anthropic API key (set ${s.apiKeyEnv || "summarizer.apiKeyEnv"} or summarizer.apiKey)`);
    const data = await postJson(`${s.url}/v1/messages`, { "x-api-key": s.apiKey, "anthropic-version": "2023-06-01" }, {
      model: s.model,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: rec.digest }],
    });
    text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  } else {
    // openai, bonsai, openai-compatible: Chat Completions.
    if (s.provider === "openai" && !s.apiKey) throw new Error(`no OpenAI API key (set ${s.apiKeyEnv || "summarizer.apiKeyEnv"} or summarizer.apiKey)`);
    const data = await postJson(`${s.url}/chat/completions`, s.apiKey ? { authorization: `Bearer ${s.apiKey}` } : {}, {
      model: s.model,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: rec.digest }],
    });
    text = data.choices?.[0]?.message?.content || "";
  }
  text = redact(String(text).trim());
  if (!text) throw new Error("summarizer returned nothing");
  const m = /^TITLE:\s*(.+)\n+/i.exec(text);
  return { title: m ? m[1].trim().slice(0, 80) : rec.topic, body: m ? text.slice(m[0].length).trim() : text };
}

/**
 * Distill pending captures. With provider "agent" nothing happens unless
 * `mechanical` or `olderThanDays` forces a fallback, so captures never sit
 * forever when the agent doesn't get to them.
 */
export async function distill(config, { mechanical = false, olderThanDays = null, env = process.env, now = Date.now() } = {}) {
  const s = resolvedSummarizer(config, env);
  const results = [];
  for (const rec of listPending(config)) {
    const age = (now - Date.parse(rec.endedAt)) / 86400000;
    const forceFallback = mechanical || (olderThanDays !== null && age >= olderThanDays);
    if (s.provider === "agent" && !forceFallback) {
      results.push({ id: rec.id, status: "waiting-for-agent" });
      continue;
    }
    try {
      const useAI = !forceFallback && s.provider !== "none";
      const entry = useAI ? await summarize(config, rec, env) : mechanicalEntry(rec);
      const filed = resolvePending(config, rec.id, { ...entry, source: useAI ? `captured · ${s.provider}` : "captured" });
      results.push({ id: rec.id, status: "filed", path: filed.path });
    } catch (err) {
      rec.attempts = (rec.attempts || 0) + 1;
      rec.lastError = String(err.message || err).slice(0, 300);
      writeJsonAtomic(join(pendingDir(config), `${rec.id}.json`), rec, 0o600);
      results.push({ id: rec.id, status: "error", error: rec.lastError });
    }
  }
  return results;
}

/** SessionStart hook: tell the agent when captures are waiting for it. */
export function sessionStartMessage(config) {
  if (!config.capture) return "";
  const n = listPending(config).length;
  if (n === 0) return "";
  return `Brainium: ${n} captured session${n === 1 ? " is" : "s are"} waiting to be filed. Call brain_pending, then brain_pending_get and brain_resolve for each (concise entries, no secrets).`;
}
