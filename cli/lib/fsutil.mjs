import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/** Write a file atomically (temp + rename) so a crash never leaves half a config. */
export function writeFileAtomic(path, data, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, data, mode ? { mode } : undefined);
  if (mode) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

export function writeJsonAtomic(path, value, mode) {
  writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n", mode);
}

/** Read a JSON object file; missing → {}. Unparseable → throws (never clobber what we can't read). */
export function readJsonObject(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  const value = JSON.parse(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return value;
}

export const BLOCK_BEGIN = "<!-- brainium:begin (managed by `brainium wire`; edits inside are replaced) -->";
export const BLOCK_END = "<!-- brainium:end -->";

/** Insert or replace the managed block in a markdown file; returns new text. */
export function upsertManagedBlock(text, body) {
  const block = `${BLOCK_BEGIN}\n${body.trim()}\n${BLOCK_END}`;
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
  }
  const sep = text.trim() === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return text + sep + block + "\n";
}

export function removeManagedBlock(text) {
  const start = text.indexOf(BLOCK_BEGIN);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end < start) return text;
  const out = (text.slice(0, start) + text.slice(end + BLOCK_END.length))
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  return out ? out + "\n" : "";
}

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "entry";
}

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
