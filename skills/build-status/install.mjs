#!/usr/bin/env node
// Installs the build-status skill and its stable launcher. Idempotent; prints every action.
//
//   node install.mjs [--skills-dir DIR] [--home DIR] [--commands-dir DIR] [--browser NAME]
//                    [--keep-command] [--dry-run] [--rollback]
//
// - copies SKILL.md, scripts/ and hooks/ to <skills-dir>/build-status (default ~/.claude/skills),
//   with a marker file so --rollback only ever removes what this installed;
// - writes <home>/bin/build-status (default ~/.build-status), the one path agents and hooks call;
// - writes <home>/config.json: keeps what's there, sets installedAt once (answers older than it
//   are never injected into sessions), defaults the browser to Google Chrome on a Mac that has it;
// - moves the old one-file command (<commands-dir>/build-status.md) into <home>/backup, since a
//   skill and a command with one name collide. --rollback puts it back.
// It never touches settings.json (hooks stay opt-in) and never stops a running page server; a
// stale one is replaced on its next `render`.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));
const MARKER = ".build-status-package";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const skillsDir = opt("skills-dir", join(homedir(), ".claude", "skills"));
const home = opt("home", process.env.BUILD_STATUS_HOME || join(homedir(), ".build-status"));
const commandsDir = opt("commands-dir", join(homedir(), ".claude", "commands"));
const dest = join(skillsDir, "build-status");
const dry = flag("dry-run");

const act = (msg, fn) => {
  console.log(`${dry ? "[dry-run] " : ""}${msg}`);
  if (!dry) fn();
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");

if (flag("rollback")) {
  if (existsSync(join(dest, MARKER))) act(`remove ${dest}`, () => rmSync(dest, { recursive: true, force: true }));
  else if (existsSync(dest)) console.log(`${dest} wasn't installed by this package; left alone`);
  const backups = existsSync(join(home, "backup"))
    ? readdirSync(join(home, "backup")).filter((n) => n.startsWith("build-status.command.")).sort()
    : [];
  const target = join(commandsDir, "build-status.md");
  if (backups.length && !existsSync(target)) {
    act(`restore ${target} from backup/${backups.at(-1)}`, () => {
      mkdirSync(commandsDir, { recursive: true });
      renameSync(join(home, "backup", backups.at(-1)), target);
    });
  }
  const launcher = join(home, "bin", "build-status");
  if (existsSync(launcher)) act(`remove ${launcher}`, () => rmSync(launcher));
  process.exit(0);
}

if (existsSync(dest) && !existsSync(join(dest, MARKER)) && realpathSync(SRC) !== realpathSync(dest)) {
  console.error(`${dest} exists and wasn't installed by this package — not overwriting it`);
  process.exit(1);
}

// Run from the installed copy itself (the skill's own "install first" hint): the files are
// already in place, so only the launcher and config are (re)written.
const fromInstalled = existsSync(dest) && realpathSync(SRC) === realpathSync(dest);
if (!fromInstalled) {
  act(`install skill → ${dest}`, () => {
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const part of ["SKILL.md", "install.mjs", "scripts", "hooks"]) cpSync(join(SRC, part), join(dest, part), { recursive: true });
    writeFileSync(join(dest, MARKER), `installed ${new Date().toISOString()} from ${SRC}\n`);
  });
}

const launcher = join(home, "bin", "build-status");
act(`write launcher ${launcher}`, () => {
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(launcher, `#!/bin/sh\nexec node "${join(dest, "scripts", "cli.mjs")}" "$@"\n`);
  chmodSync(launcher, 0o755);
});

const configPath = join(home, "config.json");
let config = {};
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {}
const next = { ...config };
next.installedAt ??= new Date().toISOString();
if (opt("browser")) next.browser = opt("browser");
else if (!("browser" in next) && process.platform === "darwin" && existsSync("/Applications/Google Chrome.app")) next.browser = "Google Chrome";
if (JSON.stringify(next) !== JSON.stringify(config)) {
  act(`write ${configPath}${config.installedAt ? "" : ` (installedAt ${next.installedAt})`}`, () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n");
  });
}

const oldCommand = join(commandsDir, "build-status.md");
if (existsSync(oldCommand) && !flag("keep-command")) {
  const backup = join(home, "backup", `build-status.command.${stamp()}.md`);
  act(`move the old command ${oldCommand} → ${backup} (a skill and a command can't share the name)`, () => {
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(oldCommand, backup);
  });
}
console.log("done. Hooks are not installed; `build-status hooks-snippet` prints them if you want them.");
