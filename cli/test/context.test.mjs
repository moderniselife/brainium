import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, put, useEnv } from "./helpers.mjs";
import { initBrain, initPersonal } from "../lib/personal.mjs";
import { brainRoots, logEntry, pickBrain, saveAgentCard } from "../lib/brain.mjs";
import { addBrain, loadConfig, setConfig } from "../lib/config.mjs";
import { folderRef, getRecord, lintBrain, parseFrontmatter, parseRef, saveRecord, writeHealth } from "../lib/records.mjs";
import { approveRoutine, changedFiles, globToRegex, listRoutines, loadState, runRoutine, saveRoutine, setEnabled, stagePreface, tick } from "../lib/routines.mjs";
import { callTool } from "../lib/mcp.mjs";

function team() {
  const s = sandbox();
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const mojo = join(s.root, "mojo");
  initBrain(mojo);
  addBrain("mojo", mojo, s.env);
  setConfig("personalBrain", s.personal, s.env);
  setConfig("rawStore", s.raw, s.env);
  const config = () => loadConfig(s.env);
  return { ...s, mojo, restore, config };
}

test("a new brain comes with record folders, factory templates and a weekly health check", () => {
  const { mojo, restore } = team();
  try {
    for (const f of ["shared/projects/_template.md", "shared/people/README.md", "shared/meetings/_template.md", "shared/customers/_template.md", "shared/documents/_template.md", "shared/teams/README.md", "agents/_template/prompts/_template.md", "agents/_template/evals/_template.md", "routines/brain-health.md", "routines/organize.md", "routines/librarian.md"]) {
      assert.ok(existsSync(join(mojo, f)), f);
    }
  } finally { restore(); }
});

test("records: saved once, fields merge, links resolve one hop and backlinks are found", () => {
  const { mojo, config, restore } = team();
  try {
    const roots = brainRoots(config(), null);
    const p = saveRecord(roots, config(), { type: "project", title: "Launch", fields: { status: "active" }, links: ["person/sam", "customer/acme"], brain: "mojo", agent: "planner" });
    assert.equal(p.path, "mojo:shared/projects/launch.md");
    assert.deepEqual(p.missing, ["owner"]);
    saveRecord(roots, config(), { type: "person", id: "sam", title: "Sam", fields: { role: "PM" }, brain: "mojo", agent: "planner" });
    const again = saveRecord(roots, config(), { type: "project", id: "launch", fields: { owner: "sam" }, brain: "mojo", agent: "ops" });
    assert.equal(again.created, false);
    assert.deepEqual(again.missing, []);
    const text = readFileSync(join(mojo, "shared/projects/launch.md"), "utf8");
    assert.match(text, /status: active/);
    assert.match(text, /owner: sam/);
    assert.match(text, /agent: ops/);
    assert.match(text, /created_by: planner/);
    put(join(mojo, "shared/meetings/kickoff.md"), "---\ntype: meeting\ndate: 2026-01-02\nagent: ops\n---\n\nAbout [[project/launch]].\n");
    const r = getRecord(brainRoots(config(), null), "project/launch", { brain: "mojo" });
    assert.deepEqual(r.links.map((l) => [l.ref, !!l.missing]), [["people/sam", false], ["customers/acme", true]]);
    assert.equal(r.links[0].title, "Sam");
    assert.deepEqual(r.backlinks, ["mojo:shared/meetings/kickoff.md"]);
    assert.deepEqual(parseRef("[[mojo:projects/launch]]"), { brain: "mojo", type: "project", id: "launch" });
    assert.throws(() => parseRef("widget/x"), /unknown record type/);
    assert.throws(() => saveRecord(roots, config(), { type: "widget", title: "x", brain: "mojo" }), /type must be/);
  } finally { restore(); }
});

