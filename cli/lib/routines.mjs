// Routines: scheduled jobs that live in a brain's routines/ folder.
//
//   routines/<slug>.md   settings in a front-matter block, then the prompt
//                        (type prompt) or command (type shell)
//
// `brainium routines tick` (run every minute by launchd / systemd / Task
// Scheduler, or by Prism while it's open) starts every routine that's due.
// Each run is logged to its agent's sessions/ (or shared/sessions/), and the
// full redacted output is kept in <rawStore>/routines/ on this machine.
//
// Safety: routines arrive through git, so prompt and shell routines only run
// after they're approved on this machine, and approval is tied to the file's
// exact content (any edit needs approving again). Upkeep jobs are built in.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configPath } from "./config.mjs";
import { brainRoots, listAgentsIn, logEntry, sharedRoot } from "./brain.mjs";
import { redact } from "./redact.mjs";
import { localDate, readJsonObject, slugify, writeFileAtomic, writeJsonAtomic } from "./fsutil.mjs";
import { commitPaths, findRepoRoot, remoteUrl } from "./git.mjs";

export const TYPES = ["prompt", "upkeep", "shell"];
export const APPS = ["claude-code", "codex"];
export const JOBS = ["sync", "distill", "digest"];

// ---------------------------------------------------------------------------
// File format

/** Split "---\nkey: value\n---\nbody" into { meta, body }. A small YAML subset: scalars only. */
export function parseRoutineFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else if (/^(true|yes|on)$/i.test(v)) v = true;
    else if (/^(false|no|off)$/i.test(v)) v = false;
    meta[kv[1].toLowerCase().replace(/-/g, "_")] = v;
  }
  return { meta, body: m[2].trim() };
}

/** Durations like "90s", "20m", "1h", "1h30m"; a bare number is minutes. */
export function parseDuration(v, fallbackMs) {
  if (v === undefined || v === null || v === "") return fallbackMs;
  if (/^\d+$/.test(String(v))) return Number(v) * 60_000;
  let ms = 0;
  const re = /(\d+)\s*(h|m|s)/gi;
  let any = false;
  for (let m; (m = re.exec(String(v)));) {
    any = true;
    ms += Number(m[1]) * ({ h: 3_600_000, m: 60_000, s: 1000 }[m[2].toLowerCase()]);
  }
  return any ? ms : fallbackMs;
}

