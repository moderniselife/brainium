// Best-effort git: commit brain changes locally. Never pushes, never throws.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

export function findRepoRoot(dir) {
  try {
    return git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

export function initRepo(dir) {
  if (existsSync(join(dir, ".git"))) return false;
  try {
    git(dir, ["init", "-q"]);
    return true;
  } catch {
    return false;
  }
}

/** Commit the given paths (inside dir's repo). Returns the commit status. */
/** Resolve symlinks (macOS /var → /private/var) so paths compare with git's. */
function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export function commitPaths(dir, paths, message) {
  const found = findRepoRoot(dir);
  if (!found) return "no-repo";
  const root = real(found);
  try {
    const rel = paths.map((p) => relative(root, real(p)) || ".");
    git(root, ["add", "--", ...rel]);
    const staged = git(root, ["diff", "--cached", "--name-only", "--", ...rel]).trim();
    if (!staged) return "unchanged";
    // Identity falls back to the repo's/user's git config; if none exists, use a neutral one.
    const args = ["commit", "-q", "-m", message, "--", ...rel];
    try {
      git(root, args);
    } catch (err) {
      if (/user\.(name|email)|Please tell me who you are/i.test(String(err.stderr || err.message))) {
        git(root, ["-c", "user.name=Brainium", "-c", "user.email=brainium@localhost", ...args]);
      } else {
        throw err;
      }
    }
    return "committed";
  } catch {
    return "failed";
  }
}

export function remoteUrl(dir) {
  try {
    return git(dir, ["remote", "get-url", "origin"]).trim() || null;
  } catch {
    return null;
  }
}