test("record links are written in folder form as Obsidian wikilinks, and every form is read back", () => {
  const { mojo, config, restore } = team();
  try {
    const roots = brainRoots(config(), null);
    saveRecord(roots, config(), { type: "person", id: "sam", title: "Sam", fields: { role: "PM" }, brain: "mojo", agent: "ops" });
    saveRecord(roots, config(), { type: "project", id: "launch", title: "Launch", fields: { status: "active", owner: "sam" }, links: ["person/sam", "[[customers/acme]]", "other:document/spec"], brain: "mojo", agent: "ops" });
    const text = readFileSync(join(mojo, "shared/projects/launch.md"), "utf8");
    assert.match(text, /links:\n {2}- "\[\[people\/sam\]\]"\n {2}- "\[\[customers\/acme\]\]"\n {2}- "\[\[other:documents\/spec\]\]"\n/);
    assert.deepEqual(parseFrontmatter(text).meta.links, ["[[people/sam]]", "[[customers/acme]]", "[[other:documents/spec]]"]);
    // Saving again with the old singular form doesn't duplicate the link.
    saveRecord(roots, config(), { type: "project", id: "launch", links: ["person/sam"], brain: "mojo", agent: "ops" });
    assert.deepEqual(parseFrontmatter(readFileSync(join(mojo, "shared/projects/launch.md"), "utf8")).meta.links.length, 3);
    // Old inline-list frontmatter still parses.
    assert.deepEqual(parseFrontmatter("---\nlinks: [person/sam, project/x]\nreview_by:\nagent: ops\n---\n").meta, { links: ["person/sam", "project/x"], review_by: "", agent: "ops" });
    // Obsidian headings and aliases, and both type and folder spellings, count as links and backlinks.
    put(join(mojo, "shared/meetings/a.md"), "---\ntype: meeting\ndate: 2026-01-02\nagent: ops\n---\n\nWith [[people/sam|Sam]] about [[projects/launch#now]].\n");
    put(join(mojo, "shared/meetings/b.md"), "---\ntype: meeting\ndate: 2026-01-03\nagent: ops\n---\n\nWith [[person/sam]].\n");
    const sam = getRecord(brainRoots(config(), null), "people/sam", { brain: "mojo" });
    assert.equal(sam.ref, "mojo:people/sam");
    assert.deepEqual(sam.backlinks.sort(), ["mojo:shared/meetings/a.md", "mojo:shared/meetings/b.md", "mojo:shared/projects/launch.md"]);
    assert.equal(folderRef("[[person/sam|Sam]]"), "people/sam");
    assert.equal(folderRef("team-x:customer/acme"), "team-x:customers/acme");
    assert.deepEqual(parseRef("[[people/sam#role|Sam]]"), { brain: null, type: "person", id: "sam" });
    const broken = lintBrain(brainRoots(config(), null), "mojo").issues.filter((i) => i.kind === "broken-link").map((i) => i.detail);
    assert.ok(broken.some((d) => d.includes("customers/acme")));
    assert.ok(!broken.some((d) => d.includes("sam") || d.includes("launch")));
  } finally { restore(); }
});

test("lint resolves non-record links the way Obsidian does, including from a team brain into its company brain", () => {
  const { mojo, config, restore } = team();
  try {
    const qa = join(mojo, "teams/qa");
    initBrain(qa);
    addBrain("mojo-qa", qa, process.env);
    put(join(qa, "agents/tess/card.md"), "---\nagent: tess\n---\n# Tess\n");
    put(join(mojo, "shared/people/sam.md"), "---\ntype: person\nrole: PM\nagent: ops\n---\n# Sam\n");
    put(join(qa, "shared/learnings/2026-01-01-a.md"), "---\nagent: tess\nlinks: [\"[[tess/card]]\", \"[[people/sam]]\"]\n---\n# a\n\nSee [[tess/card|Tess]] and [[nobody/card]] and [[people/ghost]].\n");
    const issues = lintBrain(brainRoots(config(), null), "mojo-qa").issues.filter((i) => i.kind === "broken-link").map((i) => i.detail);
    assert.deepEqual(issues.sort(), ["[[nobody/card]] matches no file", "[[people/ghost]] doesn't exist"]);
    const company = lintBrain(brainRoots(config(), null), "mojo").issues.filter((i) => i.kind === "broken-link");
    assert.deepEqual(company, []);
  } finally { restore(); }
});