// ---------------------------------------------------------------------------
// Schedules

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MACROS = { "@hourly": "0 * * * *", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@weekly": "0 0 * * 0", "@monthly": "0 0 1 * *", "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *" };

function cronField(spec, min, max, names) {
  const set = new Set();
  for (const part of spec.toLowerCase().split(",")) {
    const [rangeSpec, stepSpec] = part.split("/");
    const step = stepSpec === undefined ? 1 : Number(stepSpec);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step "${part}"`);
    const val = (s) => {
      const i = names ? names.indexOf(s) : -1;
      const n = i >= 0 ? i + (min === 1 ? 1 : 0) : Number(s);
      if (!Number.isInteger(n)) throw new Error(`bad value "${s}"`);
      return n;
    };
    let lo, hi;
    if (rangeSpec === "*") [lo, hi] = [min, max];
    else if (rangeSpec.includes("-")) [lo, hi] = rangeSpec.split("-").map(val);
    else [lo, hi] = [val(rangeSpec), stepSpec === undefined ? val(rangeSpec) : max];
    if (lo < min || hi > max || lo > hi) throw new Error(`"${part}" is out of range ${min}-${max}`);
    for (let n = lo; n <= hi; n += step) set.add(n);
  }
  return set;
}

/**
 * A schedule: cron ("min hour day month weekday", local time), a macro
 * (@daily…), or "every 15m" / "every 2h". Returns an object with
 * matches(date) for cron, or everyMs for intervals.
 */
export function parseSchedule(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("schedule is empty");
  const every = /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hours?|d|days?)$/i.exec(raw);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2][0].toLowerCase();
    const everyMs = n * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
    if (everyMs < 60_000) throw new Error("the shortest interval is 1 minute");
    return { kind: "every", everyMs, text: raw };
  }
  const expr = MACROS[raw.toLowerCase()] || raw;
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) throw new Error(`"${raw}" isn't a schedule: use cron (5 fields), @daily/@hourly/@weekly/@monthly, or "every 30m"`);
  const minute = cronField(parts[0], 0, 59);
  const hour = cronField(parts[1], 0, 23);
  const dom = cronField(parts[2], 1, 31);
  const month = cronField(parts[3], 1, 12, MONTHS);
  const dowRaw = cronField(parts[4], 0, 7, DAYS);
  const dow = new Set([...dowRaw].map((d) => d % 7));
  const domAny = parts[2] === "*";
  const dowAny = parts[4] === "*";
  const dayOk = (d) => {
    const a = dom.has(d.getDate());
    const b = dow.has(d.getDay());
    if (domAny && dowAny) return true;
    if (domAny) return b;
    if (dowAny) return a;
    return a || b; // classic cron: either restricted field may match
  };
  return {
    kind: "cron",
    text: raw,
    matches: (d) => minute.has(d.getMinutes()) && hour.has(d.getHours()) && month.has(d.getMonth() + 1) && dayOk(d),
    month, hour, minute, dayOk,
  };
}

const MINUTE = 60_000;
const floorMinute = (t) => Math.floor(t / MINUTE) * MINUTE;

/**
 * The most recent scheduled time in (since, now], or null. Interval
 * schedules count from `anchor` (when the routine was first seen).
 */
export function latestDue(schedule, now, since, anchor = since) {
  const nowMs = +now;
  const sinceMs = +since;
  if (schedule.kind === "every") {
    const a = +anchor;
    if (nowMs < a + schedule.everyMs) return null;
    const t = a + Math.floor((nowMs - a) / schedule.everyMs) * schedule.everyMs;
    return t > sinceMs ? new Date(t) : null;
  }
  // Walk back minute by minute, skipping whole hours/days/months that can't match.
  let t = floorMinute(nowMs);
  const limit = Math.max(sinceMs, nowMs - 400 * 86_400_000);
  while (t > limit) {
    const d = new Date(t);
    if (!schedule.month.has(d.getMonth() + 1)) {
      t = new Date(d.getFullYear(), d.getMonth(), 1).getTime() - MINUTE;
    } else if (!schedule.dayOk(d)) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - MINUTE;
    } else if (!schedule.hour.has(d.getHours())) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime() - MINUTE;
    } else if (schedule.minute.has(d.getMinutes())) {
      return new Date(t);
    } else {
      t -= MINUTE;
    }
  }
  return null;
}

/** The next scheduled time after `after` (for display), or null within a year. */
export function nextRun(schedule, after, anchor = after) {
  const afterMs = +after;
  if (schedule.kind === "every") {
    const a = +anchor;
    const k = Math.max(1, Math.floor((afterMs - a) / schedule.everyMs) + 1);
    return new Date(a + k * schedule.everyMs);
  }
  let t = floorMinute(afterMs) + MINUTE;
  const limit = afterMs + 400 * 86_400_000;
  while (t < limit) {
    const d = new Date(t);
    if (!schedule.month.has(d.getMonth() + 1)) {
      t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    } else if (!schedule.dayOk(d)) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    } else if (!schedule.hour.has(d.getHours())) {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    } else if (schedule.minute.has(d.getMinutes())) {
      return d;
    } else {
      t += MINUTE;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discovery

const expandHome = (p) => (p && String(p).startsWith("~") ? join(homedir(), String(p).slice(1)) : p);

/** Every routine in every brain (project brains have none). */
export function listRoutines(config, { brain } = {}) {
  const roots = brainRoots(config, null);
  const names = brain ? [brain].filter((b) => roots[b]) : Object.keys(roots);
  const out = [];
  for (const b of names) {
    const dir = join(roots[b], "routines");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".md") || file === "README.md" || file.startsWith("_") || file.startsWith(".")) continue;
      out.push(loadRoutine(b, roots[b], join(dir, file)));
    }
  }
  return out;
}

