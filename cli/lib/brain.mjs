// Core brain operations shared by the CLI, the MCP server and capture.
//
// Kinds of brain, each addressed by name in refs like "name:path/in/brain.md":
//   personal — the repo that follows you (config.personalBrain)
//   project  — docs/brainium/ inside a repo, found by walking up from a path
//   <name>   — any other brain you've added (config.brains), e.g. one per
//              team, Prism group, profile or project
//
// Inside personal and named brains:
//   shared/            what every agent reads and writes (a brain without a
//                      shared/ folder, like an older personal brain, uses its
//                      root as the shared area)
//   agents/<name>/     one folder per agent: its card plus its own memories,
//                      learnings, sessions… and any supporting docs
//   routines/          scheduled jobs (see routines.mjs)
//
// "Private" means separate by default, not locked: an agent searches its own
// folder plus shared/, and can look at the others when asked to.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { redact } from "./redact.mjs";
import { commitPaths } from "./git.mjs";
import { localDate, localTime, slugify, writeFileAtomic } from "./fsutil.mjs";

export const KINDS = {
  session: "sessions",
  learning: "learnings",
  failure: "failures",
  memory: "memories",
  question: "questions",
  improvement: "improvements",
  decision: "decisions",
};

export const RESERVED_BRAIN_NAMES = new Set(["personal", "project", "all", "everyone", "auto", "shared"]);
export const BRAIN_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Walk up from `start` to the nearest docs/brainium directory. */
export function findProjectBrain(start) {
  if (!start) return null;
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, "docs", "brainium");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Every brain available for a call: { personal?, project?, <name>?… } → path.
 * Brains whose folder doesn't exist are left out.
 */
export function brainRoots(config, projectHint) {
  const roots = {};
  if (config.personalBrain && isDir(config.personalBrain)) roots.personal = resolve(config.personalBrain);
  for (const [name, entry] of Object.entries(config.brains || {})) {
    const path = typeof entry === "string" ? entry : entry && entry.path;
    if (path && isDir(path) && !(name in roots)) roots[name] = resolve(path);
  }
  const project = findProjectBrain(projectHint);
  if (project) roots.project = project;
  return roots;
}

/** The brain used when a call doesn't name one: $BRAINIUM_BRAIN, the configured default, else personal. */
export function defaultBrainName(config, env = process.env) {
  return env.BRAINIUM_BRAIN || config.defaultBrain || "personal";
}

function missingBrain(name) {
  if (name === "project") return new Error("No project brain here (no docs/brainium/ above this folder). Pass `project`, or install Brainium in the repo.");
  if (name === "personal") return new Error("No personal brain yet. Run `brainium init-personal`.");
  return new Error(`No brain called "${name}". Add it with \`brainium brain add ${name} DIR\` (see \`brainium brains\`).`);
}

/**
 * Name of the brain a write or listing goes to. "auto" means the project
 * brain when there is one, else the default brain, else personal.
 */
export function pickBrain(roots, brain = "auto", defaultBrain = "personal") {
  if (brain && brain !== "auto") {
    if (!roots[brain]) throw missingBrain(brain);
    return brain;
  }
  for (const name of ["project", defaultBrain, "personal"]) if (roots[name]) return name;
  throw new Error("No brain found. Run `brainium init-personal`, or install Brainium in this repo.");
}

// Kept for older callers: scope is the same thing as brain.
function pickRoot(roots, scope, defaultBrain) {
  return roots[pickBrain(roots, scope, defaultBrain)];
}

function brainOf(roots, path) {
  let best = null;
  for (const [name, root] of Object.entries(roots)) {
    if ((path === root || path.startsWith(root + sep)) && (!best || root.length > roots[best].length)) best = name;
  }
  return best;
}

const toRef = (roots, name, path) => `${name}:${relative(roots[name], path).split(sep).join("/")}`;

// ---------------------------------------------------------------------------
// Areas: shared and per-agent

/** Where a brain's shared knowledge lives: shared/ if present, else the root. */
export function sharedRoot(root) {
  const s = join(root, "shared");
  return isDir(s) ? s : root;
}

const CARD_FILES = ["card.md", "README.md", "AGENT.md", "AGENTS.md"];

function cardIn(dir) {
  for (const f of CARD_FILES) if (existsSync(join(dir, f))) return join(dir, f);
  const own = join(dir, `${basename(dir)}.md`);
  if (existsSync(own)) return own;
  return null;
}

