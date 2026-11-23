import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sandbox, put, useEnv } from "./helpers.mjs";
import { initBrain, initPersonal } from "../lib/personal.mjs";
import { brainRoots } from "../lib/brain.mjs";
import { addBrain, loadConfig, setConfig } from "../lib/config.mjs";
import { lintBrain } from "../lib/records.mjs";
import { organizeBrain, organizeReport, addFrontmatterField } from "../lib/organize.mjs";
import { callTool } from "../lib/mcp.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe", encoding: "utf8" }).trim();

function brain() {
  const s = sandbox();
  const restore = useEnv(s.env);
  initPersonal(s.personal);
  const mojo = join(s.root, "mojo");
  initBrain(mojo);
  addBrain("mojo", mojo, s.env);
  setConfig("personalBrain", s.personal, s.env);
  setConfig("rawStore", s.raw, s.env);
  const commit = (msg, author = "Test <t@example.com>") => { git(mojo, "add", "-A"); git(mojo, "commit", "-qm", msg, "--author", author); };
  return { ...s, mojo, restore, commit, roots: () => brainRoots(loadConfig(s.env), null) };
}

test("organize fixes what has one right answer and leaves the rest", () => {
  const { mojo, restore, commit, roots } = brain();
  try {
    put(join(mojo, "agents", "tess", "card.md"), "---\nagent: tess\n---\n# Tess\n");
    // A person record filed under customers.
    put(join(mojo, "shared", "customers", "sam.md"), "---\ntype: person\nrole: PM\nagent: ops\n---\n# Sam\n");
    put(join(mojo, "shared", "customers", "acme.md"), "---\ntype: customer\nstatus: active\nagent: ops\n---\n# Acme\n");
    // Old link forms and a link to the wrong folder; tags must not change.
    put(join(mojo, "shared", "learnings", "a.md"), "---\nagent: ops\nlinks: [person/sam, \"[[customer/acme]]\"]\ntags: [team/qa]\n---\n# a\n\nSee [[person/sam|Sam]], [[projects/acme]] and `[[person/example]]`.\n");
    // Unsigned notes: one with an import note, one added by an agent's commit trailer, one with no evidence.
    put(join(mojo, "shared", "learnings", "b.md"), "<!-- imported from old/b.md — added by Tess -->\n# b\n");
    commit("setup");
    put(join(mojo, "shared", "learnings", "c.md"), "# c\n");
    commit("add c\n\nDibble-Agent: Tess", "Some Human <h@example.com>");
    put(join(mojo, "shared", "learnings", "d.md"), "# d\n");
    for (let i = 0; i < 45; i++) put(join(mojo, "shared", "notes", `bulk-${i}.md`), `---\nagent: ops\n---\n# ${i}\n`);
    commit("bulk import");

    const dry = organizeBrain(roots(), "mojo");
    assert.equal(dry.applied, false);
    assert.ok(existsSync(join(mojo, "shared", "customers", "sam.md")), "dry run moves nothing");
    const byKind = (k) => dry.fixes.filter((f) => f.kind === k);
    assert.deepEqual(byKind("misfiled").map((f) => f.detail), ["moved to shared/people/sam.md"]);
    assert.deepEqual(byKind("unsigned").map((f) => [f.path, f.detail]).sort(), [
      ["shared/learnings/b.md", "agent: tess (from its import note)"],
      ["shared/learnings/c.md", "agent: tess (from the commit that added it)"],
    ]);
    assert.ok(dry.skipped.some((s) => s.path === "shared/learnings/d.md"), "d.md came in a bulk commit: no evidence");
    assert.match(organizeReport(dry), /Run again with --apply/);

    const done = organizeBrain(roots(), "mojo", { apply: true, agent: "librarian" });
    assert.equal(done.commit, "committed");
    assert.ok(existsSync(join(mojo, "shared", "people", "sam.md")) && !existsSync(join(mojo, "shared", "customers", "sam.md")));
    const a = readFileSync(join(mojo, "shared", "learnings", "a.md"), "utf8");
    assert.match(a, /links: \[people\/sam, "\[\[customers\/acme\]\]"\]/);
    assert.match(a, /tags: \[team\/qa\]/, "tags are left alone");
    assert.match(a, /\[\[people\/sam\|Sam\]\]/);
    assert.match(a, /\[\[customers\/acme\]\]/, "a link to the wrong folder points at the one record with that id");
    assert.match(a, /`\[\[person\/example\]\]`/, "code is left alone");
    assert.match(readFileSync(join(mojo, "shared", "learnings", "b.md"), "utf8"), /^---\nagent: tess\n---/);
    assert.match(git(mojo, "log", "-1", "--format=%B"), /organize mojo .*\n\nagent: librarian/);
    const after = lintBrain(roots(), "mojo").issues;
    assert.ok(!after.some((i) => i.kind === "misfiled" || i.kind === "broken-link"));
    assert.equal(organizeBrain(roots(), "mojo").fixes.length, 0, "a second pass finds nothing");
  } finally { restore(); }
});

test("addFrontmatterField adds to existing frontmatter or creates it", () => {
  assert.equal(addFrontmatterField("---\na: 1\n---\nbody\n", "agent", "x"), "---\na: 1\nagent: x\n---\nbody\n");
  assert.equal(addFrontmatterField("# t\n", "author", "y"), "---\nauthor: y\n---\n\n# t\n");
});

test("brain_organize works through MCP, and maintained_by counts as signed", async () => {
  const { mojo, restore, commit, env } = brain();
  try {
    put(join(mojo, "shared", "memories", "epic.md"), "---\nmaintained_by: tess\n---\n# Epic state\n");
    commit("add epic");
    assert.ok(!lintBrain(brainRoots(loadConfig(env), null), "mojo").issues.some((i) => i.path === "shared/memories/epic.md"));
    const out = await callTool("brain_organize", { brain: "mojo" }, { env });
    assert.match(out, /# Organize mojo \(dry run\)/);
  } finally { restore(); }
});