function loadRoutine(brain, root, file) {
  const text = readFileSync(file, "utf8");
  const { meta, body } = parseRoutineFile(text);
  const slug = file.split(/[\\/]/).pop().replace(/\.md$/, "");
  const errors = [];
  const type = String(meta.type || "prompt").toLowerCase();
  if (!TYPES.includes(type)) errors.push(`type must be ${TYPES.join(", ")}`);
  let schedule = null;
  try {
    schedule = parseSchedule(meta.schedule);
  } catch (e) {
    errors.push(`schedule: ${e.message}`);
  }
  const app = String(meta.app || "claude-code").toLowerCase();
  if (type === "prompt" && !APPS.includes(app)) errors.push(`app must be ${APPS.join(" or ")}`);
  const job = String(meta.job || "").toLowerCase();
  if (type === "upkeep" && !JOBS.includes(job)) errors.push(`job must be ${JOBS.join(", ")}`);
  if (type !== "upkeep" && !body) errors.push(type === "shell" ? "no command below the settings" : "no prompt below the settings");
  return {
    ref: `${brain}/${slug}`,
    brain,
    brainRoot: root,
    slug,
    file,
    name: String(meta.name || slug),
    type,
    schedule,
    scheduleText: String(meta.schedule || ""),
    agent: meta.agent ? String(meta.agent) : "",
    app,
    profile: meta.profile ? resolve(expandHome(String(meta.profile))) : "",
    cwd: meta.cwd ? resolve(expandHome(String(meta.cwd))) : "",
    args: meta.args ? String(meta.args) : "",
    job,
    timeoutMs: parseDuration(meta.timeout, 30 * MINUTE),
    catchUp: meta.catch_up !== false,
    enabled: meta.enabled !== false,
    body: type === "shell" ? shellCommand(body) : body,
    hash: routineHash(text),
    errors,
  };
}

/**
 * What approval is tied to: the whole file except the `enabled:` line, so
 * switching a routine on or off doesn't need approving again but any other
 * edit does.
 */
export function routineHash(text) {
  const normalised = text.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (block) => block.replace(/^enabled\s*:.*\r?\n?/m, ""));
  return createHash("sha256").update(normalised).digest("hex");
}

/** A shell routine's command: its first fenced code block, else the whole body. */
function shellCommand(body) {
  const fence = /```[\w-]*\r?\n([\s\S]*?)```/.exec(body);
  return (fence ? fence[1] : body).trim();
}

export function findRoutine(config, ref) {
  const [brain, slug] = String(ref || "").split("/");
  const r = listRoutines(config, { brain }).find((x) => x.slug === slug || slugify(x.name) === slug);
  if (!r) throw new Error(`no routine "${ref}" (see \`brainium routines\`)`);
  return r;
}

// ---------------------------------------------------------------------------
// Local state: approvals and run history (never in git)

function stateDir(env = process.env) {
  return dirname(configPath(env));
}
const statePath = (env) => join(stateDir(env), "routines-state.json");
const approvalsPath = (env) => join(stateDir(env), "routines-approved.json");

export function loadState(env = process.env) {
  try {
    return readJsonObject(statePath(env));
  } catch {
    return {};
  }
}

function updateState(ref, patch, env = process.env) {
  const all = loadState(env);
  all[ref] = { ...(all[ref] || {}), ...patch };
  writeJsonAtomic(statePath(env), all, 0o600);
  return all[ref];
}

export function loadApprovals(env = process.env) {
  try {
    return readJsonObject(approvalsPath(env));
  } catch {
    return {};
  }
}

export const needsApproval = (r) => r.type !== "upkeep";
export const isApproved = (r, approvals) => !needsApproval(r) || approvals[r.ref] === r.hash;

export function approveRoutine(config, ref, env = process.env) {
  const r = findRoutine(config, ref);
  if (r.errors.length) throw new Error(`${r.ref} has problems: ${r.errors.join("; ")}`);
  const all = loadApprovals(env);
  all[r.ref] = r.hash;
  writeJsonAtomic(approvalsPath(env), all, 0o600);
  return r.ref;
}

