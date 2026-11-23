// Records: the brain's small ontology, and lint: keeping it from rotting.
//
// Notes (sessions, learnings, …) record what happened. Records describe the
// things work is about: projects, people, teams, customers, meetings and
// documents. Each is one markdown file with frontmatter, in the brain's shared
// area under its type's folder (shared/projects/<id>.md), and records link to
// each other with [[type/id]] (or [[brain:type/id]] across brains). Following
// a link is one hop, which beats searching ("structure beats search").
//
// Lint checks a brain for the usual ways context rots: notes nobody signed,
// records missing required fields, links to records that don't exist, active
// records nobody has touched in a while (or past their review_by date),
// records filed under the wrong type, and factory agents without a production
// prompt or any evals.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brainRoots, pickBrain, sharedRoot, listAgentsIn } from "./brain.mjs";
import { commitPaths } from "./git.mjs";
import { localDate, slugify, writeFileAtomic } from "./fsutil.mjs";
import { redact } from "./redact.mjs";

export const RECORD_TYPES = {
  project: { folder: "projects", required: ["status", "owner"] },
  person: { folder: "people", required: ["role"] },
  team: { folder: "teams", required: [] },
  customer: { folder: "customers", required: ["status"] },
  meeting: { folder: "meetings", required: ["date"] },
  document: { folder: "documents", required: ["status"] },
};
const FOLDER_TYPE = Object.fromEntries(Object.entries(RECORD_TYPES).map(([t, d]) => [d.folder, t]));
/** Statuses that mean "still in play", so an untouched record is going stale. */
export const LIVE_STATUSES = ["active", "open", "in-progress", "in progress", "draft", "testing", "planned", "blocked", "review"];
const ORDER = ["type", "id", "title", "status", "owner", "team", "role", "date", "review_by", "links", "agent", "created_by", "updated"];

// ---------------------------------------------------------------------------
// Frontmatter: scalars, [a, b] lists and block lists (key:\n  - a). Record
// links are written as a block list of quoted [[wikilinks]], the shape Obsidian
// reads as link properties, so its graph and backlinks see them too.

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text, has: false };
  const meta = {};
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");
  let list = null; // key of a block list being read (key:\n  - a\n  - b)
  for (const raw of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (list && item) {
      const v = unquote(item[1]);
      if (!Array.isArray(meta[list])) meta[list] = [];
      if (v) meta[list].push(v);
      continue;
    }
    list = null;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let v = kv[2].trim();
    if (v === "") {
      meta[key] = ""; // stays empty unless "- item" lines follow
      list = key;
      continue;
    }
    if (v.startsWith("[") && v.endsWith("]") && !/^\[\[[^\]]*\]\]$/.test(v)) v = v.slice(1, -1).split(",").map(unquote).filter(Boolean);
    else v = unquote(v);
    meta[key] = v;
  }
  return { meta, body: m[2], has: true };
}