/**
 * Agents in a brain. Each agent is a folder under agents/ (its card plus its
 * own notes and supporting docs) and/or an older single-file card
 * agents/<slug>.md. Matching is by slug, so "Mojo Researcher/" and
 * "mojo-researcher" are the same agent.
 */
export function listAgentsIn(root) {
  const dir = join(root, "agents");
  if (!isDir(dir)) return [];
  const bySlug = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const slug = slugify(entry.name);
      const a = bySlug.get(slug) || { slug, name: entry.name, dir: null, card: null };
      a.dir = p;
      a.name = entry.name;
      a.card = a.card || cardIn(p);
      bySlug.set(slug, a);
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md") {
      const slug = slugify(entry.name.replace(/\.md$/, ""));
      const a = bySlug.get(slug) || { slug, name: null, dir: null, card: null };
      a.card = p; // a single-file card wins over a guessed one
      bySlug.set(slug, a);
    }
  }
  return [...bySlug.values()].map((a) => {
    const text = a.card ? readFileSync(a.card, "utf8") : "";
    const titled = (/^#\s+(?:Agent:\s*)?(.+)$/m.exec(text) || [])[1];
    return {
      slug: a.slug,
      // A folder Brainium made is named by its slug; the card's title reads better.
      name: (a.name && a.name !== a.slug ? a.name : titled || a.name || a.slug).trim(),
      dir: a.dir,
      card: a.card,
      tldr: (/##\s*TLDR\s*\n+([^\n#][^\n]*)/i.exec(text) || [, ""])[1].trim(),
    };
  }).sort((x, y) => x.name.localeCompare(y.name));
}

export function findAgent(root, agent) {
  const slug = slugify(agent);
  return listAgentsIn(root).find((a) => a.slug === slug) || null;
}

/** An agent's own folder (created on demand when `create`). */
export function agentRoot(root, agent, { create = false } = {}) {
  const found = findAgent(root, agent);
  if (found && found.dir) return found.dir;
  const dir = join(root, "agents", slugify(agent));
  if (create) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Folder a write or listing uses: the project brain as is; otherwise an agent's folder, or shared. */
function areaRoot(roots, brainName, { agent, shared, create = false }) {
  const root = roots[brainName];
  if (brainName === "project") return root;
  if (agent && !shared) return agentRoot(root, agent, { create });
  return sharedRoot(root);
}

/** Which agent owns a file (by agents/<x>/… or the card agents/<x>.md), else null. */
function ownerOf(root, file) {
  const rel = relative(root, file).split(sep);
  if (rel[0] !== "agents" || rel.length < 2) return null;
  return { slug: slugify(rel[1].replace(/\.md$/, "")), isCard: rel.length === 2 || (rel.length === 3 && CARD_FILES.includes(rel[2])) };
}

// ---------------------------------------------------------------------------
// Read side

function realOrSelf(p) {
  try { return realpathSync(p); } catch { return p; }
}

/** Markdown files under root. Folders in `skip` (other brains nested inside this one) are left out. */
function walkMarkdown(root, out = [], skip = new Set()) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "node_modules") continue;
    const p = join(root, entry.name);
    if (entry.isDirectory() && skip.has(realOrSelf(p))) continue;
    if (entry.isDirectory()) walkMarkdown(p, out, skip);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Brains a search covers: "all" = project + default + personal; "*" = every brain; or one name. */
function searchBrains(roots, brain, defaultBrain) {
  if (brain === "*") return Object.keys(roots);
  if (!brain || brain === "all") return [...new Set(["project", defaultBrain, "personal"])].filter((b) => roots[b]);
  if (!roots[brain]) throw missingBrain(brain);
  return [brain];
}

/**
 * AND-search every term (case-insensitive). With an agent, other agents'
 * notes are skipped (their cards still show) unless `everyone`.
 */
export function search(roots, query, { scope, brain, agent = "", everyone = false, limit = 20, defaultBrain = "personal" } = {}) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error("query is empty");
  const me = agent ? slugify(agent) : "";
  const hits = [];
  // A brain registered inside another (a team brain in a company brain's teams/ folder)
  // is its own brain: searching the outer one doesn't include it.
  const allRoots = Object.values(roots).filter(Boolean).map(realOrSelf);
  for (const b of searchBrains(roots, brain ?? scope, defaultBrain)) {
    const root = roots[b];
    const nested = new Set(allRoots.filter((r) => r !== realOrSelf(root)));
    for (const file of walkMarkdown(root, [], nested)) {
      const owner = ownerOf(root, file);
      if (owner && me && !everyone && owner.slug !== me && !owner.isCard) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      const whole = lines.join("\n").toLowerCase();
      if (!terms.every((t) => whole.includes(t))) continue;
      let best = { score: -1, line: 0 };
      lines.forEach((line, i) => {
        const l = line.toLowerCase();
        const score = terms.filter((t) => l.includes(t)).length;
        if (score > best.score) best = { score, line: i };
      });
      const from = Math.max(0, best.line - 1);
      hits.push({
        path: toRef(roots, b, file),
        line: best.line + 1,
        // Own notes first, then shared, then everyone else's.
        rank: best.score * 10 + (owner ? (owner.slug === me ? 2 : 0) : 1),
        mtime: statSync(file).mtimeMs,
        snippet: lines.slice(from, from + 4).join("\n").trim(),
      });
    }
  }
  hits.sort((a, b) => b.rank - a.rank || b.mtime - a.mtime);
  return hits.slice(0, limit).map(({ mtime, rank, ...h }) => h);
}