export function revokeRoutine(config, ref, env = process.env) {
  const all = loadApprovals(env);
  delete all[ref];
  writeJsonAtomic(approvalsPath(env), all, 0o600);
  return ref;
}

/** A routine as the CLI and Prism show it. */
export function describe(r, state = {}, approvals = {}, now = new Date()) {
  const s = state[r.ref] || {};
  let next = null;
  if (r.schedule && r.enabled && isApproved(r, approvals) && !r.errors.length) {
    const anchor = s.firstSeen ? new Date(s.firstSeen) : now;
    next = nextRun(r.schedule, now, anchor);
  }
  const running = s.running && pidAlive(s.running.pid) ? s.running : null;
  return {
    ref: r.ref,
    name: r.name,
    brain: r.brain,
    file: r.file,
    type: r.type,
    schedule: r.scheduleText,
    agent: r.agent || null,
    app: r.type === "prompt" ? r.app : null,
    profile: r.profile || null,
    job: r.job || null,
    enabled: r.enabled,
    needsApproval: needsApproval(r),
    approved: isApproved(r, approvals),
    changedSinceApproval: needsApproval(r) && !!approvals[r.ref] && approvals[r.ref] !== r.hash,
    errors: r.errors,
    nextRun: next ? next.toISOString() : null,
    lastRun: s.lastRun || null,
    lastStatus: s.lastStatus || null,
    lastExit: s.lastExit ?? null,
    lastDurationMs: s.lastDurationMs ?? null,
    lastLog: s.lastLog || null,
    lastOutput: s.lastOutput || null,
    running: running ? { pid: running.pid, startedAt: running.startedAt } : null,
  };
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// ---------------------------------------------------------------------------
// Tick: start what's due

/**
 * Start every routine that's due. `start(ref, scheduledFor)` launches a run
 * (by default a detached `brainium routines run`), so a tick returns at
 * once even when a prompt takes minutes. Safe to call from several
 * schedulers at once: a run re-checks and locks before doing anything.
 */
export function tick(config, { now = new Date(), env = process.env, start = startDetached } = {}) {
  const state = loadState(env);
  const approvals = loadApprovals(env);
  const actions = [];
  for (const r of listRoutines(config)) {
    if (r.errors.length || !r.enabled || !isApproved(r, approvals) || !r.schedule) continue;
    const s = state[r.ref] || {};
    if (!s.firstSeen) {
      // Never run the moment a routine appears (or is approved): wait for its next slot.
      updateState(r.ref, { firstSeen: now.toISOString() }, env);
      continue;
    }
    const since = new Date(Math.max(+new Date(s.firstSeen), s.lastScheduled ? +new Date(s.lastScheduled) : 0));
    const due = latestDue(r.schedule, now, since, new Date(s.firstSeen));
    if (!due) continue;
    if (!r.catchUp && +now - +due > 2 * MINUTE) {
      updateState(r.ref, { lastScheduled: due.toISOString(), lastStatus: "missed", lastRun: s.lastRun || null }, env);
      actions.push({ ref: r.ref, action: "missed", scheduledFor: due.toISOString() });
      continue;
    }
    if (s.running && pidAlive(s.running.pid)) {
      actions.push({ ref: r.ref, action: "still-running" });
      continue;
    }
    start(r.ref, due);
    actions.push({ ref: r.ref, action: "started", scheduledFor: due.toISOString() });
  }
  return actions;
}

function startDetached(ref, scheduledFor) {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "brainium.mjs");
  const child = spawn(process.execPath, [cli, "routines", "run", ref, "--scheduled-for", scheduledFor.toISOString()], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

// ---------------------------------------------------------------------------
// Run one routine

/** PATH with the usual places agent CLIs live (GUI apps and launchd get a bare PATH). */
export function richPath(env = process.env) {
  const home = homedir();
  const extra = process.platform === "win32"
    ? [dirname(process.execPath), join(env.APPDATA || join(home, "AppData", "Roaming"), "npm"), join(home, ".local", "bin")]
    : [dirname(process.execPath), join(home, ".local", "bin"), join(home, ".claude", "local"), join(home, ".npm-global", "bin"), join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return [...new Set([...(env.PATH || "").split(delimiter).filter(Boolean), ...extra])].join(delimiter);
}

/** True when the file is a binary for another OS (e.g. a Linux build inside an app's VM folder). */
function foreignBinary(p) {
  try {
    const fd = openSync(p, "r");
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    closeSync(fd);
    const elf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
    const macho = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(head.readUInt32BE(0));
    return (process.platform === "darwin" && elf) || (process.platform === "linux" && macho);
  } catch {
    return false;
  }
}

export function findTool(name, configured, env = process.env) {
  if (configured && existsSync(expandHome(configured))) return expandHome(configured);

  const exts = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const dir of richPath(env).split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        if (statSync(p).isFile() && !foreignBinary(p)) return p;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

/** Split "--a b 'c d'" into argv. */
export function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(String(s || "")));) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Run a process with a time limit; resolves { exit, output, timedOut }. Output keeps the last ~200 KB. */
export function runProcess(cmd, args, { cwd, env, timeoutMs, input } = {}) {
  return new Promise((resolveRun) => {
    let output = "";
    const keep = (chunk) => {
      output += chunk.toString();
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32" });
    } catch (e) {
      resolveRun({ exit: -1, output: e.message, timedOut: false });
      return;
    }
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    let timedOut = false;
    const kill = (sig) => {
      try {
        if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else process.kill(-child.pid, sig);
      } catch { /* already gone */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    }, timeoutMs || 30 * MINUTE);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolveRun({ exit: -1, output: output + e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveRun({ exit: code ?? -1, output, timedOut });
    });
  });
}

function lockPath(config, ref) {
  return join(config.rawStore, "routines", "locks", ref.replace(/[\\/]/g, "__") + ".lock");
}

function takeLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(readFileSync(path, "utf8").trim());
      if (pidAlive(pid)) return false;
      rmSync(path, { force: true }); // stale lock from a crashed run
    }
  }
  return false;
}

