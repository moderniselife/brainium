// `brainium init-personal`: create the personal brain from scaffold/personal.
import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, commitPaths } from "./git.mjs";

export const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function initPersonal(dir) {
  const target = resolve(dir);
  const existed = existsSync(target) && readdirSync(target).length > 0;
  // Never overwrite: an existing brain keeps every file, missing ones are added.
  cpSync(join(PKG_ROOT, "scaffold", "personal"), target, { recursive: true, force: false, errorOnExist: false });
  const createdRepo = initRepo(target);
  const commit = commitPaths(target, [target], existed ? "brainium: refresh personal brain scaffold" : "brainium: create personal brain");
  return { path: target, existed, createdRepo, commit };
}

const SHARED_FOLDERS = ["sessions", "memories", "learnings", "decisions", "questions", "improvements"];

/**
 * `brainium brain add --create` / `init-brain`: a team brain — shared/,
 * agents/, routines/ — from scaffold/brain, with the knowledge folders'
 * READMEs and templates under shared/. Never overwrites a file.
 */
export function initBrain(dir) {
  const target = resolve(dir);
  const existed = existsSync(target) && readdirSync(target).length > 0;
  cpSync(join(PKG_ROOT, "scaffold", "brain"), target, { recursive: true, force: false, errorOnExist: false });
  for (const f of SHARED_FOLDERS) {
    cpSync(join(PKG_ROOT, "scaffold", "personal", f), join(target, "shared", f), { recursive: true, force: false, errorOnExist: false });
  }
  const createdRepo = initRepo(target);
  const commit = commitPaths(target, [target], existed ? "brainium: refresh brain scaffold" : "brainium: create brain");
  return { path: target, existed, createdRepo, commit };
}
