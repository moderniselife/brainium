// Organize: the mechanical half of the librarian. Lint finds rot; this fixes
// the parts that have exactly one right answer, so a brain stays tidy without
// anyone sorting it by hand:
//
//   misfiled     a record whose `type` says another kind → moved to that kind's folder
//   unsigned     a shared note with no author → signed from evidence: the agent folder
//                it sits in, an "added by NAME" import note, or the first git commit
//                that added it (bulk commits and sync bots don't count)
//   links        [[person/sam]] → [[people/sam]]; a link to a record that doesn't exist
//                is pointed at the one record with that id, if there's exactly one
//
// Anything ambiguous is left alone and listed as skipped, for a person or the
// librarian routine (an AI prompt routine) to judge. Dry run by default.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { sharedRoot } from "./brain.mjs";
import { LINK, RECORD_TYPES, SIGNATURE, folderRef, lintBrain, listRecords, markdownFiles, parseFrontmatter, parseRef, prose } from "./records.mjs";
import { slugify } from "./fsutil.mjs";

const BULK_COMMIT_FILES = 40; // a commit touching more files than this is a move or an import, not an author
const NOT_AUTHORS = /^(brain sync|brainium|github-actions|dependabot|renovate|.*\[bot\])$/i;

function git(root, args) {
  return execFileSync("git", ["-c", "submodule.recurse=false", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

const real = (p) => {
  try { return realpathSync(p); } catch { return p; }
};

function repoRoot(dir) {
  try {
    return real(git(dir, ["rev-parse", "--show-toplevel"]));
  } catch {
    return null;
  }
}

/** Every agent slug in this brain (agents/<slug>/ and teams/<team>/agents/<slug>/). */
function agentSlugs(root) {
  const out = new Set();
  for (const f of markdownFiles(root)) {
    const parts = relative(root, f).split(sep);
    const i = parts.indexOf("agents");
    if (i >= 0 && parts.length > i + 2 && !parts[i + 1].startsWith("_")) out.add(parts[i + 1]);
  }
  return out;
}

/** The agent folder a file sits in, if any. */
function agentOfPath(rel) {
  const m = /(?:^|\/)agents\/([a-z0-9][a-z0-9-]*)\//.exec(rel);
  return m ? m[1] : null;
}

/** Who first added `file`, from git, ignoring bulk commits and bots. */
function gitAuthor(repo, file) {
  let log;
  try {
    log = git(repo, ["log", "--follow", "--reverse", "--format=%H%x09%an", "--", relative(repo, real(file))]);
  } catch {
    return null;
  }
  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, name] = line.split("\t");
    if (!name || NOT_AUTHORS.test(name.trim())) continue;
    let files = 0;
    try {
      files = git(repo, ["show", "--format=", "--name-only", sha]).split("\n").filter(Boolean).length;
    } catch { continue; }
    if (files > BULK_COMMIT_FILES) continue;
    // An "Agent:" (or "<tool>-Agent:") trailer names the agent better than the git author does.
    try {
      const msg = git(repo, ["show", "-s", "--format=%B", sha]);
      const t = /^(?:[\w-]+-)?agent:\s*(.+)$/im.exec(msg);
      if (t) return t[1].trim();
    } catch { /* fall back to the author */ }
    return name.trim();
  }
  return null;
}

/** Add `key: value` to a note's frontmatter (creating it if there is none). */
export function addFrontmatterField(text, key, value) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (m) return `---\n${m[1]}\n${key}: ${value}\n---\n${text.slice(m[0].length)}`;
  return `---\n${key}: ${value}\n---\n\n${text}`;
}

/**
 * Work out (and with apply, make) the mechanical fixes for brain `name`.
 * Returns { brain, fixes: [{ kind, path, detail }], skipped: [{ kind, path, detail }], commit }.
 */