test("lint finds unsigned notes, missing fields, broken links, stale and misfiled records, and incomplete factories", () => {
  const { mojo, config, restore } = team();
  try {
    put(join(mojo, "shared/learnings/2026-01-01-x.md"), "# x\n\nNobody signed this.");
    put(join(mojo, "shared/learnings/2026-01-02-y.md"), "---\nagent: ops\n---\n# y\n");
    put(join(mojo, "shared/projects/old.md"), "---\ntype: project\nstatus: active\nowner: sam\nupdated: 2020-01-01\nagent: ops\n---\n\nSee [[document/missing]].\n");
    put(join(mojo, "shared/documents/spec.md"), "---\ntype: document\nstatus: final\nreview_by: 2020-06-01\nagent: ops\n---\n");
    put(join(mojo, "shared/customers/wrong.md"), "---\ntype: project\nstatus: active\nagent: ops\n---\n");
    put(join(mojo, "shared/meetings/m.md"), "---\ntype: meeting\nagent: ops\n---\n");
    const roots = brainRoots(config(), null);
    saveAgentCard(roots, config(), { name: "Helper", kind: "factory", maintainers: ["sam"], brain: "mojo" });
    const kinds = (k) => lintBrain(brainRoots(config(), null), "mojo", { now: new Date("2026-02-01") }).issues.filter((i) => i.kind === k).map((i) => `${i.path}: ${i.detail}`);
    assert.deepEqual(kinds("unsigned"), ["shared/learnings/2026-01-01-x.md: no agent: (or persona:/from:/author:) on it"]);
    assert.ok(kinds("missing-field").includes("shared/meetings/m.md: meeting needs date"));
    assert.ok(kinds("broken-link").some((x) => x.includes("[[document/missing]]")));
    put(join(mojo, "shared/learnings/2026-01-03-z.md"), "---\nagent: ops\n---\n# z\n\nWrite `[[type/id]]` or `[[project/nope]]`.\n\n```\n[[person/nobody]]\n```\n");
    assert.ok(!kinds("broken-link").some((x) => x.includes("2026-01-03-z")), "links inside code are examples, not links");
    assert.ok(!lintBrain(brainRoots(config(), null), "mojo").issues.some((i) => i.path.endsWith("README.md")), "the scaffold's own READMEs lint clean");
    assert.ok(kinds("stale").some((x) => x.startsWith("shared/projects/old.md")));
    assert.ok(kinds("stale").some((x) => x.startsWith("shared/documents/spec.md") && x.includes("review_by")));
    assert.ok(kinds("misfiled").some((x) => x.startsWith("shared/customers/wrong.md")));
    assert.equal(kinds("factory").length, 2, "no production prompt, no evals");
    put(join(mojo, "agents/helper/prompts/v1.md"), "---\nversion: 1\nstatus: production\n---\n");
    put(join(mojo, "agents/helper/evals/basic.md"), "---\ncase: basic\n---\n");
    assert.equal(kinds("factory").length, 0);
    const h = writeHealth(config(), "mojo", { now: new Date("2026-02-01") });
    assert.match(readFileSync(h.path, "utf8"), /# Brain health: mojo/);
  } finally { restore(); }
});

test("a repo's .brainium.json sends auto writes to the brain it names", () => {
  const { root, mojo, config, restore } = team();
  try {
    const repo = join(root, "repo");
    put(join(repo, "docs/brainium/README.md"), "# project brain");
    put(join(repo, "src/app.js"), "");
    assert.equal(pickBrain(brainRoots(config(), join(repo, "src")), "auto"), "project");
    writeFileSync(join(repo, ".brainium.json"), JSON.stringify({ brain: "mojo" }));
    const roots = brainRoots(config(), join(repo, "src"));
    assert.equal(pickBrain(roots, "auto"), "mojo");
    assert.ok(roots.project, "the project brain is still there by name");
    assert.ok(!Object.keys(roots).includes("auto"));
    const r = logEntry(roots, config(), { kind: "learning", title: "Goes to the team", body: "x", agent: "ops" });
    assert.match(r.path, /^mojo:agents\/ops\/learnings\//);
    assert.match(readFileSync(join(mojo, r.path.replace("mojo:", "")), "utf8"), /_agent: ops_/, "notes name their agent even in its own folder");
    writeFileSync(join(repo, ".brainium.json"), JSON.stringify({ brain: "not-registered" }));
    assert.equal(pickBrain(brainRoots(config(), join(repo, "src")), "auto"), "project");
  } finally { restore(); }
});

test("routines: globs, file-change triggers with debounce, stage prefaces, and new routines start in shadow", () => {
  const { mojo, env, config, restore } = team();
  try {
    assert.ok(globToRegex("shared/messages/*/inbox/**").test("shared/messages/ops/inbox/a.md"));
    assert.ok(!globToRegex("*.md").test("a/b.md"));
    const saved = saveRoutine(config(), { brain: "mojo", name: "Inbox", on: "shared/messages/*/inbox/**", type: "shell", body: "echo $BRAINIUM_STAGE $BRAINIUM_CHANGED" });
    const text = readFileSync(saved.file, "utf8");
    assert.match(text, /^on: "shared\/messages\/\*\/inbox\/\*\*"$/m);
    assert.match(text, /^stage: shadow$/m);
    assert.doesNotMatch(text, /^schedule:/m);
    approveRoutine(config(), "mojo/inbox", env);
    setEnabled(config(), "mojo/inbox", true);
    const started = [];
    const start = (ref) => started.push(ref);
    const t0 = new Date("2026-03-01T10:00:00Z");
    tick(config(), { now: t0, env, start });
    assert.deepEqual(started, [], "never fires the moment it appears");
    const f = join(mojo, "shared/messages/ops/inbox/hello.md");
    put(f, "hi");
    const t1 = new Date(+t0 + 60_000);
    utimesSync(f, t1, t1);
    tick(config(), { now: new Date(+t1 + 10_000), env, start });
    assert.deepEqual(started, [], "waits for the debounce window");
    tick(config(), { now: new Date(+t1 + 120_000), env, start });
    assert.deepEqual(started, ["mojo/inbox"]);
    assert.deepEqual(loadState(env)["mojo/inbox"].pendingChanges, ["shared/messages/ops/inbox/hello.md"]);
    tick(config(), { now: new Date(+t1 + 240_000), env, start });
    assert.equal(started.length, 1, "the same change doesn't fire twice");
    assert.deepEqual(changedFiles(mojo, ["shared/messages/**"], +t1 + 1).files, []);
    const r = listRoutines(config()).find((x) => x.slug === "inbox");
    assert.match(stagePreface(r, ["a.md"]), /SHADOW RUN/);
    assert.match(stagePreface({ ...r, stage: "limited", limit: 2 }, []), /at most 2 item/);
    assert.equal(stagePreface({ ...r, stage: "full" }, []), "");
    assert.throws(() => saveRoutine(config(), { brain: "mojo", name: "Bad", on: "x/**", stage: "yolo", type: "shell", body: "ls" }), /stage must be/);
  } finally { restore(); }
});

test("a triggered shell routine sees its stage and the changed files", async () => {
  const { mojo, env, config, restore } = team();
  try {
    saveRoutine(config(), { brain: "mojo", name: "Echo", on: "shared/notes/**", stage: "limited", limit: 2, type: "shell", body: "echo stage=$BRAINIUM_STAGE limit=$BRAINIUM_LIMIT changed=$BRAINIUM_CHANGED" });
    approveRoutine(config(), "mojo/echo", env);
    setEnabled(config(), "mojo/echo", true);
    const t0 = new Date("2026-03-01T10:00:00Z");
    tick(config(), { now: t0, env, start: () => {} });
    const f = join(mojo, "shared/notes/x.md");
    put(f, "x");
    const t1 = new Date(+t0 + 60_000);
    utimesSync(f, t1, t1);
    tick(config(), { now: new Date(+t1 + 120_000), env, start: () => {} });
    const out = await runRoutine(config(), "mojo/echo", { env });
    assert.equal(out.status, "ok");
    assert.match(out.output, /stage=limited limit=2 changed=shared\/notes\/x\.md/);
    assert.equal(loadState(env)["mojo/echo"].pendingChanges, null, "changes are cleared once handed over");
    assert.match(readFileSync(join(mojo, out.log.replace("mojo:", "")), "utf8"), /stage limited \(limit 2\), triggered by file changes/);
  } finally { restore(); }
});

test("factory cards keep kind, team and maintainers; team brains inside a repo don't get their own git repo", () => {
  const { mojo, config, restore } = team();
  try {
    const roots = brainRoots(config(), null);
    saveAgentCard(roots, config(), { name: "Helper", kind: "factory", team: "support", maintainers: ["sam", "kim"], brain: "mojo" });
    const card = readFileSync(join(mojo, "agents/helper/card.md"), "utf8");
    assert.match(card, /^---\nkind: factory\nteam: support\nmaintainers: \[sam, kim\]\n---\n/);
    saveAgentCard(brainRoots(config(), null), config(), { name: "Helper", tldr: "Answers questions", brain: "mojo" });
    assert.match(readFileSync(join(mojo, "agents/helper/card.md"), "utf8"), /kind: factory/, "kept on update");
    assert.throws(() => saveAgentCard(roots, config(), { name: "X", kind: "robot", brain: "mojo" }), /kind must be/);
    const inner = join(mojo, "teams", "support");
    initBrain(inner);
    assert.ok(!existsSync(join(inner, ".git")));
    assert.ok(existsSync(join(inner, "shared/projects/_template.md")));
  } finally { restore(); }
});

test("MCP: record_save, record_get and brain_lint", async () => {
  const { mojo, env, restore } = team();
  try {
    const ctx = { cwd: mojo, env: { ...env, BRAINIUM_BRAIN: "mojo", BRAINIUM_AGENT: "ops" } };
    assert.match(await callTool("record_save", { type: "customer", title: "Acme", fields: { status: "active" } }, ctx), /Created mojo:shared\/customers\/acme\.md/);
    const got = JSON.parse(await callTool("record_get", { ref: "customer/acme" }, ctx));
    assert.equal(got.meta.agent, "ops");
    const report = await callTool("brain_lint", { write: true }, ctx);
    assert.match(report, /# Brain health: mojo/);
    assert.ok(existsSync(join(mojo, "shared/health.md")));
  } finally { restore(); }
});
