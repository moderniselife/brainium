import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sandbox, put, useEnv } from "./helpers.mjs";
import { initBrain, initPersonal } from "../lib/personal.mjs";
import { brainRoots, getAgentCard, listAgents, listFolder, logEntry, pickBrain, saveAgentCard, search, shareEntry } from "../lib/brain.mjs";
import { addBrain, loadConfig, removeBrain, setConfig } from "../lib/config.mjs";
import { callTool } from "../lib/mcp.mjs";
import { capture, resolvePending } from "../lib/capture.mjs";
import { wire } from "../lib/wire.mjs";

function team() {
  const s = sandbox();
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const mojo = join(s.root, "mojo");
  initBrain(mojo);
  addBrain("mojo-layers", mojo, s.env);
  setConfig("personalBrain", s.personal, s.env);
  setConfig("rawStore", s.raw, s.env);
  const config = loadConfig(s.env);
  return { ...s, mojo, restore, config };
}

test("init-brain scaffolds shared/, agents/ and routines/ as a git repo, and never overwrites", () => {
  const { mojo, restore } = team();
  try {
    for (const f of ["README.md", "shared/README.md", "shared/sessions/README.md", "shared/learnings/_template.md", "agents/README.md", "agents/_template/card.md", "routines/README.md", "routines/_template.md"]) {
      assert.ok(existsSync(join(mojo, f)), f);
    }
    assert.match(execFileSync("git", ["log", "--oneline"], { cwd: mojo, encoding: "utf8" }), /create brain/);
    put(join(mojo, "shared", "memories", "keep.md"), "# mine");
    assert.equal(initBrain(mojo).existed, true);
    assert.equal(readFileSync(join(mojo, "shared", "memories", "keep.md"), "utf8"), "# mine");
  } finally { restore(); }
});

test("brains are registered by name; the default can be set; removing one leaves its folder", () => {
  const { mojo, env, config, restore } = team();
  try {
    const roots = brainRoots(config, "/nowhere");
    assert.deepEqual(Object.keys(roots).sort(), ["mojo-layers", "personal"]);
    assert.equal(pickBrain(roots, "auto", "mojo-layers"), "mojo-layers");
    assert.equal(pickBrain(roots, "auto", "gone"), "personal");
    assert.throws(() => pickBrain(roots, "nope"), /No brain called "nope"/);
    assert.throws(() => setConfig("defaultBrain", "nope", env), /no brain called/);
    assert.equal(setConfig("defaultBrain", "mojo-layers", env).defaultBrain, "mojo-layers");
    removeBrain("mojo-layers", env);
    const after = loadConfig(env);
    assert.equal(after.brains["mojo-layers"], undefined);
    assert.equal(after.defaultBrain, "personal");
    assert.ok(existsSync(mojo));
  } finally { restore(); }
});

test("agents write to their own folder by default and to shared/ when asked; project brains name the agent", () => {
  const { mojo, root, config, restore } = team();
  try {
    const roots = brainRoots(config, "/nowhere");
    const now = new Date(2026, 10, 17, 9, 0);
    const own = logEntry(roots, config, { kind: "learning", title: "Vendor API is rate limited", body: "5 rps.", brain: "mojo-layers", agent: "Researcher", now });
    assert.equal(own.path, "mojo-layers:agents/researcher/learnings/2026-11-17-vendor-api-is-rate-limited.md");
    assert.equal(own.area, "agent:researcher");
    const sh = logEntry(roots, config, { kind: "decision", title: "Use Postgres", body: "All agents.", brain: "mojo-layers", agent: "Researcher", shared: true, now });
    assert.equal(sh.path, "mojo-layers:shared/decisions/2026-11-17-use-postgres.md");
    assert.match(readFileSync(join(mojo, "shared", "decisions", "2026-11-17-use-postgres.md"), "utf8"), /_agent: Researcher_/);
    const noAgent = logEntry(roots, config, { kind: "session", title: "Planning", body: "x", brain: "mojo-layers", now });
    assert.equal(noAgent.path, "mojo-layers:shared/sessions/2026-11-17.md");
    // indexed in shared/ (it has READMEs), committed with the agent in the message
    logEntry(roots, config, { kind: "learning", title: "Cache the feed", body: "x", brain: "mojo-layers", shared: true, now });
    assert.match(readFileSync(join(mojo, "shared", "learnings", "README.md"), "utf8"), /cache-the-feed/);
    assert.match(execFileSync("git", ["log", "--oneline"], { cwd: mojo, encoding: "utf8" }), /learning \(researcher\)/);

    // a project brain has no agent folders: the agent is credited in the entry
    const repo = join(root, "repo");
    mkdirSync(join(repo, "docs", "brainium", "sessions"), { recursive: true });
    const p = logEntry(brainRoots(config, repo), config, { kind: "session", title: "Fix bug", body: "y", agent: "Researcher", now });
    assert.equal(p.path, "project:sessions/2026-11-17.md");
    assert.match(readFileSync(join(repo, "docs", "brainium", "sessions", "2026-11-17.md"), "utf8"), /Fix bug _\(agent: Researcher\)_/);
  } finally { restore(); }
});