export function organizeBrain(roots, name, { apply: wantApply = false, agent = "", now = new Date() } = {}) {
  let apply = wantApply;
  const root = roots[name];
  if (!root) throw new Error(`No brain called "${name}".`);
  const repo = repoRoot(root);
  const rel = (p) => relative(root, p).split(sep).join("/");
  const lint = lintBrain(roots, name, { now });
  // Don't sweep up someone else's half-staged work into our commit.
  const stagedBefore = apply && repo ? git(repo, ["diff", "--cached", "--name-only"]) : "";
  if (stagedBefore) apply = false;
  const fixes = [];
  const skipped = [];
  const touched = new Set();
  const write = (abs, text) => {
    if (apply) writeFileSync(abs, text);
    touched.add(abs);
  };

  // 1. Misfiled records → their type's folder.
  const records = listRecords(root);
  for (const r of records) {
    const want = r.meta.type && RECORD_TYPES[String(r.meta.type).toLowerCase()];
    if (!want || r.meta.type === r.type) continue;
    const dest = join(sharedRoot(root), want.folder, `${r.id}.md`);
    if (existsSync(dest)) {
      skipped.push({ kind: "misfiled", path: rel(r.path), detail: `${want.folder}/${r.id}.md already exists; merge them by hand` });
      continue;
    }
    fixes.push({ kind: "misfiled", path: rel(r.path), detail: `moved to ${rel(dest)}` });
    if (apply) {
      mkdirSync(dirname(dest), { recursive: true });
      if (repo) git(repo, ["mv", relative(repo, real(r.path)), relative(repo, join(real(dirname(dest)), `${r.id}.md`))]);
      else writeFileSync(dest, readFileSync(r.path)); // no git: copy (the old file stays for a person to delete)
    }
    touched.add(r.path).add(dest);
  }

  // 2. Unsigned shared notes → signed from evidence.
  const agents = agentSlugs(root);
  for (const issue of lint.issues.filter((i) => i.kind === "unsigned")) {
    const abs = join(root, issue.path);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    if (SIGNATURE.test(text)) continue;
    let who = agentOfPath(issue.path);
    let how = who ? "the agent folder it's in" : "";
    if (!who) {
      const added = /<!--\s*imported from[^>]*?added by ([^>]+?)\s*-->/i.exec(text);
      if (added) { who = added[1].trim(); how = "its import note"; }
    }
    if (!who && repo) {
      const a = gitAuthor(repo, abs);
      if (a) { who = a; how = "the commit that added it"; }
    }
    if (!who) {
      skipped.push({ kind: "unsigned", path: issue.path, detail: "no evidence of who wrote it" });
      continue;
    }
    const slug = slugify(who);
    // A known agent signs as agent:; anyone else (a person, an outside tool) as author:.
    const short = [...agents].find((a) => slug === a || slug.startsWith(`${a}-`));
    const key = short ? "agent" : "author";
    const value = short || slug;
    fixes.push({ kind: "unsigned", path: issue.path, detail: `${key}: ${value} (from ${how})` });
    write(abs, addFrontmatterField(text, key, value));
  }

  // 3. Links: folder form, and broken record links with exactly one candidate.
  // Where each record is once the moves above are made.
  const moved = new Map(fixes.filter((f) => f.kind === "misfiled").map((f) => [f.path, f.detail.replace(/^moved to shared\//, "").split("/")[0]]));
  const folderOf = (r) => moved.get(rel(r.path)) || RECORD_TYPES[r.type].folder;
  const byId = new Map();
  for (const r of records) byId.set(r.id, [...new Set([...(byId.get(r.id) || []), folderOf(r)])]);
  const known = new Set(records.map((r) => `${folderOf(r)}/${r.id}`));
  const nested = Object.values(roots).filter((r) => r !== root && r.startsWith(root + sep));
  for (const f of markdownFiles(root)) {
    if (nested.some((n) => f.startsWith(n + sep))) continue;
    const text = readFileSync(f, "utf8");
    const { body } = parseFrontmatter(text);
    const proseBody = prose(body);
    let out = text;
    const changes = [];
    for (const m of proseBody.matchAll(LINK)) {
      const whole = m[0];
      let ref;
      try { ref = parseRef(whole); } catch { continue; }
      if (ref.brain) continue;
      const folder = RECORD_TYPES[ref.type].folder;
      let target = `${folder}/${ref.id}`;
      if (!known.has(target)) {
        const options = byId.get(ref.id) || [];
        if (options.length !== 1) continue;
        target = `${options[0]}/${ref.id}`;
      }
      const current = `${m[2]}/${m[3]}`;
      if (current === target) continue;
      const fixed = whole.replace(`${m[2]}/${m[3]}`, target);
      if (out.includes(whole)) {
        out = out.split(whole).join(fixed);
        changes.push(`${current} → ${target}`);
      }
    }
    // Frontmatter links: only the links: field (tags like team/dev are not record links).
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(out);
    if (fm) {
      const lines = fm[1].split("\n");
      let inLinks = false;
      const fixRef = (all, open, brain, type, id, close) => {
        if (brain || !RECORD_TYPES[type]) return all;
        const ref = folderRef(`${type}/${id}`);
        changes.push(`${type}/${id} → ${ref}`);
        return `${open}${ref}${close}`;
      };
      const refRe = /(\[\[|^|[\s\[,"'])([a-z0-9-]+:)?([a-z]+)\/([a-z0-9][a-z0-9._-]*)(\]\]|(?=[\s\],"']|$))/g;
      for (let k = 0; k < lines.length; k++) {
        const kv = /^links\s*:(.*)$/i.exec(lines[k]);
        if (kv) { inLinks = true; lines[k] = "links:" + kv[1].replace(refRe, fixRef); continue; }
        if (inLinks && /^\s*-\s/.test(lines[k])) { lines[k] = lines[k].replace(refRe, fixRef); continue; }
        inLinks = false;
      }
      const block = lines.join("\n");
      if (block !== fm[1]) out = out.replace(fm[1], block);
    }
    if (out !== text) {
      fixes.push({ kind: "links", path: rel(f), detail: [...new Set(changes)].join(", ") });
      write(f, out);
    }
  }

  let commit = stagedBefore ? "skipped: other changes are already staged in this repo; commit or unstage them, then run again" : "dry-run";
  if (apply && touched.size && repo) {
    const existing = [...touched].filter((p) => existsSync(p)).map((p) => relative(repo, real(p)));
    try {
      if (existing.length) git(repo, ["add", "-A", "--", ...existing]);
      const staged = git(repo, ["diff", "--cached", "--name-only"]);
      if (staged) {
        const who = agent ? `\n\nagent: ${agent}` : "";
        git(repo, ["-c", "user.name=" + (process.env.GIT_AUTHOR_NAME || "Brainium"), "-c", "user.email=" + (process.env.GIT_AUTHOR_EMAIL || "brainium@localhost"), "commit", "-q", "-m", `brainium: organize ${name} (${fixes.length} fix${fixes.length === 1 ? "" : "es"})${who}`]);
        commit = "committed";
      } else commit = "unchanged";
    } catch (e) {
      commit = `failed: ${String(e.stderr || e.message).trim().split("\n").pop()}`;
    }
  } else if (apply) commit = touched.size ? "no-repo" : "unchanged";

  return { brain: name, applied: apply, fixes, skipped, commit };
}

export function organizeReport(r) {
  const lines = [`# Organize ${r.brain}${r.applied ? "" : " (dry run)"}`, ""];
  const kinds = ["misfiled", "unsigned", "links"];
  if (!r.fixes.length) lines.push("Nothing to fix.");
  for (const k of kinds) {
    const f = r.fixes.filter((x) => x.kind === k);
    if (!f.length) continue;
    lines.push(`## ${k} (${f.length})`);
    for (const x of f.slice(0, 50)) lines.push(`- \`${x.path}\`: ${x.detail}`);
    if (f.length > 50) lines.push(`- … ${f.length - 50} more`);
    lines.push("");
  }
  if (r.skipped.length) {
    lines.push(`## Left for a person or the librarian (${r.skipped.length})`);
    for (const x of r.skipped.slice(0, 30)) lines.push(`- \`${x.path}\`: ${x.kind}, ${x.detail}`);
    if (r.skipped.length > 30) lines.push(`- … ${r.skipped.length - 30} more`);
    lines.push("");
  }
  if (r.applied) lines.push(`Commit: ${r.commit}`);
  else if (r.fixes.length) lines.push("Run again with --apply to make these fixes.");
  return lines.join("\n").trim();
}
