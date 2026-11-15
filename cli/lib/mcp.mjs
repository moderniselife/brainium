// Brainium MCP server: stdio, newline-delimited JSON-RPC 2.0, zero deps.
// Exposes the brain (search/read/list/log), agent cards, and the pending
// session captures so the user's own AI can file them — no extra AI calls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig, resolvedSummarizer } from "./config.mjs";
import { brainRoots, listFolder, logEntry, readEntry, saveAgentCard, search, KINDS } from "./brain.mjs";
import { getPending, listPending, resolvePending } from "./capture.mjs";
import { slugify } from "./fsutil.mjs";
import { PKG_ROOT } from "./personal.mjs";

const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version;
const INSTRUCTIONS = readFileSync(join(PKG_ROOT, "cli", "templates", "mcp-instructions.md"), "utf8").trim();
const PROTOCOL = "2025-06-18";

const str = (description) => ({ type: "string", description });
const project = str("Optional path inside the project whose docs/brainium to use (defaults to the server's working directory).");

export const TOOLS = [
  {
    name: "brain_search",
    description: "Search the personal and project brains (all terms must match). Use before work when prior context, decisions or past incidents could matter.",
    inputSchema: { type: "object", properties: { query: str("Words to find"), scope: { type: "string", enum: ["all", "personal", "project"] }, limit: { type: "integer", minimum: 1, maximum: 50 }, project }, required: ["query"] },
  },
  {
    name: "brain_read",
    description: 'Read one brain file, e.g. "personal:agents/researcher.md" or "project:learnings/2026-11-16-x.md".',
    inputSchema: { type: "object", properties: { path: str("personal:… or project:… path"), project }, required: ["path"] },
  },
  {
    name: "brain_list",
    description: "List a brain folder's entries with their title and TLDR (sessions, learnings, failures, memories, questions, improvements, decisions, agents).",
    inputSchema: { type: "object", properties: { folder: str("Folder name"), scope: { type: "string", enum: ["auto", "personal", "project"] }, project }, required: ["folder"] },
  },
  {
    name: "brain_log",
    description: "Write to the brain without being asked: kind 'session' appends today's session file; other kinds create a dated entry and index it. scope 'auto' uses the project brain when there is one. Never include secrets.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: Object.keys(KINDS) },
        title: str("One-line topic"),
        body: str("Markdown body (sessions: What we did / Learnings / Mistakes / Open threads / Artifacts)"),
        tags: str("Optional tags for indexes"),
        scope: { type: "string", enum: ["auto", "personal", "project"] },
        project,
      },
      required: ["kind", "title", "body"],
    },
  },
  {
    name: "agent_card_save",
    description: "Create or update an agent card in the personal brain so the agent can be recreated on any app or account: verbatim instructions, tools/connectors by name (never credentials), knowledge, recreate steps, and a Grok Bot template link if any.",
    inputSchema: {
      type: "object",
      properties: {
        name: str("Agent name"), apps: str("Where it lives, e.g. 'Grok Bot, Claude Code'"), tldr: str("What it is for"),
        instructions: str("Its instructions / system prompt, verbatim"), tools: str("Tools and connectors by name"),
        knowledge: str("Brain links it depends on"), recreate: str("Steps to rebuild it"), template_link: str("Grok Bot template share link"),
      },
      required: ["name", "instructions"],
    },
  },
  {
    name: "agent_card_get",
    description: "Read an agent card by name (to recreate an agent on a new account or app).",
    inputSchema: { type: "object", properties: { name: str("Agent name") }, required: ["name"] },
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
      properties: { id: str("Pending capture id"), title: str("One-line topic"), body: str("Markdown entry body"), scope: { type: "string", enum: ["auto", "personal", "project"] } },
      required: ["id", "body"],
    },
  },
  {
    name: "brain_info",
    description: "Where the brains are, the summarizer in use, and how many captures are waiting.",
    inputSchema: { type: "object", properties: { project } },
  },
];

const json = (v) => JSON.stringify(v, null, 2);

export async function callTool(name, args = {}, { cwd = process.cwd(), env = process.env } = {}) {
  const config = loadConfig(env);
  const roots = () => brainRoots(config, args.project || env.BRAINIUM_PROJECT || cwd);
  switch (name) {
    case "brain_search": {
      const hits = search(roots(), args.query, { scope: args.scope || "all", limit: args.limit || 20 });
      return hits.length ? json(hits) : "No matches.";
    }
    case "brain_read":
      return readEntry(roots(), args.path);
    case "brain_list":
      return json(listFolder(roots(), args.folder, { scope: args.scope || "auto" }));
    case "brain_log": {
      const r = logEntry(roots(), config, { kind: args.kind, title: args.title, body: args.body, tags: args.tags || "", scope: args.scope || "auto" });
      return `Logged to ${r.path} (git: ${r.commit})${r.redacted ? " — secrets were redacted" : ""}.`;
    }
    case "agent_card_save": {
      const r = saveAgentCard(roots(), config, { ...args, templateLink: args.template_link });
      return `${r.created ? "Created" : "Updated"} ${r.path} (git: ${r.commit}).`;
    }
    case "agent_card_get":
      return readEntry(roots(), `personal:agents/${slugify(args.name)}.md`);
    case "brain_pending": {
      const items = listPending(config).map(({ id, topic, cwd: c, endedAt, projectBrain, attempts, lastError }) =>
        ({ id, topic, cwd: c, endedAt, brain: projectBrain ? "project" : "personal", ...(attempts ? { attempts, lastError } : {}) }));
      return items.length ? json(items) : "No captured sessions waiting.";
    }
    case "brain_pending_get": {
      const rec = getPending(config, args.id);
      return `# ${rec.topic}\n\nEnded ${rec.endedAt} · ${rec.cwd}\n\n${rec.digest}`;
    }
    case "brain_resolve": {
      const r = resolvePending(config, args.id, { title: args.title, body: args.body, scope: args.scope || "auto" });
      return `Filed to ${r.path} (git: ${r.commit}).`;
    }
    case "brain_info": {
      const s = resolvedSummarizer(config, env);
      return json({
        version: VERSION,
        brains: roots(),
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
