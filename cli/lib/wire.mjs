// `brainium wire` / `unwire`: connect one app profile to the brain.
//
//   claude-code     skill + CLAUDE.md block + MCP server (+ capture hooks)
//   claude-desktop  MCP server in claude_desktop_config.json
//   cursor          MCP server in ~/.cursor/mcp.json (shared by all profiles)
//   grok-bot        nothing local to edit: returns an instructions snippet
//
// Every edit is idempotent and reversible: JSON entries are keyed "brainium"
// (hooks are recognised by their command), and markdown changes live inside
// a managed block. Commands use absolute paths to node and this CLI because
// GUI apps don't get your shell's PATH.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readJsonObject, removeManagedBlock, slugify, upsertManagedBlock, writeFileAtomic, writeJsonAtomic } from "./fsutil.mjs";
import { PKG_ROOT } from "./personal.mjs";
import { remoteUrl } from "./git.mjs";

export const APPS = ["claude-code", "claude-desktop", "cursor", "grok-bot"];
export const CLI_PATH = join(PKG_ROOT, "bin", "brainium.mjs");

function template(name, vars) {
  let text = readFileSync(join(PKG_ROOT, "cli", "templates", name), "utf8");
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  return text;
}

function shellQuote(s) {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;
}

export function mcpEntry(node = process.execPath, cli = CLI_PATH, brain = "") {
  // BRAINIUM_BRAIN makes this profile's calls use its own brain by default.
  return { type: "stdio", command: node, args: [cli, "mcp"], env: brain && brain !== "personal" ? { BRAINIUM_BRAIN: brain } : {} };
}

function hookCommand(node, cli, sub, brain = "") {
  return `${shellQuote(node)} ${shellQuote(cli)} ${sub}${brain && sub === "capture" ? ` --brain ${shellQuote(brain)}` : ""}`;
}

const OUR_HOOK = /brainium(\.mjs)?"?\s+(capture|session-start)\b/;

function setHooks(settings, enabled, node, cli, brain = "") {
  const hooks = { ...(settings.hooks || {}) };
  for (const event of ["SessionEnd", "SessionStart"]) {
    const groups = (hooks[event] || [])
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !OUR_HOOK.test(String(h.command || ""))) }))
      .filter((g) => g.hooks.length > 0);
    if (enabled) {
      const sub = event === "SessionEnd" ? "capture" : "session-start";
      groups.push({ hooks: [{ type: "command", command: hookCommand(node, cli, sub, brain), timeout: 30 }] });
    }
    if (groups.length) hooks[event] = groups;
    else delete hooks[event];
  }
  const next = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** .claude.json for a Claude Code config dir (in $HOME for the default ~/.claude). */
export function claudeStateFile(configDir, { system = false, env = process.env } = {}) {
  if (system && !env.CLAUDE_CONFIG_DIR) return join(homedir(), ".claude.json");
  return join(configDir, ".claude.json");
}

function setMcp(file, enabled, entry) {
  const json = readJsonObject(file);
  const servers = { ...(json.mcpServers || {}) };
  const before = JSON.stringify(servers.brainium || null);
  if (enabled) servers.brainium = entry;
  else delete servers.brainium;
  if (before === JSON.stringify(servers.brainium || null) && existsSync(file)) return false;
  const next = { ...json, mcpServers: servers };
  if (!enabled && Object.keys(servers).length === 0) delete next.mcpServers;
  writeJsonAtomic(file, next);
  return true;
}

/**
 * Wire (or with enabled=false, unwire) one profile.
 * opts: { app, profileDir, system, capture, personalBrain, brain, brainPath, node, cli, cursorHome, env }
 * `brain` names the brain this profile uses by default (personal when empty).
 */
