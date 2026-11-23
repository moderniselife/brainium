import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, put, useEnv } from "./helpers.mjs";
import { initBrain, initPersonal } from "../lib/personal.mjs";
import { addBrain, loadConfig, setConfig } from "../lib/config.mjs";
import {
  approveRoutine, describe, digest, latestDue, listRoutines, loadApprovals, loadState, newRoutine, nextRun,
  parseDuration, parseRoutineFile, parseSchedule, runRoutine, saveRoutine, setEnabled, splitArgs, tick,
} from "../lib/routines.mjs";
import { launchdPlist } from "../lib/scheduler.mjs";

function team() {
  const s = sandbox();
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const mojo = join(s.root, "mojo");
  initBrain(mojo);
  addBrain("mojo", mojo, s.env);
  setConfig("personalBrain", s.personal, s.env);
  setConfig("rawStore", s.raw, s.env);
  return { ...s, mojo, restore, config: () => loadConfig(s.env) };
}

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

test("front matter, durations and argument splitting", () => {
  const { meta, body } = parseRoutineFile(`---\nname: "Morning: brief"\nschedule: "0 8 * * 1-5"  # weekdays\nenabled: false\ncatch-up: no\n---\n\nDo the thing.\n`);
  assert.deepEqual(meta, { name: "Morning: brief", schedule: "0 8 * * 1-5", enabled: false, catch_up: false });
  assert.equal(body, "Do the thing.");
  assert.equal(parseDuration("1h30m"), 5_400_000);
  assert.equal(parseDuration("90s"), 90_000);
  assert.equal(parseDuration("15"), 900_000);
  assert.equal(parseDuration("", 7), 7);
  assert.deepEqual(splitArgs(`--permission-mode acceptEdits --allowedTools "Read Write" 'a b'`), ["--permission-mode", "acceptEdits", "--allowedTools", "Read Write", "a b"]);
});