/**
 * Run a routine now. With `scheduledFor`, skips if another scheduler already
 * handled that slot. Prompt and shell routines must be approved here.
 */
export async function runRoutine(config, ref, { scheduledFor = null, force = false, env = process.env, now = () => new Date(), executors = {} } = {}) {
  const r = findRoutine(config, ref);
  if (r.errors.length) throw new Error(`${r.ref} can't run: ${r.errors.join("; ")}`);
  if (!isApproved(r, loadApprovals(env))) {
    throw new Error(`${r.ref} isn't approved on this machine${loadApprovals(env)[r.ref] ? " (it changed since you approved it)" : ""}. Review it, then: brainium routines approve ${r.ref}`);
  }
  if (!r.enabled && !force && scheduledFor) return { ref: r.ref, status: "disabled" };
  const lock = lockPath(config, r.ref);
  if (!takeLock(lock)) return { ref: r.ref, status: "already-running" };
  try {
    const slot = scheduledFor ? new Date(scheduledFor) : null;
    const before = loadState(env)[r.ref] || {};
    if (slot && before.lastScheduled && +new Date(before.lastScheduled) >= +slot) return { ref: r.ref, status: "already-done" };
    const started = now();
    updateState(r.ref, { running: { pid: process.pid, startedAt: started.toISOString() }, ...(slot ? { lastScheduled: slot.toISOString() } : {}) }, env);

    const exec = { prompt: execPrompt, shell: execShell, upkeep: execUpkeep, ...executors }[r.type];
    let result;
    try {
      result = await exec(r, config, { env, since: before.lastRun ? new Date(before.lastRun) : null, now: started });
    } catch (e) {
      result = { exit: -1, output: e.message, timedOut: false };
    }
    const ended = now();
    const status = result.timedOut ? "timed out" : result.exit === 0 ? "ok" : "failed";
    const output = redact(result.output || "").trim();
    const durationMs = +ended - +started;

    // Full output stays on this machine; the brain gets a short record.
    const stamp = started.toISOString().replace(/[:.]/g, "-");
    const rawFile = join(config.rawStore, "routines", r.brain, r.slug, `${stamp}.log`);
    writeFileAtomic(rawFile, output + "\n", 0o600);
    const tail = output.split("\n").slice(-60).join("\n");
    let logged = null;
    try {
      const roots = brainRoots(config, null);
      const body = [
        `**${status === "ok" ? "Ran" : status === "failed" ? "Failed" : "Timed out"}** — ${r.type}${r.type === "prompt" ? ` via ${r.app}` : r.type === "upkeep" ? ` (${r.job})` : ""}, ${Math.round(durationMs / 1000)}s${result.exit !== 0 && !result.timedOut ? `, exit ${result.exit}` : ""}.`,
        tail ? `\n**Output**${output.length > tail.length ? " (last lines; full log on the machine that ran it)" : ""}\n\n\`\`\`text\n${tail.replace(/```/g, "ʼʼʼ")}\n\`\`\`` : "",
      ].join("\n");
      logged = logEntry(roots, config, { kind: "session", title: `Routine: ${r.name}`, body, brain: r.brain, agent: r.agent, source: "routine", now: ended }).path;
    } catch (e) {
      logged = null;
    }
    updateState(r.ref, {
      running: null,
      lastRun: started.toISOString(),
      lastStatus: status,
      lastExit: result.exit,
      lastDurationMs: durationMs,
      lastLog: logged,
      lastRawLog: rawFile,
      lastOutput: tail.slice(-2000),
    }, env);
    return { ref: r.ref, status, exit: result.exit, durationMs, log: logged, rawLog: rawFile, output: tail };
  } finally {
    rmSync(lock, { force: true });
  }
}

