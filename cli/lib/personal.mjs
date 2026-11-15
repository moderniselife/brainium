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