/** Resolve "brain:path/in/brain.md" safely inside its brain. */
export function resolveBrainPath(roots, ref) {
  const m = /^([a-z0-9][a-z0-9-]*):(.+)$/.exec(String(ref || ""));
  if (!m) throw new Error('path must look like "personal:agents/name.md", "project:learnings/x.md" or "<brain>:shared/…"');
  const root = roots[m[1]];
  if (!root) throw missingBrain(m[1]);
  const target = resolve(root, m[2]);
  const realRoot = realpathSync(root);
  const realTarget = existsSync(target) ? realpathSync(target) : target;
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    throw new Error("path escapes the brain");
  }
  return target;
}

export function readEntry(roots, ref) {
  const path = resolveBrainPath(roots, ref);
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`not found: ${ref}`);
  return readFileSync(path, "utf8");
}

function entriesOf(roots, brainName, dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md" && !n.startsWith("_"))
    .sort()
    .reverse()
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      const title = (/^#\s+(.+)$/m.exec(text) || [, name])[1].trim();
      const tldr = (/##\s*TLDR\s*\n+([^\n#][^\n]*)/i.exec(text) || [, ""])[1].trim();
      return { path: toRef(roots, brainName, join(dir, name)), title, tldr };
    });
}

/** Entries of one folder (an agent's own, or shared) with their title and TLDR line. */
export function listFolder(roots, folder, { scope, brain, agent = "", shared = false, defaultBrain = "personal" } = {}) {
  const name = pickBrain(roots, brain ?? scope ?? "auto", defaultBrain);
  if (folder === "agents" && name !== "project") {
    return { scope: name, brain: name, entries: listAgentsIn(roots[name]).map((a) => ({ path: a.card ? toRef(roots, name, a.card) : null, title: a.name, tldr: a.tldr })) };
  }
  const area = areaRoot(roots, name, { agent, shared });
  return { scope: name, brain: name, area: agent && !shared && name !== "project" ? `agent:${slugify(agent)}` : "shared", entries: entriesOf(roots, name, join(area, folder)) };
}

// ---------------------------------------------------------------------------
// Write side

/** Add a row to the first table in a folder's README (replacing a "—" placeholder row). */
export function addIndexRow(readmePath, values) {
  if (!existsSync(readmePath)) return false;
  const lines = readFileSync(readmePath, "utf8").split("\n");
  const headerAt = lines.findIndex((l, i) => l.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || ""));
  if (headerAt === -1) return false;
  const headers = lines[headerAt].split("|").slice(1, -1).map((h) => h.trim().toLowerCase());
  const row = "| " + headers.map((h) => String(values[h] ?? "").replace(/\|/g, "\\|")).join(" | ") + " |";
  let end = headerAt + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  const body = lines.slice(headerAt + 2, end).filter((l) => !/^\|\s*(—|-)?\s*(\|\s*(—|-)?\s*)*\|$/.test(l.trim()));
  // Upsert by the slug/agent link when present.
  const key = values.slug || values.agent || values.date;
  const kept = key ? body.filter((l) => !l.includes(String(key))) : body;
  const next = [...lines.slice(0, headerAt + 2), row, ...kept, ...lines.slice(end)];
  writeFileSync(readmePath, next.join("\n"));
  return true;
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

/**
 * Log an entry. kind "session" appends to sessions/YYYY-MM-DD.md; other
 * kinds create <folder>/YYYY-MM-DD-<slug>.md and index it. Secrets are
 * redacted before anything touches disk.
 *
 * Where it goes: the brain (`brain`, or the older name `scope`; "auto" =
 * project brain, else the default brain), then the agent's own folder when
 * `agent` is set, or shared/ when `shared` is true or there's no agent.
 * Project brains have no agent folders; the agent is named in the entry.
 */