test("hand-made agent folders are found by slug; search keeps other agents' notes out unless everyone", () => {
  const { mojo, config, restore } = team();
  try {
    // The user's style: agents/<Name>/ with their own supporting docs.
    put(join(mojo, "agents", "Mojo Researcher", "README.md"), "# Mojo Researcher\n\n## TLDR\n\nFinds sources.\n");
    put(join(mojo, "agents", "Mojo Researcher", "style-guide.md"), "# Style\n\nCite primary sources for pricing claims.\n");
    put(join(mojo, "agents", "Writer", "learnings", "2026-11-01-tone.md"), "# Tone\n\n## TLDR\n\nPricing posts stay friendly.\n");
    put(join(mojo, "shared", "learnings", "2026-11-02-pricing.md"), "# Pricing\n\n## TLDR\n\nPricing page moved.\n");
    const roots = brainRoots(config, "/nowhere");

    const agents = listAgents(roots, { brain: "mojo-layers" });
    assert.deepEqual(agents.map((a) => [a.name, a.slug, a.tldr]), [["Mojo Researcher", "mojo-researcher", "Finds sources."], ["Writer", "writer", ""]]);

    // logging as "mojo researcher" lands in the existing folder, not a new one
    const r = logEntry(roots, config, { kind: "memory", title: "Joe wants links", body: "Always.", brain: "mojo-layers", agent: "mojo researcher" });
    assert.match(r.path, /^mojo-layers:agents\/Mojo Researcher\/memories\//);

    const asResearcher = search(roots, "pricing", { brain: "mojo-layers", agent: "Mojo Researcher" }).map((h) => h.path);
    assert.ok(asResearcher.includes("mojo-layers:agents/Mojo Researcher/style-guide.md"));
    assert.ok(asResearcher.includes("mojo-layers:shared/learnings/2026-11-02-pricing.md"));
    assert.ok(!asResearcher.some((p) => p.includes("agents/Writer/learnings")), "other agents' notes are skipped");
    assert.equal(asResearcher[0], "mojo-layers:agents/Mojo Researcher/style-guide.md", "own notes rank first");
    const all = search(roots, "pricing", { brain: "mojo-layers", agent: "Mojo Researcher", everyone: true }).map((h) => h.path);
    assert.ok(all.includes("mojo-layers:agents/Writer/learnings/2026-11-01-tone.md"));
    // no agent: everything
    assert.equal(search(roots, "pricing", { brain: "mojo-layers" }).length, 3);
    // "all" covers default + personal; "*" every brain
    put(join(config.personalBrain, "memories", "x.md"), "# pricing pref");
    assert.ok(search(roots, "pricing", { brain: "all", defaultBrain: "mojo-layers" }).some((h) => h.path.startsWith("personal:")));

    // listing an agent's own folder vs shared
    assert.equal(listFolder(roots, "learnings", { brain: "mojo-layers", agent: "Writer" }).entries[0].title, "Tone");
    assert.equal(listFolder(roots, "learnings", { brain: "mojo-layers", agent: "Writer", shared: true }).entries[0].title, "Pricing");
    assert.deepEqual(listFolder(roots, "agents", { brain: "mojo-layers" }).entries.map((e) => e.title), ["Mojo Researcher", "Writer"]);
  } finally { restore(); }
});

test("brain_share moves an agent's note into shared/ and commits it", () => {
  const { mojo, config, restore } = team();
  try {
    const roots = brainRoots(config, "/nowhere");
    const r = logEntry(roots, config, { kind: "learning", title: "Retry webhooks", body: "Twice.", brain: "mojo-layers", agent: "Ops", now: new Date(2026, 10, 17) });
    const shared = shareEntry(roots, config, r.path);
    assert.equal(shared.path, "mojo-layers:shared/learnings/2026-11-17-retry-webhooks.md");
    assert.ok(!existsSync(join(mojo, "agents", "ops", "learnings", "2026-11-17-retry-webhooks.md")));
    assert.match(readFileSync(join(mojo, "shared", "learnings", "2026-11-17-retry-webhooks.md"), "utf8"), /Shared by ops/);
    assert.match(execFileSync("git", ["status", "--porcelain"], { cwd: mojo, encoding: "utf8" }), /^$/);
    // a clash gets a suffix
    const again = logEntry(roots, config, { kind: "learning", title: "Retry webhooks", body: "Three times.", brain: "mojo-layers", agent: "Ops", now: new Date(2026, 10, 17) });
    assert.equal(shareEntry(roots, config, again.path).path, "mojo-layers:shared/learnings/2026-11-17-retry-webhooks-2.md");
    assert.throws(() => shareEntry(roots, config, "mojo-layers:shared/learnings/2026-11-17-retry-webhooks.md"), /only an agent's own notes/);
  } finally { restore(); }
});

test("agent cards: a folder in a team brain, a single file in a classic brain, found from anywhere", () => {
  const { mojo, personal, config, restore } = team();
  try {
    const roots = brainRoots(config, "/nowhere");
    const r = saveAgentCard(roots, config, { name: "Writer", instructions: "Write posts.", tldr: "Blog posts", brain: "mojo-layers" });
    assert.equal(r.path, "mojo-layers:agents/writer/card.md");
    assert.match(readFileSync(join(mojo, "agents", "README.md"), "utf8"), /\[Writer\]\(\.\/writer\/card\.md\)/);
    // hand-made folder: the README stays, card.md goes beside it
    put(join(mojo, "agents", "Mojo Researcher", "README.md"), "# Notes I wrote\n");
    const c = saveAgentCard(roots, config, { name: "mojo researcher", instructions: "Research.", brain: "mojo-layers" });
    assert.equal(c.path, "mojo-layers:agents/Mojo Researcher/card.md");
    assert.equal(readFileSync(join(mojo, "agents", "Mojo Researcher", "README.md"), "utf8"), "# Notes I wrote\n");
    // classic personal brain keeps agents/<slug>.md
    assert.equal(saveAgentCard(roots, config, { name: "Triage", instructions: "x" }).path, "personal:agents/triage.md");
    assert.ok(existsSync(join(personal, "agents", "triage.md")));
    assert.match(getAgentCard(roots, "writer").text, /Write posts\./);
    assert.equal(getAgentCard(roots, "Triage").brain, "personal");
    assert.throws(() => getAgentCard(roots, "nobody"), /no agent card/);
  } finally { restore(); }
});

test("MCP: $BRAINIUM_BRAIN picks the profile's brain, $BRAINIUM_AGENT names the agent", async () => {
  const { env, mojo, restore } = team();
  try {
    const ctx = { cwd: "/nowhere", env: { ...env, BRAINIUM_BRAIN: "mojo-layers", BRAINIUM_AGENT: "Ops" } };
    const logged = await callTool("brain_log", { kind: "session", title: "Nightly", body: "ran" }, ctx);
    assert.match(logged, /mojo-layers:agents\/ops\/sessions\//);
    const shared = await callTool("brain_log", { kind: "learning", title: "Team fact", body: "x", shared: true }, ctx);
    assert.match(shared, /mojo-layers:shared\/learnings\//);
    const info = JSON.parse(await callTool("brain_info", {}, ctx));
    assert.equal(info.defaultBrain, "mojo-layers");
    assert.deepEqual(info.brains["mojo-layers"].agents, ["ops"]);
    const card = await callTool("agent_card_save", { name: "Ops", instructions: "Keep things running." }, ctx);
    assert.match(card, /mojo-layers:agents\/ops\/card\.md/);
    const agents = JSON.parse(await callTool("agent_list", {}, ctx));
    assert.equal(agents.find((a) => a.brain === "mojo-layers").name, "Ops");
    const saved = await callTool("routine_save", { name: "Nightly sync", schedule: "@daily", type: "upkeep", job: "sync" }, ctx);
    assert.match(saved, /mojo-layers\/nightly-sync/);
    assert.match(readFileSync(join(mojo, "routines", "nightly-sync.md"), "utf8"), /enabled: false/);
    const routines = JSON.parse(await callTool("routine_list", {}, ctx));
    assert.equal(routines[0].ref, "mojo-layers/nightly-sync");
    await assert.rejects(callTool("routine_save", { name: "Bad", schedule: "whenever", type: "shell", body: "ls" }, ctx), /isn't a schedule/);
  } finally { restore(); }
});

test("captures file into the profile's brain when there's no project brain", () => {
  const { root, mojo, config, restore } = team();
  try {
    const transcript = join(root, "t.jsonl");
    put(transcript, JSON.stringify({ type: "user", message: { role: "user", content: "plan the launch" }, cwd: "/nowhere" }) + "\n");
    const rec = capture({ transcript_path: transcript, session_id: "abc", cwd: "/nowhere" }, { ...config, capture: true }, { spawnDistill: false, brain: "mojo-layers" });
    assert.equal(rec.brain, "mojo-layers");
    const filed = resolvePending(config, rec.id, { body: "Planned it.", agent: "Planner" });
    assert.match(filed.path, /^mojo-layers:agents\/planner\/sessions\//);
    assert.ok(existsSync(join(mojo, "agents", "planner", "sessions")));
  } finally { restore(); }
});

test("wire --brain sets BRAINIUM_BRAIN on the MCP server and --brain on the capture hook", () => {
  const { root, personal, mojo, restore } = team();
  try {
    const profile = join(root, "cc");
    wire({ app: "claude-code", profileDir: profile, capture: true, personalBrain: personal, brain: "mojo-layers", brainPath: mojo, node: "/usr/bin/node", cli: "/opt/brainium/bin/brainium.mjs" });
    const state = JSON.parse(readFileSync(join(profile, ".claude.json"), "utf8"));
    assert.deepEqual(state.mcpServers.brainium.env, { BRAINIUM_BRAIN: "mojo-layers" });
    const settings = JSON.parse(readFileSync(join(profile, "settings.json"), "utf8"));
    assert.match(settings.hooks.SessionEnd[0].hooks[0].command, /capture --brain mojo-layers$/);
    assert.doesNotMatch(settings.hooks.SessionStart[0].hooks[0].command, /--brain/);
    assert.match(readFileSync(join(profile, "CLAUDE.md"), "utf8"), /this profile's brain: `mojo-layers \(/);
    // re-wiring to personal clears it; unwire still recognises the hook
    wire({ app: "claude-code", profileDir: profile, capture: true, personalBrain: personal, node: "/usr/bin/node", cli: "/opt/brainium/bin/brainium.mjs" });
    assert.deepEqual(JSON.parse(readFileSync(join(profile, ".claude.json"), "utf8")).mcpServers.brainium.env, {});
    wire({ app: "claude-code", profileDir: profile, personalBrain: personal, node: "/usr/bin/node", cli: "/opt/brainium/bin/brainium.mjs" }, false);
    assert.equal(existsSync(join(profile, "settings.json")) && JSON.parse(readFileSync(join(profile, "settings.json"), "utf8")).hooks, undefined);
  } finally { restore(); }
});

test("a brain registered inside another brain is left out of the outer brain's search", () => {
  const { mojo, config, env, restore } = team();
  try {
    const qa = join(mojo, "teams", "qa");
    initBrain(qa);
    addBrain("mojo-qa", qa, env);
    put(join(qa, "agents", "ali", "learnings", "flaky.md"), "# Flaky login\n\nretry the zebra step");
    put(join(mojo, "shared", "memories", "co.md"), "# Company\n\nzebra policy for everyone");
    const roots = brainRoots(loadConfig(env), "/nowhere");
    const outer = search(roots, "zebra", { brain: "mojo-layers" }).map((h) => h.path);
    assert.deepEqual(outer, ["mojo-layers:shared/memories/co.md"]);
    const inner = search(roots, "zebra", { brain: "mojo-qa" }).map((h) => h.path);
    assert.deepEqual(inner, ["mojo-qa:agents/ali/learnings/flaky.md"]);
    assert.equal(search(roots, "zebra", { brain: "*" }).length, 2);
  } finally { restore(); }
});