function routineEnv(r, env, extra = {}) {
  return {
    ...env,
    PATH: richPath(env),
    BRAINIUM_BRAIN: r.brain,
    ...(r.agent ? { BRAINIUM_AGENT: r.agent } : {}),
    BRAINIUM_ROUTINE: r.ref,
    ...extra,
  };
}

async function execPrompt(r, config, { env }) {
  const preface = `[Brainium routine "${r.name}"${r.agent ? ` · you are the agent "${r.agent}"` : ""} · brain "${r.brain}". `
    + `Pass brain: "${r.brain}"${r.agent ? ` and agent: "${r.agent}"` : ""} on every Brainium call. No one is watching this run: don't ask questions, do the work and log what matters.]\n\n`;
  const prompt = preface + r.body;
  const cwd = r.cwd || r.brainRoot;
  if (r.app === "codex") {
    const bin = findTool("codex", config.routines?.codexPath, env);
    if (!bin) throw new Error("Codex's CLI (codex) isn't installed on this machine. Install it, or point Brainium at it: brainium config set routines.codexPath /path/to/codex");
    const extra = r.profile ? { CODEX_HOME: r.profile } : {};
    return runProcess(bin, ["exec", ...splitArgs(r.args), prompt], { cwd, env: routineEnv(r, env, extra), timeoutMs: r.timeoutMs });
  }
  const bin = findTool("claude", config.routines?.claudePath, env);
  if (!bin) throw new Error("Claude Code's CLI (claude) isn't installed on this machine. Install it (https://docs.claude.com/en/docs/claude-code/setup), or point Brainium at it: brainium config set routines.claudePath /path/to/claude");
  // The default ~/.claude profile runs without CLAUDE_CONFIG_DIR, exactly like
  // opening Claude Code normally (setting it would move its state file).
  const isDefault = !r.profile || resolve(r.profile) === resolve(join(homedir(), ".claude"));
  const extra = isDefault ? {} : { CLAUDE_CONFIG_DIR: r.profile };
  const childEnv = routineEnv(r, env, extra);
  if (isDefault) delete childEnv.CLAUDE_CONFIG_DIR;
  return runProcess(bin, ["-p", prompt, ...splitArgs(r.args)], { cwd, env: childEnv, timeoutMs: r.timeoutMs });
}

