// `brainium scheduler install|uninstall|status`: run `brainium routines tick`
// every minute with the OS scheduler, so routines run even when Prism isn't
// open.
//
//   macOS    ~/Library/LaunchAgents/com.mojolayers.brainium.routines.plist
//   Linux    ~/.config/systemd/user/brainium-routines.{service,timer}
//   Windows  Task Scheduler task "Brainium routines"
//
// Each tick is quick: due routines are started as their own processes.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLI_PATH } from "./wire.mjs";
import { richPath } from "./routines.mjs";
import { writeFileAtomic } from "./fsutil.mjs";

export const LABEL = "com.mojolayers.brainium.routines";
const UNIT = "brainium-routines";
const TASK = "Brainium routines";

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function quiet(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }) };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message) };
  }
}

export function plistPath(home = homedir()) {
  return join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
}

/** The launchd job: tick every 60 s and at login, with a PATH that finds node, git and the agent CLIs. */
export function launchdPlist({ node = process.execPath, cli = CLI_PATH, env = process.env, logDir } = {}) {
  const vars = { PATH: richPath(env), HOME: env.HOME || homedir() };
  if (env.BRAINIUM_CONFIG) vars.BRAINIUM_CONFIG = env.BRAINIUM_CONFIG;
  const log = join(logDir, "scheduler.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(cli)}</string>
    <string>routines</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(vars).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>`).join("\n")}
  </dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function systemdFiles({ node = process.execPath, cli = CLI_PATH, env = process.env } = {}) {
  const q = (s) => `"${String(s).replace(/(["\\])/g, "\\$1")}"`;
  const extraEnv = env.BRAINIUM_CONFIG ? `Environment=BRAINIUM_CONFIG=${q(env.BRAINIUM_CONFIG)}\n` : "";
  return {
    service: `[Unit]
Description=Brainium routines tick

[Service]
Type=oneshot
Environment=PATH=${q(richPath(env))}
${extraEnv}ExecStart=${q(node)} ${q(cli)} routines tick
`,
    timer: `[Unit]
Description=Run Brainium routines every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
`,
  };
}

function systemdDir(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user");
}

export function status({ env = process.env } = {}) {
  if (process.platform === "darwin") {
    const file = plistPath();
    const installed = existsSync(file);
    const uid = process.getuid ? process.getuid() : 0;
    const loaded = installed && quiet("launchctl", ["print", `gui/${uid}/${LABEL}`]).ok;
    return { platform: "macos", installed, loaded, file };
  }
  if (process.platform === "linux") {
    const dir = systemdDir(env);
    const installed = existsSync(join(dir, `${UNIT}.timer`));
    const active = installed && quiet("systemctl", ["--user", "is-active", `${UNIT}.timer`]).out.trim() === "active";
    return { platform: "linux", installed, loaded: active, file: join(dir, `${UNIT}.timer`) };
  }
  if (process.platform === "win32") {
    const q = quiet("schtasks", ["/Query", "/TN", TASK]);
    return { platform: "windows", installed: q.ok, loaded: q.ok, file: TASK };
  }
  return { platform: process.platform, installed: false, loaded: false, file: null, unsupported: true };
}

export function install({ env = process.env, rawStore } = {}) {
  if (process.platform === "darwin") {
    const file = plistPath();
    writeFileAtomic(file, launchdPlist({ env, logDir: join(rawStore, "routines") }));
    const uid = process.getuid ? process.getuid() : 0;
    quiet("launchctl", ["bootout", `gui/${uid}/${LABEL}`]); // reload if it was there
    const r = quiet("launchctl", ["bootstrap", `gui/${uid}`, file]);
    if (!r.ok && !/already|5:/i.test(r.out)) throw new Error(`launchctl bootstrap failed: ${r.out.trim()}`);
    return status({ env });
  }
  if (process.platform === "linux") {
    const dir = systemdDir(env);
    const files = systemdFiles({ env });
    writeFileAtomic(join(dir, `${UNIT}.service`), files.service);
    writeFileAtomic(join(dir, `${UNIT}.timer`), files.timer);
    quiet("systemctl", ["--user", "daemon-reload"]);
    const r = quiet("systemctl", ["--user", "enable", "--now", `${UNIT}.timer`]);
    if (!r.ok) throw new Error(`systemctl --user enable failed: ${r.out.trim()} (is systemd running for your user?)`);
    return status({ env });
  }
  if (process.platform === "win32") {
    const tr = `"${process.execPath}" "${CLI_PATH}" routines tick`;
    const r = quiet("schtasks", ["/Create", "/F", "/SC", "MINUTE", "/MO", "1", "/TN", TASK, "/TR", tr]);
    if (!r.ok) throw new Error(`schtasks failed: ${r.out.trim()}`);
    return status({ env });
  }
  throw new Error(`no OS scheduler support on ${process.platform}; use Prism's scheduler or cron: * * * * * node ${CLI_PATH} routines tick`);
}

export function uninstall({ env = process.env } = {}) {
  if (process.platform === "darwin") {
    const uid = process.getuid ? process.getuid() : 0;
    quiet("launchctl", ["bootout", `gui/${uid}/${LABEL}`]);
    rmSync(plistPath(), { force: true });
  } else if (process.platform === "linux") {
    quiet("systemctl", ["--user", "disable", "--now", `${UNIT}.timer`]);
    const dir = systemdDir(env);
    rmSync(join(dir, `${UNIT}.timer`), { force: true });
    rmSync(join(dir, `${UNIT}.service`), { force: true });
    quiet("systemctl", ["--user", "daemon-reload"]);
  } else if (process.platform === "win32") {
    quiet("schtasks", ["/Delete", "/F", "/TN", TASK]);
  }
  return status({ env });
}

/** Whether an installed job points at this node + CLI (a moved install needs reinstalling). */
export function isCurrent({ env = process.env } = {}) {
  if (process.platform === "darwin" && existsSync(plistPath())) {
    const text = readFileSync(plistPath(), "utf8");
    return text.includes(xml(process.execPath)) && text.includes(xml(CLI_PATH));
  }
  if (process.platform === "linux") {
    const file = join(systemdDir(env), `${UNIT}.service`);
    if (!existsSync(file)) return false;
    const text = readFileSync(file, "utf8");
    return text.includes(process.execPath) && text.includes(CLI_PATH);
  }
  return status({ env }).installed;
}

