// Brainium MCP server: stdio, newline-delimited JSON-RPC 2.0, zero deps.
// Exposes the brains (search/read/list/log/share), agents and their cards,
// routines, and the pending session captures so the user's own AI can file
// them — no extra AI calls. $BRAINIUM_BRAIN picks this profile's brain;
// $BRAINIUM_AGENT names the agent when a routine runs one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, resolvedSummarizer } from "./config.mjs";
import { brainRoots, defaultBrainName, getAgentCard, listAgents, listFolder, logEntry, readEntry, saveAgentCard, search, shareEntry, KINDS } from "./brain.mjs";
import { describe, listRoutines, loadApprovals, loadState, saveRoutine } from "./routines.mjs";
import { getPending, listPending, resolvePending } from "./capture.mjs";
import { getRecord, lintBrain, lintReport, RECORD_TYPES, saveRecord, writeHealth } from "./records.mjs";
import { PKG_ROOT } from "./personal.mjs";

const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
const INSTRUCTIONS = readFileSync(join(PKG_ROOT, "cli", "templates", "mcp-instructions.md"), "utf8").trim();
const PROTOCOL = "2025-06-18";

const str = (description) => ({ type: "string", description });
const project = str("Optional path inside the project whose docs/brainium to use (defaults to the server's working directory).");
const brain = str('Which brain: "auto" (project brain if there is one, else this profile\'s brain), "personal", "project", or a brain name from brain_info.');
const agent = str("Your agent name if you're working as a named agent: your own notes are kept in agents/<name>/ (and searched first).");
const shared = { type: "boolean", description: "With agent: write to (or list) the shared area every agent sees instead of your own folder." };