async function execShell(r, config, { env }) {
  const cwd = r.cwd || r.brainRoot;
  if (process.platform === "win32") {
    return runProcess("cmd.exe", ["/d", "/s", "/c", r.body], { cwd, env: routineEnv(r, env), timeoutMs: r.timeoutMs });
  }
  const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : "/bin/sh";
  return runProcess(shell, ["-lc", r.body], { cwd, env: routineEnv(r, env), timeoutMs: r.timeoutMs });
}

async function execUpkeep(r, config, { env, since, now }) {
  if (r.job === "sync") return syncBrain(r.brainRoot, env, r.timeoutMs);
  if (r.job === "distill") {
    const { distill } = await import("./capture.mjs");
    const results = await distill(config, {});
    const lines = results.map((x) => `${x.id}: ${x.status}${x.path ? ` → ${x.path}` : ""}${x.error ? ` (${x.error})` : ""}`);
    return { exit: results.some((x) => x.status === "failed") ? 1 : 0, output: lines.length ? lines.join("\n") : "Nothing pending.", timedOut: false };
  }
  // digest: what changed in this brain since the last run (default: a week).
  return { exit: 0, output: digest(r.brainRoot, since || new Date(+now - 7 * 86_400_000)), timedOut: false };
}

async function syncBrain(root, env, timeoutMs) {
  if (!findRepoRoot(root)) return { exit: 1, output: `${root} isn't a git repo.`, timedOut: false };
  if (!remoteUrl(root)) return { exit: 0, output: "No remote (origin) set for this brain; nothing to sync. Add one to share it between machines.", timedOut: false };
  const opts = { cwd: root, env: { ...env, PATH: richPath(env), GIT_TERMINAL_PROMPT: "0" }, timeoutMs };
  const pull = await runProcess("git", ["pull", "--rebase", "--autostash"], opts);
  if (pull.exit !== 0) return { ...pull, output: `git pull failed:\n${pull.output}` };
  const push = await runProcess("git", ["push"], opts);
  return { exit: push.exit, output: `${pull.output.trim()}\n${push.output.trim()}`.trim() || "Up to date.", timedOut: push.timedOut };
}

/** Titles of notes written since `since`, grouped by area (shared and each agent). */
export function digest(root, since) {
  const groups = new Map();
  const add = (area, line) => {
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(line);
  };
  const walk = (dir, area) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "README.md") continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p, area);
      else if (entry.name.endsWith(".md") && statSync(p).mtimeMs > +since) {
        const text = readFileSync(p, "utf8");
        const title = (/^#\s+(.+)$/m.exec(text) || [, entry.name])[1].trim();
        add(area, `- ${title} (${p.slice(root.length + 1).split(/[\\/]/).join("/")})`);
      }
    }
  };
  const shared = sharedRoot(root);
  for (const folder of ["sessions", "memories", "learnings", "decisions", "questions", "improvements", "failures"]) walk(join(shared, folder), "shared");
  for (const a of listAgentsIn(root)) if (a.dir) walk(a.dir, a.name);
  if (!groups.size) return `Nothing new since ${localDate(since)}.`;
  return [`New since ${localDate(since)}:`, ...[...groups].flatMap(([area, lines]) => [``, `**${area}**`, ...lines])].join("\n");
}

// ---------------------------------------------------------------------------
// Editing routines

