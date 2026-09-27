// The installer: copies the skill (not the tests), writes the launcher, moves the old command
// aside, keeps installedAt, and rolls all of it back.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLI } from "./helpers.mjs";

test("install, reinstall and rollback", () => {
  const dir = mkdtempSync(join(tmpdir(), "bs-install-"));
  const [skills, home, commands] = ["skills", "home", "commands"].map((d) => join(dir, d));
  mkdirSync(commands);
  writeFileSync(join(commands, "build-status.md"), "# the old command\n");
  const install = (...extra) =>
    execFileSync(process.execPath, [join(CLI, "..", "..", "install.mjs"), "--skills-dir", skills, "--home", home, "--commands-dir", commands, "--browser", "none", ...extra], { encoding: "utf8" });

  install();
  assert.ok(existsSync(join(skills, "build-status", "SKILL.md")));
  assert.ok(!existsSync(join(skills, "build-status", "test")));
  assert.match(execFileSync(join(home, "bin", "build-status"), ["version"], { encoding: "utf8" }), /^[0-9a-f]{12}\n$/);
  assert.ok(!existsSync(join(commands, "build-status.md")));
  assert.equal(readdirSync(join(home, "backup")).length, 1);
  const { installedAt } = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  assert.ok(installedAt);

  install();
  assert.equal(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).installedAt, installedAt);

  install("--rollback");
  assert.ok(!existsSync(join(skills, "build-status")));
  assert.equal(readFileSync(join(commands, "build-status.md"), "utf8"), "# the old command\n");
});