export const TOOLS = [
  {
    name: "brain_search",
    description: "Search the brains (all terms must match). Covers the project brain, this profile's brain and the personal brain; with agent, your own notes plus the shared area (everyone: true adds other agents' notes). Use before work when prior context, decisions or past incidents could matter.",
    inputSchema: {
      type: "object",
      properties: {
        query: str("Words to find"),
        brain: str('"all" (default), "*" for every brain, or one brain name'),
        agent,
        everyone: { type: "boolean", description: "Also search other agents' own notes" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        project,
      },
      required: ["query"],
    },
  },
  {
    name: "brain_read",
    description: 'Read one brain file by its path from a search or listing, e.g. "personal:agents/researcher.md", "project:learnings/2026-11-16-x.md" or "mojo-layers:shared/decisions/x.md".',
    inputSchema: { type: "object", properties: { path: str("brain:path/in/brain.md"), project }, required: ["path"] },
  },
  {
    name: "brain_list",
    description: "List a folder's entries with their title and TLDR (sessions, learnings, failures, memories, questions, improvements, decisions, agents). With agent, your own folder; shared: true for the shared area.",
    inputSchema: { type: "object", properties: { folder: str("Folder name"), brain, agent, shared, project }, required: ["folder"] },
  },
  {
    name: "brain_log",
    description: "Write to the brain without being asked: kind 'session' appends today's session file; other kinds create a dated entry and index it. brain 'auto' uses the project brain when there is one, else this profile's brain. With agent the entry goes to your own folder unless shared: true. Never include secrets.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: Object.keys(KINDS) },
        title: str("One-line topic"),
        body: str("Markdown body (sessions: What we did / Learnings / Mistakes / Open threads / Artifacts)"),
        tags: str("Optional tags for indexes"),
        brain,
        agent,
        shared,
        project,
      },
      required: ["kind", "title", "body"],
    },
  },
  {
    name: "brain_share",
    description: "Move one of an agent's own notes into the brain's shared area so every agent sees it.",
    inputSchema: { type: "object", properties: { path: str('The note, e.g. "mojo-layers:agents/researcher/learnings/2026-11-17-x.md"'), project }, required: ["path"] },
  },
  {
    name: "agent_list",
    description: "The agents in a brain (or every brain): name, what they're for, their card and folder.",
    inputSchema: { type: "object", properties: { brain: str('A brain name, or "all" (default)') } },
  },
  {
    name: "agent_card_save",
    description: "Create or update an agent card (agents/<name>/card.md) so the agent can be recreated on any app or account: verbatim instructions, tools/connectors by name (never credentials), knowledge, recreate steps, and a Grok Bot template link if any.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["personal", "factory"], description: "factory: a shared agent many people rely on; keep its prompt versions in prompts/ (one production) and test cases in evals/" },
        team: str("The team it belongs to"),
        maintainers: { type: "array", items: { type: "string" }, description: "Who may change a factory's prompt" },
        name: str("Agent name"), apps: str("Where it lives, e.g. 'Grok Bot, Claude Code'"), tldr: str("What it is for"),
        instructions: str("Its instructions / system prompt, verbatim"), tools: str("Tools and connectors by name"),
        knowledge: str("Brain links it depends on"), recreate: str("Steps to rebuild it"), template_link: str("Grok Bot template share link"),
        brain: str("Which brain keeps the card (default: this profile's brain)"),
      },
      required: ["name", "instructions"],
    },
  },
  {
    name: "agent_card_get",
    description: "Read an agent card by name (to recreate an agent on a new account or app).",
    inputSchema: { type: "object", properties: { name: str("Agent name"), brain: str("Look in this brain first") }, required: ["name"] },
  },
  {
    name: "routine_list",
    description: "Scheduled routines in the brains: schedule, type, agent, whether they're enabled and approved on this machine, next and last run.",
    inputSchema: { type: "object", properties: { brain: str("Only this brain") } },
  },
  {
    name: "routine_save",
    description: "Create or replace a routine (routines/<name>.md). It's saved disabled and unapproved: the user turns it on and approves it on their machine (Prism → Second brain → Routines). It runs on a schedule, when files matching `on` change, or both. type prompt runs `body` as a prompt through Claude Code or Codex; shell runs `body` as a command; upkeep runs a built-in job (sync, distill, digest, lint). New prompt/shell routines start at stage shadow (propose only); the user moves them to limited, then full.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Routine name"),
        brain: str("Which brain (default: this profile's brain)"),
        schedule: str('Cron "0 8 * * 1-5" (local time), @daily/@hourly/@weekly, or "every 30m". Optional when `on` is given'),
        on: str('Run when brain files matching these globs change, comma-separated, e.g. "shared/messages/*/inbox/**"'),
        stage: { type: "string", enum: ["shadow", "limited", "full"], description: "shadow: propose only; limited: act on at most `limit` items; full. Default shadow for prompt/shell" },
        limit: { type: "number", description: "stage limited: most items per run (default 3)" },
        type: { type: "string", enum: ["prompt", "upkeep", "shell"] },
        agent: str("The agent it runs as; its log goes to that agent's sessions"),
        app: { type: "string", enum: ["claude-code", "codex"] },
        profile: str("prompt: the app profile folder to run in (a Claude Code CLAUDE_CONFIG_DIR, or CODEX_HOME)"),
        cwd: str("Working folder"),
        args: str("Extra CLI arguments, e.g. --permission-mode acceptEdits"),
        timeout: str('Time limit, e.g. "20m"'),
        job: { type: "string", enum: ["sync", "distill", "digest", "lint"] },
        body: str("The prompt (type prompt) or command (type shell)"),
      },
      required: ["name", "type"],
    },
  },
  {
    name: "record_save",
    description: "Create or update a record: one of the things work is about (project, person, team, customer, meeting, document), kept once in the brain's shared area and linked to other records with [[folder/id]] (e.g. [[people/sam]]; the type name, [[person/sam]], also works). Fields merge into what's there; the body is replaced only if given; links are added. Prefer updating the record over writing a new note about the same thing. Never include secrets.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: Object.keys(RECORD_TYPES) },
        id: str("Short stable id, e.g. onboarding-m2 (default: from the title)"),
        title: str("Display title"),
        fields: { type: "object", description: "Frontmatter fields, e.g. { status: \"active\", owner: \"ops\", team: \"qa\", review_by: \"2026-12-31\" }. project needs status+owner, person role, customer status, meeting date, document status" },
        links: { type: "array", items: { type: "string" }, description: 'Records this one relates to: "people/sam", "projects/launch", or "other-brain:projects/x" (saved as Obsidian-style [[wikilinks]])' },
        body: str("Markdown body (replaces the old body)"),
        brain: str("Which brain (default auto)"),
        agent: str("Your agent name (recorded as who last updated it)"),
      },
      required: ["type"],
    },
  },
  {
    name: "record_get",
    description: "Read a record and everything one hop away: the records it links to (title, status, or missing) and the notes and records that link back to it. Use this before searching when you know the project, person, customer or meeting.",
    inputSchema: { type: "object", properties: { ref: str('folder/id, e.g. "projects/launch" or "team-brain:customers/acme" (type/id like "project/launch" also works)'), brain: str("Which brain (default auto)") }, required: ["ref"] },
  },
  {
    name: "brain_lint",
    description: "Check a brain for context rot: unsigned notes in the shared area, records missing required fields, broken [[links]], stale records (live status but untouched for 30 days, or past review_by), misfiled records, and factory agents without one production prompt and some evals. write: true also saves the report as shared/health.md.",
    inputSchema: { type: "object", properties: { brain: str("Which brain (default auto)"), stale_days: { type: "number" }, write: { type: "boolean" } } },
  },
  {
    name: "brain_preflight",
    description: "Call this FIRST, before any other work: brings the project's rules and brain up to date (fast-forward pulls of the repos its .brainium.json lists) and lists the rule files that changed since you last looked. Reread every file it lists and follow the new version. If it reports a repo it couldn't update, say so before relying on that repo.",
    inputSchema: { type: "object", properties: { agent: str("Your agent name (changes are tracked per agent)") } },
  },
  {
    name: "brain_pending",
    description: "List captured sessions waiting to be filed. When any are waiting, read each with brain_pending_get and file it with brain_resolve — you are the summarizer.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "brain_pending_get",
    description: "Read a captured session's redacted digest.",
    inputSchema: { type: "object", properties: { id: str("Pending capture id") }, required: ["id"] },
  },
  {
    name: "brain_resolve",
    description: "File a captured session as a concise session entry (What we did / Learnings / Mistakes / Open threads / Artifacts) and clear it from the queue.",
    inputSchema: {
      type: "object",
      properties: { id: str("Pending capture id"), title: str("One-line topic"), body: str("Markdown entry body"), brain, scope: str("Older name for brain"), agent },
      required: ["id", "body"],
    },
  },
  {
    name: "brain_info",
    description: "Which brains exist (and which one this profile uses by default), their agents and routines, the summarizer in use, and how many captures are waiting.",
    inputSchema: { type: "object", properties: { project } },
  },
];

