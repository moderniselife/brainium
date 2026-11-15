// Brainium's one config file, shared by the CLI, the MCP server and the
// capture hook. Prism (or you) set it with `brainium config set`.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeJsonAtomic } from "./fsutil.mjs";

export function configPath(env = process.env) {
  if (env.BRAINIUM_CONFIG) return env.BRAINIUM_CONFIG;
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "brainium", "config.json");
}

/**
 * Who turns a captured session into a brain entry:
 *  - agent             your main AI, via the MCP server (no extra AI calls)
 *  - none              a mechanical digest, no AI at all
 *  - anthropic         Anthropic Messages API
 *  - openai            OpenAI Chat Completions API
 *  - bonsai            Bonsai (OpenAI-compatible, local)
 *  - openai-compatible any other OpenAI-compatible endpoint
 */
export const PROVIDERS = ["agent", "none", "anthropic", "openai", "bonsai", "openai-compatible"];

export const PROVIDER_DEFAULTS = Object.freeze({
  anthropic: { url: "https://api.anthropic.com", model: "claude-haiku-5-5", apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { url: "https://api.openai.com/v1", model: "", apiKeyEnv: "OPENAI_API_KEY" },
  bonsai: { url: "", model: "solo-quick", apiKeyEnv: "" },
  "openai-compatible": { url: "", model: "", apiKeyEnv: "" },
});

export const DEFAULTS = Object.freeze({
  personalBrain: join(homedir(), "Brainium"),
  // Raw, redacted transcripts live here — outside every git repo.
  rawStore: join(homedir(), ".brainium-raw"),
  capture: false,
  commit: true,
  summarizer: { provider: "agent", url: "", model: "", apiKeyEnv: "", apiKey: "" },
});

export function loadConfig(env = process.env) {
  const path = configPath(env);
  let saved = {};
  if (existsSync(path)) {
    try {
      saved = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      saved = {};
    }
  }
  return { ...DEFAULTS, ...saved, summarizer: { ...DEFAULTS.summarizer, ...(saved.summarizer || {}) } };
}

/** The summarizer with provider defaults filled in (url/model/key env). */
export function resolvedSummarizer(config, env = process.env) {
  const s = config.summarizer || DEFAULTS.summarizer;
  const provider = PROVIDERS.includes(s.provider) ? s.provider : "agent";
  const d = PROVIDER_DEFAULTS[provider] || { url: "", model: "", apiKeyEnv: "" };
  const apiKeyEnv = s.apiKeyEnv || d.apiKeyEnv;
  return {
    provider,
    url: (s.url || d.url || "").replace(/\/+$/, ""),
    model: s.model || d.model || "",
    apiKeyEnv,
    // An env var wins over a stored key, so a key can stay out of the file.
    apiKey: (apiKeyEnv && env[apiKeyEnv]) || s.apiKey || "",
  };
}

const KEYS = new Set([
  "personalBrain", "rawStore", "capture", "commit",
  "summarizer.provider", "summarizer.url", "summarizer.model", "summarizer.apiKeyEnv", "summarizer.apiKey",
]);

export function setConfig(key, raw, env = process.env) {
  if (!KEYS.has(key)) throw new Error(`unknown config key "${key}" (known: ${[...KEYS].join(", ")})`);
  if (key === "summarizer.provider" && !PROVIDERS.includes(String(raw))) {
    throw new Error(`summarizer.provider must be one of: ${PROVIDERS.join(", ")}`);
  }
  const path = configPath(env);
  let saved = {};
  if (existsSync(path)) saved = JSON.parse(readFileSync(path, "utf8"));
  const value = key === "capture" || key === "commit" ? /^(1|true|yes|on)$/i.test(String(raw)) : String(raw);
  if (key.startsWith("summarizer.")) {
    saved.summarizer = { ...(saved.summarizer || {}), [key.slice("summarizer.".length)]: value };
  } else {
    saved[key] = value;
  }
  // 0600: the file may hold an API key if the user chose to store one.
  writeJsonAtomic(path, saved, 0o600);
  return loadConfig(env);
}

/** Config for display: never print a stored key. */
export function redactedConfig(config) {
  const s = config.summarizer || {};
  return { ...config, summarizer: { ...s, apiKey: s.apiKey ? "(stored)" : "" } };
}