function renderFrontmatter(meta) {
  const keys = [...ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !ORDER.includes(k)).sort()];
  const val = (v) => (Array.isArray(v) ? `[${v.join(", ")}]` : /[:#\[\]]|^\s|\s$/.test(String(v)) ? JSON.stringify(String(v)) : String(v));
  const line = (k) => (k === "links" ? `links:\n${meta.links.map((l) => `  - ${JSON.stringify(`[[${l}]]`)}`).join("\n")}` : `${k}: ${val(meta[k])}`);
  return `---\n${keys.filter((k) => meta[k] !== "" && meta[k] != null && !(Array.isArray(meta[k]) && !meta[k].length)).map(line).join("\n")}\n---\n`;
}

// [[type/id]] with an optional brain: prefix, and Obsidian's #heading and |alias.
// Either the type (person) or its folder (people) works; Brainium writes the
// folder form, which Obsidian resolves as a path.
const LINK = /\[\[([a-z0-9-]+:)?([a-z]+)\/([a-z0-9][a-z0-9._-]*?)(?:\.md)?(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;

/** "people/x", "[[person/x|X]]" or "brain:project/x" -> { brain, type, id } (type may be a folder name). */
export function parseRef(ref) {
  const m = /^\[?\[?(?:([a-z0-9-]+):)?([a-z]+)\/([a-z0-9][a-z0-9._-]*?)(?:\.md)?(?:#[^\]|]*)?(?:\|[^\]]*)?\]?\]?$/.exec(String(ref || "").trim());
  if (!m) throw new Error(`a record is named folder/id, e.g. projects/onboarding (got "${ref}")`);
  const type = RECORD_TYPES[m[2]] ? m[2] : FOLDER_TYPE[m[2]];
  if (!type) throw new Error(`unknown record type "${m[2]}" (use a folder: ${Object.values(RECORD_TYPES).map((d) => d.folder).join(", ")})`);
  return { brain: m[1] || null, type, id: m[3] };
}

/** The form Brainium writes: "people/sam" or "brain:people/sam" (unparseable refs come back trimmed, as given). */
export function folderRef(ref) {
  try {
    const r = parseRef(ref);
    return `${r.brain ? `${r.brain}:` : ""}${RECORD_TYPES[r.type].folder}/${r.id}`;
  } catch {
    return String(ref || "").trim().replace(/^\[\[|\]\]$/g, "");
  }
}

function recordPath(root, type, id) {
  return join(sharedRoot(root), RECORD_TYPES[type].folder, `${id}.md`);
}

/** Body text without fenced code blocks and `inline code`, where [[links]] are examples, not links. */
function prose(body) {
  return String(body).replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
}

function linksOf(meta, body) {
  const out = new Set((Array.isArray(meta.links) ? meta.links : meta.links ? [meta.links] : []).map((l) => String(l).replace(/^\[\[|\]\]$/g, "").replace(/(#[^|]*)?(\|.*)?$/, "")));
  for (const m of prose(body).matchAll(LINK)) out.add(`${m[1] || ""}${m[2]}/${m[3]}`);
  return [...out];
}

// ---------------------------------------------------------------------------
// Save and get

/**
 * Create or update a record. Fields merge into what's there; the body is
 * replaced only when given; links are added to. Stamps updated (today) and
 * agent (who last saved it), and keeps created_by from the first save.
 */
export function saveRecord(roots, config, { type, id = "", title = "", fields = {}, body, links = [], brain = "auto", agent = "", defaultBrain = "personal", now = new Date() }) {
  if (!RECORD_TYPES[type]) throw new Error(`type must be one of: ${Object.keys(RECORD_TYPES).join(", ")}`);
  const slug = slugify(id || title);
  if (!slug) throw new Error("give the record an id or a title");
  const name = pickBrain(roots, brain, defaultBrain);
  const root = roots[name];
  const path = recordPath(root, type, slug);
  const old = existsSync(path) ? parseFrontmatter(readFileSync(path, "utf8")) : { meta: {}, body: "" };
  const clean = Object.fromEntries(Object.entries(fields || {}).map(([k, v]) => [String(k).toLowerCase(), Array.isArray(v) ? v.map((x) => redact(String(x))) : redact(String(v))]));
  const who = String(agent || "").trim();
  const meta = {
    ...old.meta,
    ...clean,
    type,
    id: slug,
    title: redact(String(title || old.meta.title || slug)),
    links: [...new Set([...(Array.isArray(old.meta.links) ? old.meta.links : old.meta.links ? [old.meta.links] : []), ...links].map(folderRef).filter(Boolean))],
    updated: localDate(now),
    ...(who ? { agent: who } : {}),
    created_by: old.meta.created_by || who || "",
  };
  const text = body !== undefined && body !== null ? redact(String(body).trim()) : String(old.body || "").trim() || `# ${meta.title}\n`;
  writeFileAtomic(path, renderFrontmatter(meta) + "\n" + text.replace(/\n*$/, "\n"));
  const missing = RECORD_TYPES[type].required.filter((f) => !meta[f]);
  const commit = config.commit === false ? "skipped" : commitPaths(root, [path], `brainium: ${old.meta.type ? "update" : "add"} ${RECORD_TYPES[type].folder}/${slug}`);
  return { path: `${name}:${relative(root, path).split(sep).join("/")}`, created: !old.meta.type, missing, commit };
}

/** All record files in a brain: [{ type, id, path, meta, body }]. */
export function listRecords(root) {
  const out = [];
  for (const [type, { folder }] of Object.entries(RECORD_TYPES)) {
    const dir = join(sharedRoot(root), folder);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md") || f === "README.md" || f.startsWith("_")) continue;
      const path = join(dir, f);
      const { meta, body } = parseFrontmatter(readFileSync(path, "utf8"));
      out.push({ type, id: f.slice(0, -3), path, meta, body });
    }
  }
  return out;
}

/**
 * A record plus one hop: what it links to (title and status of each, or that
 * it's missing) and what links back to it (records and notes in the same brain).
 */
export function getRecord(roots, ref, { brain = "auto", defaultBrain = "personal" } = {}) {
  const r = parseRef(ref);
  const name = pickBrain(roots, r.brain || brain, defaultBrain);
  const root = roots[name];
  const path = recordPath(root, r.type, r.id);
  if (!existsSync(path)) throw new Error(`No ${r.type} "${r.id}" in ${name} (looked for ${relative(root, path)}).`);
  const text = readFileSync(path, "utf8");
  const { meta, body } = parseFrontmatter(text);
  const links = linksOf(meta, body).map((l) => {
    try {
      const t = parseRef(l);
      const tb = t.brain || name;
      const p = roots[tb] && recordPath(roots[tb], t.type, t.id);
      if (!p || !existsSync(p)) return { ref: l, missing: true };
      const m = parseFrontmatter(readFileSync(p, "utf8")).meta;
      return { ref: l, title: m.title || t.id, status: m.status || undefined };
    } catch (e) {
      return { ref: l, error: e.message };
    }
  });
  const me = [`${r.type}/${r.id}`, `${RECORD_TYPES[r.type].folder}/${r.id}`];
  const backlinks = [];
  for (const file of markdownFiles(root)) {
    if (file === path) continue;
    const t = readFileSync(file, "utf8");
    const fm = parseFrontmatter(t);
    if (linksOf(fm.meta, fm.body).some((l) => me.includes(folderRef(l.replace(/^[a-z0-9-]+:/, ""))) || me.includes(l.replace(/^[a-z0-9-]+:/, "")))) backlinks.push(`${name}:${relative(root, file).split(sep).join("/")}`);
  }
  return { ref: `${name}:${RECORD_TYPES[r.type].folder}/${r.id}`, path: `${name}:${relative(root, path).split(sep).join("/")}`, meta, body: body.trim(), links, backlinks };
}

// ---------------------------------------------------------------------------
// Lint

function markdownFiles(root, out = []) {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(root, e.name);
    if (e.isDirectory()) markdownFiles(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const SIGNATURE = /^(agent|persona|from|author|created_by)\s*:|_agent: [^_]+_|_\([^)]*agent: [^)]+\)_|^\s*\**agent\**\s*:/im;

/**
 * Check a brain. Returns { brain, checked, issues: [{ kind, path, detail }] }.
 * Kinds: unsigned, missing-field, broken-link, stale, misfiled, factory.
 * Unsigned is only checked in the shared area: an agent's own folder names its author.
 * Brains registered inside this one (team brains) are left to their own lint.
 */
export function lintBrain(roots, name, { staleDays = 30, now = new Date() } = {}) {
  const root = roots[name];
  if (!root) throw new Error(`No brain called "${name}".`);
  const shared = sharedRoot(root);
  const nested = new Set(Object.values(roots).filter((r) => r !== root && r.startsWith(root + sep)));
  const issues = [];
  const rel = (p) => relative(root, p).split(sep).join("/");
  const today = localDate(now);
  const staleBefore = localDate(new Date(+now - staleDays * 86_400_000));

  // Unsigned notes in the shared area (records, typed notes), skipping indexes, templates and session day files.
  const sharedFiles = existsSync(shared) ? markdownFiles(shared).filter((f) => ![...nested].some((n) => f.startsWith(n + sep))) : [];
  for (const f of sharedFiles) {
    const base = f.split(sep).pop();
    if (base === "README.md" || base.startsWith("_") || /(^|[\\/])sessions[\\/]/.test(relative(shared, f))) continue;
    const head = readFileSync(f, "utf8").slice(0, 4000);
    const tail = readFileSync(f, "utf8").slice(-600);
    if (!SIGNATURE.test(head) && !SIGNATURE.test(tail)) issues.push({ kind: "unsigned", path: rel(f), detail: "no agent: (or persona:/from:/author:) on it" });
  }

  // Records.
  const records = listRecords(root);
  const known = new Set(records.map((r) => `${r.type}/${r.id}`));
  for (const r of records) {
    const p = rel(r.path);
    if (r.meta.type && r.meta.type !== r.type) issues.push({ kind: "misfiled", path: p, detail: `says type ${r.meta.type} but is in ${RECORD_TYPES[r.type].folder}/` });
    for (const f of RECORD_TYPES[r.type].required) if (!r.meta[f]) issues.push({ kind: "missing-field", path: p, detail: `${r.type} needs ${f}` });
    const status = String(r.meta.status || "").toLowerCase();
    if (r.meta.review_by && String(r.meta.review_by) < today) issues.push({ kind: "stale", path: p, detail: `review_by ${r.meta.review_by} has passed` });
    else if (LIVE_STATUSES.includes(status) && r.meta.updated && String(r.meta.updated) < staleBefore) issues.push({ kind: "stale", path: p, detail: `${status} but not updated since ${r.meta.updated}` });
  }

  // Links, from records and any note in the brain (outside nested brains).
  for (const f of markdownFiles(root)) {
    if ([...nested].some((n) => f.startsWith(n + sep))) continue;
    const { meta, body } = parseFrontmatter(readFileSync(f, "utf8"));
    for (const l of linksOf(meta, body)) {
      let t;
      try { t = parseRef(l); } catch { issues.push({ kind: "broken-link", path: rel(f), detail: `[[${l}]] isn't a record reference` }); continue; }
      if (t.brain && t.brain !== name) {
        if (!roots[t.brain] || !existsSync(recordPath(roots[t.brain], t.type, t.id))) issues.push({ kind: "broken-link", path: rel(f), detail: `[[${l}]] doesn't exist` });
      } else if (!known.has(`${t.type}/${t.id}`)) issues.push({ kind: "broken-link", path: rel(f), detail: `[[${l}]] doesn't exist` });
    }
  }

  // Factories: shared agents need a production prompt and at least one eval.
  for (const a of listAgentsIn(root)) {
    if (!a.dir || !a.card) continue;
    const { meta } = parseFrontmatter(readFileSync(a.card, "utf8"));
    if (String(meta.kind || "").toLowerCase() !== "factory") continue;
    const prompts = existsSync(join(a.dir, "prompts")) ? readdirSync(join(a.dir, "prompts")).filter((f) => f.endsWith(".md") && !f.startsWith("_")) : [];
    const production = prompts.filter((f) => String(parseFrontmatter(readFileSync(join(a.dir, "prompts", f), "utf8")).meta.status || "").toLowerCase() === "production");
    if (production.length !== 1) issues.push({ kind: "factory", path: rel(a.dir), detail: `factory needs exactly one production prompt in prompts/ (has ${production.length})` });
    const evals = existsSync(join(a.dir, "evals")) ? readdirSync(join(a.dir, "evals")).filter((f) => f.endsWith(".md") && !f.startsWith("_")) : [];
    if (!evals.length) issues.push({ kind: "factory", path: rel(a.dir), detail: "factory has no evals/ cases" });
  }

  return { brain: name, checked: sharedFiles.length + records.length, records: records.length, issues };
}

/** Lint report as markdown (what shared/health.md holds). */
export function lintReport(result, { now = new Date(), max = 200 } = {}) {
  const by = {};
  for (const i of result.issues) (by[i.kind] ||= []).push(i);
  const lines = [`# Brain health: ${result.brain}`, "", `Checked ${localDate(now)}: ${result.records} records, ${result.checked} shared files. ${result.issues.length ? `${result.issues.length} issue(s).` : "No issues."}`, ""];
  const order = ["broken-link", "missing-field", "misfiled", "stale", "factory", "unsigned"];
  for (const k of order) {
    if (!by[k]) continue;
    lines.push(`## ${k} (${by[k].length})`, "");
    for (const i of by[k].slice(0, max)) lines.push(`- \`${i.path}\`: ${i.detail}`);
    if (by[k].length > max) lines.push(`- … and ${by[k].length - max} more`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Lint a brain and write shared/health.md (committed). */
export function writeHealth(config, name, opts = {}) {
  const roots = brainRoots(config, null);
  const result = lintBrain(roots, name, opts);
  const path = join(sharedRoot(roots[name]), "health.md");
  writeFileAtomic(path, lintReport(result, opts) + "\n");
  const commit = config.commit === false ? "skipped" : commitPaths(roots[name], [path], `brainium: health check (${result.issues.length} issues)`);
  return { ...result, path, commit };
}