/** Create a routine from the template (disabled, so nothing runs until you've looked at it). */
export function newRoutine(config, { brain, name, type = "prompt" }) {
  const roots = brainRoots(config, null);
  if (!roots[brain] || brain === "project") throw new Error(`no brain called "${brain}"`);
  if (!TYPES.includes(type)) throw new Error(`type must be ${TYPES.join(", ")}`);
  const slug = slugify(name);
  const file = join(roots[brain], "routines", `${slug}.md`);
  if (existsSync(file)) throw new Error(`${brain}/${slug} already exists`);
  const lines = ["---", `name: ${name}`, `schedule: "0 9 * * 1-5"`, `type: ${type}`, "agent: ", "enabled: false"];
  let body = "";
  if (type === "prompt") {
    lines.splice(5, 0, "app: claude-code", "profile: ~/.claude", "args: --permission-mode acceptEdits", "timeout: 20m");
    body = "Describe what this routine should do. It runs headlessly, so be specific about what to read and where to log the result.";
  } else if (type === "shell") {
    lines.splice(5, 0, "timeout: 10m");
    body = "```sh\necho \"hello from $BRAINIUM_ROUTINE\"\n```";
  } else {
    lines.splice(5, 0, "job: sync");
  }
  lines.push("---", "", body, "");
  writeFileAtomic(file, lines.join("\n"));
  const commit = config.commit === false ? "skipped" : commitPaths(roots[brain], [file], `brainium: routine ${slug} (new)`);
  return { ref: `${brain}/${slug}`, file, commit };
}

/** Flip `enabled:` in a routine's settings. */
export function setEnabled(config, ref, enabled) {
  const r = findRoutine(config, ref);
  const text = readFileSync(r.file, "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) throw new Error(`${r.ref} has no settings block`);
  const block = /^enabled\s*:.*$/m.test(m[1]) ? m[1].replace(/^enabled\s*:.*$/m, `enabled: ${enabled}`) : `${m[1]}\nenabled: ${enabled}`;
  writeFileAtomic(r.file, text.replace(m[1], block));
  if (config.commit !== false) commitPaths(r.brainRoot, [r.file], `brainium: routine ${r.slug} ${enabled ? "on" : "off"}`);
  return r.ref;
}

/**
 * Create or replace a routine from fields (the MCP tool). Always saved
 * disabled: the user turns it on, and approves it, on their machine.
 */
export function saveRoutine(config, { brain, name, schedule, type = "prompt", agent = "", app = "", profile = "", cwd = "", args = "", timeout = "", job = "", body = "" }) {
  const roots = brainRoots(config, null);
  if (!brain || !roots[brain] || brain === "project") throw new Error(`no brain called "${brain}"`);
  if (!name || !String(name).trim()) throw new Error("name is required");
  if (!TYPES.includes(type)) throw new Error(`type must be ${TYPES.join(", ")}`);
  parseSchedule(schedule); // throws with a clear message
  if (type === "upkeep" && !JOBS.includes(job)) throw new Error(`job must be ${JOBS.join(", ")}`);
  if (type !== "upkeep" && !String(body).trim()) throw new Error(type === "shell" ? "body (the command) is required" : "body (the prompt) is required");
  const q = (v) => (/^[\w ./~@:+-]*$/.test(String(v)) && !/^\s|\s$/.test(String(v)) ? String(v) : JSON.stringify(String(v)));
  const lines = ["---", `name: ${q(String(name).trim())}`, `schedule: ${JSON.stringify(String(schedule).trim())}`, `type: ${type}`];
  if (agent) lines.push(`agent: ${q(agent)}`);
  if (type === "prompt") lines.push(`app: ${app || "claude-code"}`);
  if (profile) lines.push(`profile: ${q(profile)}`);
  if (cwd) lines.push(`cwd: ${q(cwd)}`);
  if (args) lines.push(`args: ${q(args)}`);
  if (timeout) lines.push(`timeout: ${q(timeout)}`);
  if (type === "upkeep") lines.push(`job: ${job}`);
  lines.push("enabled: false", "---", "");
  const text = redact(type === "shell" ? "```sh\n" + String(body).trim() + "\n```" : String(body).trim());
  if (type !== "upkeep") lines.push(text, "");
  const slug = slugify(name);
  const file = join(roots[brain], "routines", `${slug}.md`);
  writeFileAtomic(file, lines.join("\n"));
  const commit = config.commit === false ? "skipped" : commitPaths(roots[brain], [file], `brainium: routine ${slug}`);
  return { ref: `${brain}/${slug}`, file, commit };
}
