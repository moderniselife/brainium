// Preflight: before an agent does any work, bring its rules and brain up to
// date and tell it what changed since it last looked, so nobody has to remind
// it to "pull first".
//
// A repo opts in with .brainium.json next to its root:
//
//   {
//     "brain": "acme",
//     "update": [".", "rules-repo", "brain"],      // git checkouts to fast-forward (relative paths)
//     "rules": ["AGENTS.md", "rules-repo/rules", "rules-repo/{agent}", "!rules-repo/**/*.test.js"]
//                                                  // files or folders the agent must reread; "{agent}" is the
//                                                  // agent's slug; "!" excludes
//   }
//
// Pulls are fast-forward only and never rebase, merge, stash or switch
// branches: a checkout on a detached HEAD (a pinned submodule), without an
// upstream, or with local changes that a pull would overwrite is left alone
// and reported. Rule changes are tracked per agent: the last commit each agent
// saw in each repo is kept in the raw store, so the first preflight lists every
// rule file and later ones list only what changed.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readJsonObject, writeJsonAtomic } from "./fsutil.mjs";

const TIMEOUT_MS = 8_000; // per git call: the Claude Code session-start hook gives up after 30s

/** The nearest .brainium.json above `start` with its directory, or null. */
export function findPreflightConfig(start) {
  let dir = resolve(start || process.cwd());
  for (;;) {
    const f = join(dir, ".brainium.json");
    if (existsSync(f)) {
      try {
        const cfg = JSON.parse(readFileSync(f, "utf8"));
        return { root: dir, update: list(cfg.update), rules: list(cfg.rules) };
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);

function git(cwd, args, timeout = TIMEOUT_MS) {
  return execFileSync("git", ["-c", "submodule.recurse=false", ...args], { cwd, timeout, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function tryGit(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message || "").trim().split("\n").slice(-3).join(" ") };
  }
}

const isRepo = (dir) => existsSync(join(dir, ".git"));

/** Fast-forward one checkout. Returns { path, status, detail, head }. */
export function pullRepo(dir, label = dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { path: label, status: "missing", detail: "not checked out" };
  if (!isRepo(dir)) return { path: label, status: "missing", detail: "not a git checkout (submodule not initialised?)" };
  const branch = tryGit(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const before = tryGit(dir, ["rev-parse", "HEAD"]).out;
  if (!branch.ok) return { path: label, status: "skipped", detail: "detached HEAD (pinned); not pulled", head: before };
  const upstream = tryGit(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream.ok) return { path: label, status: "skipped", detail: `${branch.out} has no upstream; not pulled`, head: before };
  const remote = upstream.out.split("/")[0];
  const fetch = tryGit(dir, ["fetch", "--quiet", remote]);
  if (!fetch.ok) return { path: label, status: "failed", detail: `fetch failed: ${fetch.out}`, head: before };
  const pull = tryGit(dir, ["merge", "--ff-only", "--quiet", upstream.out]);
  const after = tryGit(dir, ["rev-parse", "HEAD"]).out;
  if (!pull.ok) {
    const behind = tryGit(dir, ["rev-list", "--count", `HEAD..${upstream.out}`]).out;
    return { path: label, status: "failed", detail: `${branch.out} is ${behind} behind ${upstream.out} and can't fast-forward (${pull.out || "local commits or changes in the way"})`, head: after };
  }
  return { path: label, status: after === before ? "current" : "updated", detail: after === before ? `${branch.out} up to date` : `${branch.out} ${before.slice(0, 7)} → ${after.slice(0, 7)}`, head: after, before };
}

/**
 * Git pathspecs, relative to `repoDir`, for the `rules` entries inside it.
 * An entry starting with "!" excludes; it is a glob, such as "!rules/*.test.js".
 */
function rulesIn(repoDir, rootDir, rules) {
  const inRepo = (r) => {
    const abs = resolve(rootDir, r);
    return abs === repoDir || abs.startsWith(repoDir + sep) ? relative(repoDir, abs) || "." : null;
  };
  const include = rules.filter((r) => !r.startsWith("!")).map(inRepo).filter((x) => x !== null);
  if (!include.length) return [];
  const exclude = rules.filter((r) => r.startsWith("!")).map((r) => inRepo(r.slice(1))).filter((x) => x !== null && x !== ".").map((x) => `:(exclude,glob)${x}`);
  return [...include, ...exclude];
}

/** The innermost repo (among those given) that contains `abs`. */
function ownerRepo(abs, repos) {
  return repos.filter((d) => abs === d || abs.startsWith(d + sep)).sort((a, b) => b.length - a.length)[0] || null;
}

/**
 * Run preflight for the project at `cwd` as `agent`. Returns
 * { configured, repos: [...pullRepo results], changed: [paths], firstRun, text }.
 */
export function preflight(config, { cwd = process.cwd(), agent = "", now = new Date(), pull = true } = {}) {
  const pf = findPreflightConfig(cwd);
  if (!pf || (!pf.update.length && !pf.rules.length)) {
    return { configured: false, repos: [], changed: [], firstRun: false, text: "" };
  }
  const who = String(agent || "default").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "default";
  const statePath = join(config.rawStore, "preflight.json");
  let state = {};
  try { state = readJsonObject(statePath); } catch { state = {}; }
  const key = (repo) => `${who}::${repo}`;

  // "{agent}" in a rule path is this agent's slug (its own prompt folder, say); without an agent those entries are dropped.
  pf.rules = pf.rules.flatMap((r) => (r.includes("{agent}") ? (who === "default" ? [] : [r.replaceAll("{agent}", who)]) : [r]));
  const repoDirs = pf.update.map((u) => resolve(pf.root, u));
  const repos = pull ? repoDirs.map((d) => pullRepo(d, relative(pf.root, d) || ".")) : [];

  // Every repo that holds a rule path, even if it isn't pulled.
  const ruleRepos = new Set();
  for (const r of pf.rules.filter((x) => !x.startsWith("!"))) {
    const abs = resolve(pf.root, r);
    const own = ownerRepo(abs, [...new Set([...repoDirs, pf.root])].filter(isRepo));
    if (own) ruleRepos.add(own);
  }

  const changed = [];
  let firstRun = false;
  for (const repo of ruleRepos) {
    const paths = rulesIn(repo, pf.root, pf.rules);
    if (!paths.length) continue;
    const head = tryGit(repo, ["rev-parse", "HEAD"]);
    if (!head.ok) continue;
    const seen = state[key(repo)];
    const prefix = relative(pf.root, repo);
    const show = (f) => (prefix ? `${prefix}/${f}` : f);
    if (!seen) {
      firstRun = true;
      const files = tryGit(repo, ["ls-files", "--", ...paths]);
      if (files.ok) changed.push(...files.out.split("\n").filter(Boolean).map(show));
    } else if (seen !== head.out) {
      const diff = tryGit(repo, ["diff", "--name-only", `${seen}..${head.out}`, "--", ...paths]);
      if (diff.ok) changed.push(...diff.out.split("\n").filter(Boolean).map(show));
      else {
        const files = tryGit(repo, ["ls-files", "--", ...paths]); // history rewritten: reread everything
        if (files.ok) changed.push(...files.out.split("\n").filter(Boolean).map(show));
      }
    }
    state[key(repo)] = head.out;
  }
  state.lastRun = { ...(state.lastRun || {}), [who]: now.toISOString() };
  writeJsonAtomic(statePath, state);

  return { configured: true, repos, changed: [...new Set(changed)], firstRun, text: preflightText({ repos, changed: [...new Set(changed)], firstRun, agent }) };
}

export function preflightText({ repos, changed, firstRun, agent }) {
  const lines = [];
  const bad = repos.filter((r) => r.status === "failed" || r.status === "missing");
  const updated = repos.filter((r) => r.status === "updated");
  lines.push(`Brainium preflight${agent ? ` (${agent})` : ""}: ${updated.length ? `pulled ${updated.map((r) => r.path).join(", ")}` : "everything already up to date"}${bad.length ? `; ${bad.length} problem${bad.length === 1 ? "" : "s"}` : ""}.`);
  for (const r of bad) lines.push(`- ${r.path}: ${r.detail}. Fix this before relying on its rules or memory, or say it's stale.`);
  for (const r of repos.filter((x) => x.status === "skipped")) lines.push(`- ${r.path}: ${r.detail}.`);
  if (changed.length) {
    lines.push(firstRun
      ? `Read these rule files before doing anything else (first preflight for this agent):`
      : `These rule files changed since your last session. Reread them before doing anything else and follow the new versions:`);
    for (const f of changed.slice(0, 40)) lines.push(`- ${f}`);
    if (changed.length > 40) lines.push(`- … and ${changed.length - 40} more`);
  } else {
    lines.push("No rule changes since your last session.");
  }
  return lines.join("\n");
}