export function wire(opts, enabled = true) {
  const { app, system = false, capture = false } = opts;
  const node = opts.node || process.execPath;
  const cli = opts.cli || CLI_PATH;
  const env = opts.env || process.env;
  const changed = [];
  if (!APPS.includes(app)) throw new Error(`app must be one of: ${APPS.join(", ")}`);
  const personal = resolve(opts.personalBrain || join(homedir(), "Brainium"));
  const brain = opts.brain && opts.brain !== "personal" ? opts.brain : "";
  const brainLabel = brain ? `${brain} (${opts.brainPath || "see brain_info"})` : `personal (${personal})`;
  const entry = mcpEntry(node, cli, brain);
  const vars = { PERSONAL_BRAIN: personal, BRAIN: brainLabel };

  if (app === "claude-code") {
    const dir = resolve(opts.profileDir || join(homedir(), ".claude"));
    const skill = join(dir, "skills", "brainium", "SKILL.md");
    if (enabled) {
      const text = template("claude-skill.md", vars);
      if (!existsSync(skill) || readFileSync(skill, "utf8") !== text) {
        writeFileAtomic(skill, text);
        changed.push(skill);
      }
    } else if (existsSync(skill) && readFileSync(skill, "utf8").includes("managed by `brainium wire`")) {
      rmSync(join(dir, "skills", "brainium"), { recursive: true, force: true });
      changed.push(skill);
    }
    const claudeMd = join(dir, "CLAUDE.md");
    const old = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : "";
    const next = enabled
      ? upsertManagedBlock(old, template("claude-block.md", vars))
      : removeManagedBlock(old);
    if (next !== old) {
      if (!enabled && next.trim() === "") rmSync(claudeMd, { force: true });
      else writeFileAtomic(claudeMd, next);
      changed.push(claudeMd);
    }
    const state = claudeStateFile(dir, { system, env });
    if (setMcp(state, enabled, entry)) changed.push(state);
    const settingsFile = join(dir, "settings.json");
    const settings = readJsonObject(settingsFile);
    const nextSettings = setHooks(settings, enabled && capture, node, cli, brain);
    if (JSON.stringify(nextSettings) !== JSON.stringify(settings)) {
      writeJsonAtomic(settingsFile, nextSettings);
      changed.push(settingsFile);
    }
    return { app, changed, notes: enabled && !capture ? ["Session capture is off for this profile."] : [] };
  }

  if (app === "claude-desktop") {
    const file = join(resolve(opts.profileDir), "claude_desktop_config.json");
    if (setMcp(file, enabled, entry)) changed.push(file);
    return { app, changed, notes: ["Restart Claude Desktop for MCP changes to apply."] };
  }

  if (app === "cursor") {
    // Cursor reads one mcp.json for every profile, so it always uses the
    // default brain; agents can still name a brain on each call.
    const file = join(opts.cursorHome || join(homedir(), ".cursor"), "mcp.json");
    if (setMcp(file, enabled, mcpEntry(node, cli))) changed.push(file);
    return {
      app,
      changed,
      notes: ["Cursor reads ~/.cursor/mcp.json for every profile. For always-on logging rules, also run scripts/install.sh --cursor in each repo."],
    };
  }

  // grok-bot: the agent runs on xAI's cloud; nothing local to wire.
  return { app, changed, notes: [], snippet: enabled ? grokSnippet(opts.brainPath || personal) : "" };
}

/** Instructions for a Grok Bot agent, which reaches the brain through its GitHub connector. */
export function grokSnippet(brainPath, agentName = "") {
  const remote = remoteUrl(brainPath);
  return template("grok-snippet.md", {
    REMOTE: remote ? `\`${remote}\`` : "`<this brain's GitHub repo — add a remote first>`",
    AGENT_NAME: agentName || "<this agent's name>",
    AGENT_SLUG: agentName ? slugify(agentName) : "<this-agent>",
  });
}

/** Lines to add to any agent's instructions (a Claude Code subagent, a Desktop project…) so it uses its own folder. */
export function agentSnippet(agentName, brain = "") {
  if (!agentName) throw new Error("--agent NAME is required");
  return template("agent-snippet.md", {
    AGENT_NAME: agentName,
    BRAIN_CLAUSE: brain && brain !== "personal" ? ` in the "${brain}" brain` : "",
    BRAIN_ARG: brain && brain !== "personal" ? ` and \`brain: "${brain}"\`` : "",
  });
}