export function logEntry(roots, config, { kind = "session", title, body, tags = "", scope, brain, agent = "", shared = false, now = new Date(), source = "", defaultBrain = "personal" }) {
  const folder = KINDS[kind];
  if (!folder) throw new Error(`kind must be one of: ${Object.keys(KINDS).join(", ")}`);
  if (!title || !String(title).trim()) throw new Error("title is required");
  const name = pickBrain(roots, brain ?? scope ?? "auto", defaultBrain);
  const root = roots[name];
  const area = areaRoot(roots, name, { agent, shared, create: true });
  const inOwnFolder = agent && area !== root && area !== sharedRoot(root);
  const by = agent && !inOwnFolder ? `agent: ${String(agent).trim()}` : "";
  const label = [source, by].filter(Boolean).join(", ");
  const cleanTitle = redact(String(title).trim().replace(/\s+/g, " "));
  const cleanBody = redact(String(body || "").trim());
  const redacted = cleanTitle !== String(title).trim().replace(/\s+/g, " ") || cleanBody !== String(body || "").trim();
  const date = localDate(now);
  const dir = join(area, folder);
  ensureDir(dir);
  const touched = [];
  let path;

  if (kind === "session") {
    path = join(dir, `${date}.md`);
    const isNew = !existsSync(path);
    const head = isNew ? `# ${date}\n\n` : readFileSync(path, "utf8").replace(/\n*$/, "\n\n");
    const section = `### ${localTime(now)} — ${cleanTitle}${label ? ` _(${label})_` : ""}\n\n${cleanBody}\n`;
    writeFileAtomic(path, head + section);
    touched.push(path);
    if (isNew && addIndexRow(join(dir, "README.md"), { date, day: `[${date}](./${date}.md)`, file: `[${date}](./${date}.md)`, summary: cleanTitle, topics: cleanTitle })) {
      touched.push(join(dir, "README.md"));
    }
  } else {
    const slug = `${date}-${slugify(cleanTitle)}`;
    path = join(dir, `${slug}.md`);
    const credit = by ? `\n\n_${by}_` : "";
    const text = /^#\s/.test(cleanBody) ? cleanBody + credit : `# ${date}: ${cleanTitle}\n\n${cleanBody.startsWith("## ") ? "" : "## TLDR\n\n"}${cleanBody}${credit}`;
    writeFileAtomic(path, text.replace(/\n*$/, "\n"));
    touched.push(path);
    if (addIndexRow(join(dir, "README.md"), { date, slug: `[${slug}](./${slug}.md)`, tags, summary: cleanTitle, title: cleanTitle })) {
      touched.push(join(dir, "README.md"));
    }
  }

  const who = inOwnFolder ? ` (${slugify(agent)})` : "";
  const commit = config.commit === false ? "skipped" : commitPaths(root, touched, `brainium: ${kind}${who} — ${cleanTitle}`);
  return { path: toRef(roots, name, path), brain: name, area: inOwnFolder ? `agent:${slugify(agent)}` : "shared", redacted, commit };
}

/**
 * Move one of an agent's notes into the brain's shared area so every agent
 * sees it ("share"). The file keeps its name; a clash gets a numeric suffix.
 */
export function shareEntry(roots, config, ref) {
  const from = resolveBrainPath(roots, ref);
  if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`not found: ${ref}`);
  const name = brainOf(roots, from);
  const root = roots[name];
  const rel = relative(root, from).split(sep);
  if (name === "project" || rel[0] !== "agents" || rel.length < 4) {
    throw new Error("only an agent's own notes can be shared (agents/<agent>/<folder>/<file>.md)");
  }
  const sub = rel.slice(2); // <folder>/<file>
  const base = sharedRoot(root);
  let to = join(base, ...sub);
  for (let i = 2; existsSync(to); i++) to = join(base, ...sub.slice(0, -1), sub.at(-1).replace(/\.md$/, `-${i}.md`));
  ensureDir(dirname(to));
  const credit = `\n\n_Shared by ${rel[1]} on ${localDate()}._\n`;
  writeFileAtomic(to, readFileSync(from, "utf8").replace(/\s*$/, "") + credit);
  rmSync(from);
  const commit = config.commit === false ? "skipped" : commitPaths(root, [from, to], `brainium: share ${rel[1]}'s ${sub.join("/")}`);
  return { from: ref, path: toRef(roots, name, to), commit };
}