test("cron schedules: next and latest runs, ranges, steps, names and the day-of-month/weekday rule", () => {
  const weekdays8 = parseSchedule("0 8 * * 1-5");
  assert.deepEqual(nextRun(weekdays8, at(2026, 11, 14, 9)), at(2026, 11, 16, 8)); // Sat → Mon
  assert.deepEqual(latestDue(weekdays8, at(2026, 11, 16, 8, 30), at(2026, 11, 13, 9)), at(2026, 11, 16, 8));
  assert.equal(latestDue(weekdays8, at(2026, 11, 16, 7, 59), at(2026, 11, 13, 9)), null);
  assert.deepEqual(nextRun(parseSchedule("*/15 9-10 * * *"), at(2026, 1, 1, 10, 50)), at(2026, 1, 2, 9, 0));
  assert.deepEqual(nextRun(parseSchedule("30 6 1 jan,jul *"), at(2026, 2, 1)), at(2026, 7, 1, 6, 30));
  assert.deepEqual(nextRun(parseSchedule("0 12 * * sun"), at(2026, 11, 17)), at(2026, 11, 22, 12));
  assert.deepEqual(nextRun(parseSchedule("@monthly"), at(2026, 11, 17)), at(2026, 12, 1, 0));
  // both day fields restricted: either matches (13th, or any Friday)
  const either = parseSchedule("0 0 13 * 5");
  assert.deepEqual(nextRun(either, at(2026, 11, 1)), at(2026, 11, 6)); // Friday the 6th comes first
  assert.throws(() => parseSchedule("0 25 * * *"), /out of range/);
  assert.throws(() => parseSchedule("sometimes"), /isn't a schedule/);
});

test("interval schedules count from when the routine was first seen", () => {
  const every = parseSchedule("every 30m");
  const anchor = at(2026, 11, 17, 9, 7);
  assert.equal(latestDue(every, at(2026, 11, 17, 9, 30), anchor, anchor), null);
  assert.deepEqual(latestDue(every, at(2026, 11, 17, 10, 20), anchor, anchor), at(2026, 11, 17, 10, 7));
  assert.deepEqual(nextRun(every, at(2026, 11, 17, 10, 20), anchor), at(2026, 11, 17, 10, 37));
  assert.throws(() => parseSchedule("every 0m"), /shortest/);
});

test("listing finds routines per brain and reports problems", () => {
  const { mojo, config, restore } = team();
  try {
    put(join(mojo, "routines", "bad.md"), "---\nname: Bad\nschedule: soon\ntype: launch\n---\n");
    newRoutine(config(), { brain: "mojo", name: "Brief" });
    const rs = listRoutines(config());
    assert.deepEqual(rs.map((r) => r.ref), ["mojo/bad", "mojo/brain-health", "mojo/brief"]); // README and _template are skipped; brain-health comes with every brain
    assert.match(rs[0].errors.join(" "), /type must be/);
    assert.match(rs[0].errors.join(" "), /schedule:/);
    assert.equal(rs[2].enabled, false);
    assert.equal(rs[2].type, "prompt");
    assert.throws(() => newRoutine(config(), { brain: "mojo", name: "Brief" }), /already exists/);
    newRoutine(config(), { brain: "mojo", name: "Night watch", agent: "Ops", profile: "/Users/joe/.claude_code_profiles/Mojo Layers" });
    const nw = listRoutines(config()).find((r) => r.slug === "night-watch");
    assert.equal(nw.agent, "Ops");
    assert.equal(nw.profile, "/Users/joe/.claude_code_profiles/Mojo Layers");
    assert.deepEqual(nw.errors, []);
  } finally { restore(); }
});

test("approval is per machine, tied to the content, and survives switching on and off", () => {
  const { mojo, env, config, restore } = team();
  try {
    saveRoutine(config(), { brain: "mojo", name: "Echo", schedule: "every 5m", type: "shell", body: "echo hi" });
    const before = describe(listRoutines(config()).find((r) => r.slug === "echo"), loadState(env), loadApprovals(env));
    assert.equal(before.approved, false);
    assert.equal(before.needsApproval, true);
    approveRoutine(config(), "mojo/echo", env);
    setEnabled(config(), "mojo/echo", true);
    const after = describe(listRoutines(config()).find((r) => r.slug === "echo"), loadState(env), loadApprovals(env));
    assert.equal(after.enabled, true);
    assert.equal(after.approved, true, "enabling doesn't need re-approval");
    writeFileSync(join(mojo, "routines", "echo.md"), readFileSync(join(mojo, "routines", "echo.md"), "utf8").replace("echo hi", "rm -rf /tmp/x"));
    const edited = describe(listRoutines(config()).find((r) => r.slug === "echo"), loadState(env), loadApprovals(env));
    assert.equal(edited.approved, false);
    assert.equal(edited.changedSinceApproval, true);
    // upkeep needs no approval
    saveRoutine(config(), { brain: "mojo", name: "Sync", schedule: "@daily", type: "upkeep", job: "sync" });
    assert.equal(describe(listRoutines(config()).find((r) => r.slug === "sync"), {}, {}).approved, true);
  } finally { restore(); }
});

test("tick: waits for the first slot, starts what's due once, skips unapproved and off, honours catch_up", () => {
  const { mojo, env, config, restore } = team();
  try {
    saveRoutine(config(), { brain: "mojo", name: "Brief", schedule: "0 8 * * *", type: "shell", body: "echo brief" });
    saveRoutine(config(), { brain: "mojo", name: "Unapproved", schedule: "* * * * *", type: "shell", body: "echo no" });
    saveRoutine(config(), { brain: "mojo", name: "Strict", schedule: "0 8 * * *", type: "upkeep", job: "digest" });
    put(join(mojo, "routines", "strict.md"), readFileSync(join(mojo, "routines", "strict.md"), "utf8").replace("enabled: false", "catch_up: false\nenabled: true"));
    approveRoutine(config(), "mojo/brief", env);
    setEnabled(config(), "mojo/brief", true);
    setEnabled(config(), "mojo/unapproved", true);
    const started = [];
    const start = (ref, when) => started.push([ref, when.toISOString()]);

    tick(config(), { now: at(2026, 11, 17, 7, 0), env, start });
    assert.deepEqual(started, [], "first sight only records firstSeen");
    tick(config(), { now: at(2026, 11, 17, 7, 59), env, start });
    assert.deepEqual(started, []);
    tick(config(), { now: at(2026, 11, 17, 8, 0, 20), env, start });
    assert.deepEqual(started.map((s) => s[0]), ["mojo/brief", "mojo/strict"]);

    // the run records the slot, so the next tick in the same minute doesn't start it again
    const st = JSON.parse(readFileSync(join(env.BRAINIUM_CONFIG, "..", "routines-state.json"), "utf8"));
    st["mojo/brief"].lastScheduled = at(2026, 11, 17, 8, 0).toISOString();
    st["mojo/strict"].lastScheduled = at(2026, 11, 17, 8, 0).toISOString();
    writeFileSync(join(env.BRAINIUM_CONFIG, "..", "routines-state.json"), JSON.stringify(st));
    started.length = 0;
    tick(config(), { now: at(2026, 11, 17, 8, 0, 50), env, start });
    assert.deepEqual(started, []);

    // asleep through tomorrow's 8am: catch_up runs it once; catch_up: false records a miss
    const actions = tick(config(), { now: at(2026, 11, 18, 14, 0), env, start });
    assert.deepEqual(started.map((s) => s[0]), ["mojo/brief"]);
    assert.equal(actions.find((a) => a.ref === "mojo/strict").action, "missed");
    assert.ok(!started.some((s) => s[0] === "mojo/unapproved"));
  } finally { restore(); }
});

test("upkeep routines log the first failure and the recovery, not every quiet run; log: always logs each run", async () => {
  const { mojo, env, config, restore } = team();
  try {
    put(join(mojo, "routines", "tidy.md"), "---\nname: Tidy\nschedule: every 30m\ntype: upkeep\njob: sync\n---\n");
    const results = [0, 0, 1, 1, 0, 0];
    const upkeep = async () => ({ exit: results.shift(), output: "done", timedOut: false });
    const logs = [];
    for (let i = 0; i < 6; i++) logs.push((await runRoutine(config(), "mojo/tidy", { env, executors: { upkeep } })).log);
    assert.deepEqual(logs.map(Boolean), [false, false, true, false, true, false]);
    const day = readFileSync(join(mojo, "shared", "sessions", logs[2].split("/").pop()), "utf8");
    assert.match(day, /\*\*Failed\*\*/);
    assert.match(day, /\*\*Recovered\*\*/);
    assert.equal(loadState(env)["mojo/tidy"].lastLog, logs[4]);

    put(join(mojo, "routines", "chatty.md"), "---\nname: Chatty\nschedule: every 30m\ntype: upkeep\njob: sync\nlog: always\n---\n");
    const ok = async () => ({ exit: 0, output: "", timedOut: false });
    assert.ok((await runRoutine(config(), "mojo/chatty", { env, executors: { upkeep: ok } })).log);
    put(join(mojo, "routines", "bad.md"), "---\nname: Bad\nschedule: every 30m\ntype: upkeep\njob: sync\nlog: sometimes\n---\n");
    assert.ok(listRoutines(config()).find((r) => r.ref === "mojo/bad").errors.some((e) => /log must be/.test(e)));
  } finally { restore(); }
});

test("run: shell output is redacted, logged to the agent and kept raw on this machine; a slot runs once", async () => {
  const { mojo, raw, env, config, restore } = team();
  try {
    saveRoutine(config(), { brain: "mojo", name: "Report", schedule: "@daily", type: "shell", agent: "Ops", body: `echo "brain=$BRAINIUM_BRAIN agent=$BRAINIUM_AGENT routine=$BRAINIUM_ROUTINE"; echo "key=sk-ant-$(echo api03-abcdefghijklmnopqrstuv)"` });
    await assert.rejects(runRoutine(config(), "mojo/report", { env }), /isn't approved/);
    approveRoutine(config(), "mojo/report", env);
    const r = await runRoutine(config(), "mojo/report", { env });
    assert.equal(r.status, "ok");
    assert.match(r.output, /brain=mojo agent=Ops routine=mojo\/report/);
    assert.doesNotMatch(r.output, /sk-ant-api03/);
    assert.match(r.log, /^mojo:agents\/ops\/sessions\//);
    const day = readFileSync(join(mojo, "agents", "ops", "sessions", r.log.split("/").pop()), "utf8");
    assert.match(day, /Routine: Report _\(routine, agent: Ops\)_/);
    assert.ok(r.rawLog.startsWith(raw) && existsSync(r.rawLog));
    assert.equal(loadState(env)["mojo/report"].lastStatus, "ok");

    // a scheduled run of a routine that's off is skipped; on, a slot runs once
    const slot = new Date();
    assert.equal((await runRoutine(config(), "mojo/report", { env, scheduledFor: slot.toISOString() })).status, "disabled");
    setEnabled(config(), "mojo/report", true);
    const first = await runRoutine(config(), "mojo/report", { env, scheduledFor: slot.toISOString() });
    assert.equal(first.status, "ok");
    const second = await runRoutine(config(), "mojo/report", { env, scheduledFor: slot.toISOString() });
    assert.equal(second.status, "already-done");

    // failures and time limits are reported
    saveRoutine(config(), { brain: "mojo", name: "Fails", schedule: "@daily", type: "shell", body: "echo nope; exit 3" });
    approveRoutine(config(), "mojo/fails", env);
    const f = await runRoutine(config(), "mojo/fails", { env });
    assert.equal(f.status, "failed");
    assert.equal(f.exit, 3);
    saveRoutine(config(), { brain: "mojo", name: "Slow", schedule: "@daily", type: "shell", timeout: "1s", body: "sleep 5" });
    approveRoutine(config(), "mojo/slow", env);
    const t = await runRoutine(config(), "mojo/slow", { env });
    assert.equal(t.status, "timed out");
  } finally { restore(); }
});

test("run: a prompt goes to Claude Code in the routine's profile, as its agent", async () => {
  const { root, env, config, restore } = team();
  try {
    const bin = join(root, "claude");
    writeFileSync(bin, `#!/bin/sh\necho "args=$1 cfg=\${CLAUDE_CONFIG_DIR:-none} agent=$BRAINIUM_AGENT extra=$3"\nprintf '%s' "$2" | head -c 80\n`);
    chmodSync(bin, 0o755);
    setConfig("routines.claudePath", bin, env);
    const profile = join(root, "profiles", "Work");
    saveRoutine(config(), { brain: "mojo", name: "Brief", schedule: "@daily", type: "prompt", agent: "Researcher", profile, args: "--permission-mode acceptEdits", body: "Summarise yesterday." });
    approveRoutine(config(), "mojo/brief", env);
    const r = await runRoutine(config(), "mojo/brief", { env });
    assert.equal(r.status, "ok");
    assert.match(r.output, new RegExp(`args=-p cfg=${profile} agent=Researcher extra=--permission-mode`));
    assert.match(r.output, /Brainium routine "Brief" · you are the agent "Researcher"/);
    // the default ~/.claude profile runs without CLAUDE_CONFIG_DIR
    saveRoutine(config(), { brain: "mojo", name: "Default", schedule: "@daily", type: "prompt", profile: "~/.claude", body: "Hi." });
    approveRoutine(config(), "mojo/default", env);
    assert.match((await runRoutine(config(), "mojo/default", { env: { ...env, CLAUDE_CONFIG_DIR: "/should/not/leak" } })).output, /cfg=none/);
  } finally { restore(); }
});

test("upkeep: digest lists what each agent and the shared area wrote; sync explains a missing remote", async () => {
  const { mojo, env, config, restore } = team();
  try {
    put(join(mojo, "shared", "learnings", "2026-11-17-a.md"), "# Shared thing\n");
    put(join(mojo, "agents", "Writer", "sessions", "2026-11-17.md"), "# Writer day\n");
    const text = digest(mojo, new Date(Date.now() - 60_000));
    assert.match(text, /\*\*shared\*\*\n- Shared thing/);
    assert.match(text, /\*\*Writer\*\*\n- Writer day/);
    saveRoutine(config(), { brain: "mojo", name: "Sync", schedule: "@daily", type: "upkeep", job: "sync" });
    const r = await runRoutine(config(), "mojo/sync", { env });
    assert.equal(r.status, "ok");
    assert.match(r.output, /No remote/);
    assert.equal(r.log, null); // a quiet upkeep success isn't written to the session log
  } finally { restore(); }
});

test("launchd job ticks every minute with a PATH that finds node and the agent CLIs", () => {
  const plist = launchdPlist({ node: "/opt/node/bin/node", cli: "/Users/joe/brainium/bin/brainium.mjs", env: { PATH: "/usr/bin", HOME: "/Users/joe", BRAINIUM_CONFIG: "/tmp/c & d.json" }, logDir: "/Users/joe/.brainium-raw/routines" });
  assert.match(plist, /<string>\/opt\/node\/bin\/node<\/string>\s*<string>\/Users\/joe\/brainium\/bin\/brainium\.mjs<\/string>\s*<string>routines<\/string>\s*<string>tick<\/string>/);
  assert.match(plist, /<key>StartInterval<\/key><integer>60<\/integer>/);
  assert.match(plist, /<key>PATH<\/key><string>[^<]*\/opt\/homebrew\/bin/);
  assert.match(plist, /c &amp; d\.json/);
});
