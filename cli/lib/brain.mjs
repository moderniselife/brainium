// Core brain operations shared by the CLI, the MCP server and capture.
// Two kinds of brain:
//   personal — one repo that follows you (config.personalBrain)
//   project  — docs/brainium/ inside a repo, found by walking up from a path
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

/** Brain roots available for a call: { personal?, project? }. */
export function brainRoots(config, projectHint) {
  const roots = {};
  if (config.personalBrain && existsSync(config.personalBrain)) roots.personal = resolve(config.personalBrain);
  const project = findProjectBrain(projectHint);
  if (project) roots.project = project;
  return roots;
}

function pickRoot(roots, scope) {
  if (scope === "personal" || scope === "project") {
    if (!roots[scope]) {
      throw new Error(scope === "project"
        ? "No project brain here (no docs/brainium/ above this folder). Pass `project`, or install Brainium in the repo."
        : "No personal brain yet. Run `brainium init-personal`.");
    }
    return roots[scope];
  }
  // auto: the project brain when there is one, else personal.
  const root = roots.project || roots.personal;
  if (!root) throw new Error("No brain found. Run `brainium init-personal`, or install Brainium in this repo.");
  return root;
}

function scopeOf(roots, root) {
  return root === roots.project ? "project" : "personal";
}

// ---------------------------------------------------------------------------
// Read side

function walkMarkdown(root, out = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) walkMarkdown(p, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** AND-search every term (case-insensitive) per line across brains. */
export function search(roots, query, { scope = "all", limit = 20 } = {}) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) throw new Error("query is empty");
  const scopes = scope === "all" ? Object.keys(roots) : [scope].filter((s) => roots[s]);
  const hits = [];
  for (const s of scopes) {
    for (const file of walkMarkdown(roots[s])) {
      if (file.endsWith("_template.md")) continue;
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
        path: `${s}:${relative(roots[s], file).split(sep).join("/")}`,
        line: best.line + 1,
        score: best.score,
        mtime: statSync(file).mtimeMs,
        snippet: lines.slice(from, from + 4).join("\n").trim(),
      });
    }
  }
  hits.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return hits.slice(0, limit).map(({ mtime, score, ...h }) => h);
}

/** Resolve "personal:agents/x.md" safely inside its brain. */
export function resolveBrainPath(roots, ref) {
  const m = /^(personal|project):(.+)$/.exec(String(ref || ""));
  if (!m) throw new Error('path must look like "personal:agents/name.md" or "project:learnings/x.md"');
  const root = roots[m[1]];
  if (!root) throw new Error(`no ${m[1]} brain available`);
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

/** Entries of one folder with their title and TLDR line. */
export function listFolder(roots, folder, { scope = "auto" } = {}) {
  const root = pickRoot(roots, scope);
  const dir = join(root, folder);
  if (!existsSync(dir)) return { scope: scopeOf(roots, root), entries: [] };
  const entries = readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n !== "README.md" && n !== "_template.md")
    .sort()
    .reverse()
    .map((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      const title = (/^#\s+(.+)$/m.exec(text) || [, name])[1].trim();
      const tldr = (/##\s*TLDR\s*\n+([^\n#][^\n]*)/i.exec(text) || [, ""])[1].trim();
      return { path: `${scopeOf(roots, root)}:${folder}/${name}`, title, tldr };
    });
  return { scope: scopeOf(roots, root), entries };
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
 */
export function logEntry(roots, config, { kind = "session", title, body, tags = "", scope = "auto", now = new Date(), source = "" }) {
  const folder = KINDS[kind];
  if (!folder) throw new Error(`kind must be one of: ${Object.keys(KINDS).join(", ")}`);
  if (!title || !String(title).trim()) throw new Error("title is required");
  const root = pickRoot(roots, scope);
  const cleanTitle = redact(String(title).trim().replace(/\s+/g, " "));
  const cleanBody = redact(String(body || "").trim());
  const redacted = cleanTitle !== String(title).trim().replace(/\s+/g, " ") || cleanBody !== String(body || "").trim();
  const date = localDate(now);
  const dir = join(root, folder);
  ensureDir(dir);
  const touched = [];
  let path;

  if (kind === "session") {
    path = join(dir, `${date}.md`);
    const isNew = !existsSync(path);
    const head = isNew ? `# ${date}\n\n` : readFileSync(path, "utf8").replace(/\n*$/, "\n\n");
    const section = `### ${localTime(now)} — ${cleanTitle}${source ? ` _(${source})_` : ""}\n\n${cleanBody}\n`;
    writeFileAtomic(path, head + section);
    touched.push(path);
    if (isNew && addIndexRow(join(dir, "README.md"), { date, day: `[${date}](./${date}.md)`, file: `[${date}](./${date}.md)`, summary: cleanTitle, topics: cleanTitle })) {
      touched.push(join(dir, "README.md"));
    }
  } else {
    const slug = `${date}-${slugify(cleanTitle)}`;
    path = join(dir, `${slug}.md`);
    const text = /^#\s/.test(cleanBody) ? cleanBody : `# ${date}: ${cleanTitle}\n\n${cleanBody.startsWith("## ") ? "" : "## TLDR\n\n"}${cleanBody}`;
    writeFileAtomic(path, text.replace(/\n*$/, "\n"));
    touched.push(path);
    if (addIndexRow(join(dir, "README.md"), { date, slug: `[${slug}](./${slug}.md)`, tags, summary: cleanTitle, title: cleanTitle })) {
      touched.push(join(dir, "README.md"));
    }
  }

  const commit = config.commit === false ? "skipped" : commitPaths(root, touched, `brainium: ${kind} — ${cleanTitle}`);
  return { path: `${scopeOf(roots, root)}:${relative(root, path).split(sep).join("/")}`, redacted, commit };
}

const CARD_SECTIONS = ["TLDR", "Lives in", "Instructions (verbatim)", "Tools & connectors", "Knowledge", "Recreate", "Changelog"];

/** Create or update an agent card in the personal brain. */
export function saveAgentCard(roots, config, card, now = new Date()) {
  const root = pickRoot(roots, "personal");
  const name = String(card.name || "").trim();
  if (!name) throw new Error("name is required");
  const dir = join(root, "agents");
  ensureDir(dir);
  const slug = slugify(name);
  const path = join(dir, `${slug}.md`);
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
  if (addIndexRow(join(dir, "README.md"), { agent: `[${redact(name)}](./${slug}.md)`, apps, updated: date })) {
    touched.push(join(dir, "README.md"));
  }
  const commit = config.commit === false ? "skipped" : commitPaths(root, touched, `brainium: agent card — ${name}`);
  return { path: `personal:agents/${slug}.md`, created: !old, commit };
}