const json = (v) => JSON.stringify(v, null, 2);

export async function callTool(name, args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const config = loadConfig(env);
  const roots = () => brainRoots(config, args.project || env.BRAINIUM_PROJECT || cwd);
  const defaultBrain = defaultBrainName(config, env);
  // A routine or a wired agent can set its name once for every call.
  const who = args.agent || env.BRAINIUM_AGENT || "";
  const which = args.brain || args.scope;
  switch (name) {
    case "brain_search": {
      const hits = search(roots(), args.query, { brain: which || "all", agent: who, everyone: !!args.everyone, limit: args.limit || 20, defaultBrain });
      return hits.length ? json(hits) : "No matches.";
    }
    case "brain_read":
      return readEntry(roots(), args.path);
    case "brain_list":
      return json(listFolder(roots(), args.folder, { brain: which || "auto", agent: who, shared: !!args.shared, defaultBrain }));
    case "brain_log": {
      const r = logEntry(roots(), config, { kind: args.kind, title: args.title, body: args.body, tags: args.tags || "", brain: which || "auto", agent: who, shared: !!args.shared, defaultBrain });
      return `Logged to ${r.path} (git: ${r.commit})${r.redacted ? " — secrets were redacted" : ""}.`;
    }
    case "brain_share": {
      const r = shareEntry(roots(), config, args.path);
      return `Shared: ${r.from} → ${r.path} (git: ${r.commit}).`;
    }
    case "agent_list": {
      const agents = listAgents(roots(), { brain: args.brain || "all" });
      return agents.length ? json(agents) : "No agents yet. Create one with agent_card_save.";
    }
    case "agent_card_save": {
      const r = saveAgentCard(roots(), config, { ...args, templateLink: args.template_link, brain: args.brain || "auto", defaultBrain: defaultBrain === "project" ? "personal" : defaultBrain });
      return `${r.created ? "Created" : "Updated"} ${r.path} (git: ${r.commit}).`;
    }
    case "agent_card_get":
      return getAgentCard(roots(), args.name, { brain: args.brain, defaultBrain }).text;
    case "routine_list": {
      const state = loadState(env);
      const approvals = loadApprovals(env);
      const items = listRoutines(config, { brain: args.brain }).map((r) => describe(r, state, approvals));
      return items.length ? json(items) : "No routines yet. Create one with routine_save.";
    }
    case "routine_save": {
      const r = saveRoutine(config, { ...args, brain: args.brain || (defaultBrain === "project" ? "personal" : defaultBrain) });
      return `Saved ${r.ref} (${r.file}). It's off until the user turns it on and approves it on their machine.`;
    }
    case "record_save": {
      const r = saveRecord(roots(), config, { type: args.type, id: args.id, title: args.title, fields: args.fields || {}, links: args.links || [], body: args.body, brain: which || "auto", agent: who, defaultBrain });
      return `${r.created ? "Created" : "Updated"} ${r.path} (git: ${r.commit})${r.missing.length ? ` — still missing: ${r.missing.join(", ")}` : ""}.`;
    }
    case "record_get":
      return json(getRecord(roots(), args.ref, { brain: which || "auto", defaultBrain }));
    case "brain_lint": {
      const rs = roots();
      const { pickBrain } = await import("./brain.mjs");
      const name = pickBrain(rs, which || "auto", defaultBrain);
      const opts = { staleDays: args.stale_days || 30 };
      if (args.write) {
        const h = writeHealth(config, name, opts);
        return lintReport(h) + `\n\nSaved to ${h.path} (git: ${h.commit}).`;
      }
      return lintReport(lintBrain(rs, name, opts));
    }
    case "brain_preflight": {
      const { preflight } = await import("./preflight.mjs");
      const r = preflight(config, { cwd: args.project || env.BRAINIUM_PROJECT || cwd, agent: args.agent || env.BRAINIUM_AGENT || "" });
      return r.configured ? r.text : "No preflight set up for this project (no update/rules in .brainium.json). Carry on.";
    }
    case "brain_pending": {
      const items = listPending(config).map(({ id, topic, cwd: c, endedAt, projectBrain, attempts, lastError }) =>
        ({ id, topic, cwd: c, endedAt, brain: projectBrain ? "project" : defaultBrain, ...(attempts ? { attempts, lastError } : {}) }));
      return items.length ? json(items) : "No captured sessions waiting.";
    }
    case "brain_pending_get": {
      const rec = getPending(config, args.id);
      return `# ${rec.topic}\n\nEnded ${rec.endedAt} · ${rec.cwd}\n\n${rec.digest}`;
    }
    case "brain_resolve": {
      const r = resolvePending(config, args.id, { title: args.title, body: args.body, scope: which || "auto", agent: who, defaultBrain });
      return `Filed to ${r.path} (git: ${r.commit}).`;
    }
    case "brain_info": {
      const s = resolvedSummarizer(config, env);
      const r = roots();
      return json({
        version: VERSION,
        defaultBrain,
        agent: who || undefined,
        brains: Object.fromEntries(Object.entries(r).map(([n, path]) => [n, {
          path,
          ...(n === "project" ? {} : { agents: listAgents(r, { brain: n }).map((a) => a.name), routines: listRoutines(config, { brain: n }).length }),
        }])),
        capture: config.capture,
        summarizer: { provider: s.provider, model: s.model || undefined },
        pending: listPending(config).length,
      });
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

export async function handle(msg, ctx = {}) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: params.protocolVersion || PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "brainium", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      try {
        const text = await callTool(params.name, params.arguments || {}, ctx);
        return reply({ content: [{ type: "text", text }] });
      } catch (err) {
        if (err.code === -32602) return fail(-32602, err.message);
        // Tool errors go back to the model as results, so it can recover.
        return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
      }
    default:
      if (id === undefined || id === null) return null; // notification
      return fail(-32601, `Method not found: ${method}`);
  }
}

export function serve({ input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    const res = await handle(msg);
    if (res) output.write(JSON.stringify(res) + "\n");
  });
  return rl;
}