const CARD_SECTIONS = ["TLDR", "Lives in", "Instructions (verbatim)", "Tools & connectors", "Knowledge", "Recreate", "Changelog"];

/**
 * Create or update an agent card. In a brain with shared/, new cards go in
 * the agent's folder (agents/<slug>/card.md); an older-style brain, or an
 * existing single-file card agents/<slug>.md, keeps one file per card. A folder whose README or other card file was written by
 * hand keeps it: the generated card sits beside it as card.md.
 */
export function saveAgentCard(roots, config, card, now = new Date()) {
  const name = String(card.name || "").trim();
  if (!name) throw new Error("name is required");
  // Cards never go in a project brain: "auto" means this profile's brain, else personal.
  const asked = card.brain || card.scope || "auto";
  const fallback = card.defaultBrain && card.defaultBrain !== "project" && roots[card.defaultBrain] ? card.defaultBrain : "personal";
  const brainName = pickBrain(roots, asked === "auto" ? fallback : asked);
  if (brainName === "project") throw new Error("agent cards live in the personal brain or a named brain, not a project brain");
  const root = roots[brainName];
  const agentsDir = join(root, "agents");
  ensureDir(agentsDir);
  const slug = slugify(name);
  const legacy = join(agentsDir, `${slug}.md`);
  const existing = findAgent(root, name);
  // Classic layout (no shared/, e.g. an older personal brain): a single file per card, as before.
  const classic = sharedRoot(root) === root;
  const path = existsSync(legacy) || (classic && !(existing && existing.dir))
    ? legacy
    : join(existing && existing.dir ? existing.dir : join(agentsDir, slug), "card.md");
  const date = localDate(now);
  const old = existsSync(path) ? readFileSync(path, "utf8") : "";
  const oldLog = (/## Changelog\n+([\s\S]*)$/.exec(old) || [, ""])[1].trim();
  const r = (v) => redact(String(v || "").trim());
  const apps = Array.isArray(card.apps) ? card.apps.join(", ") : r(card.apps);
  const sections = {
    TLDR: r(card.tldr) || "—",
    "Lives in": [`- App(s): ${apps || "—"}`, `- Grok Bot template link: ${r(card.templateLink) || "—"}`].join("\n"),
    "Instructions (verbatim)": "```text\n" + (r(card.instructions) || "(not captured yet)") + "\n```",
    "Tools & connectors": r(card.tools) || "—",
    Knowledge: r(card.knowledge) || "—",
    Recreate: r(card.recreate) || "—",
    Changelog: [`- ${date}: ${old ? "updated" : "created"}`, oldLog].filter(Boolean).join("\n"),
  };
  const text = `# Agent: ${redact(name)}\n\n` + CARD_SECTIONS.map((s) => `## ${s}\n\n${sections[s]}\n`).join("\n");
  writeFileAtomic(path, text);
  const touched = [path];
  const link = relative(agentsDir, path).split(sep).join("/");
  if (addIndexRow(join(agentsDir, "README.md"), { agent: `[${redact(name)}](./${link})`, apps, updated: date })) {
    touched.push(join(agentsDir, "README.md"));
  }
  const commit = config.commit === false ? "skipped" : commitPaths(root, touched, `brainium: agent card — ${name}`);
  return { path: toRef(roots, brainName, path), brain: brainName, created: !old, commit };
}

/** Read an agent's card: the named brain first, then the default, personal and the rest. */
export function getAgentCard(roots, name, { brain, defaultBrain = "personal" } = {}) {
  const order = [...new Set([brain, defaultBrain, "personal", ...Object.keys(roots)])].filter((b) => b && roots[b] && b !== "project");
  for (const b of order) {
    const a = findAgent(roots[b], name);
    if (a && a.card) return { brain: b, path: toRef(roots, b, a.card), text: readFileSync(a.card, "utf8") };
  }
  throw new Error(`no agent card for "${name}"`);
}

/** Agents across brains (or one brain) for listings. */
export function listAgents(roots, { brain } = {}) {
  const names = brain && brain !== "all" ? [pickBrain(roots, brain)] : Object.keys(roots).filter((b) => b !== "project");
  return names.flatMap((b) => listAgentsIn(roots[b]).map((a) => ({
    brain: b,
    name: a.name,
    slug: a.slug,
    tldr: a.tldr,
    card: a.card ? toRef(roots, b, a.card) : null,
    folder: a.dir ? toRef(roots, b, a.dir) : null,
  })));
}
