import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "brainium-test-"));
  const env = {
    ...process.env,
    BRAINIUM_CONFIG: join(root, "config.json"),
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.com",
  };
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CONFIG_DIR", "BRAINIUM_PROJECT"]) delete env[k];
  return { root, env, personal: join(root, "Brainium"), raw: join(root, "raw") };
}

export function put(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

export function useEnv(env) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
  return () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  };
}
