// The app strip: the registry names the repo's ports; the page links a running app, else lists them.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { registeredPorts } from "../scripts/lib/app.mjs";
import { normalize } from "../scripts/lib/normalize.mjs";
import { render } from "../scripts/lib/render.mjs";

const REGISTRY = `| Port | Service | Source of truth | Notes |
|------|---------|-----------------|-------|
| 9101 | demo-app (app) (backend) | claimed |
| 9102 | demo-app (state Postgres) (backend) | claimed |
| 9105 | demo-app (build-status page) (backend) | claimed |
| ~~9107~~ | **RELEASED** — was demo-app db | released |
| 6201 | demo-app (vite dev) (frontend) | claimed |
| 6202 | demo-app-two web | claimed |
| 9180 | other-repo api | \`other-repo/cmd\` |`;

test("registered ports come from the registry; the page links a running app, else lists the ports", () => {
  const rows = registeredPorts("demo-app", REGISTRY, new Set(["demo-app-two"]));
  assert.deepEqual(rows.map((r) => r.port), [9101, 9102, 6201]);
  assert.equal(rows[2].label, "demo-app (vite dev)");

  const page = (ports) => render(normalize({ steps: [] }), { title: "t", app: { ports } }).html;
  const up = page([{ port: 6201, label: "web", up: true, web: true, url: "http://localhost:6201/" }, { port: 9102, label: "Postgres", up: false, url: null }]);
  assert.match(up, /<a class="app-link web app-primary" href="http:\/\/localhost:6201\/" target="_blank" rel="noopener"/);
  assert.doesNotMatch(up, /href="[^"]*9102/); // a non-HTTP port is never a link
  assert.match(up, /Running/);
  const down = page([{ port: 6201, label: "web", up: false, web: true, url: "http://localhost:6201/" }]);
  assert.doesNotMatch(down, /<a class="app-link/);
  assert.match(down, /Not running[\s\S]*:6201/);
  assert.match(page([]), /no ports registered for this repo/);
});

test("many down ports fold behind a details and web/api pairs share one group", () => {
  const names = ["landing web", "landing", "portal web", "portal api", "admin web", "admin api"];
  const ports = names.map((short, i) => ({ port: 5200 + i, label: short, short, registered: true, up: false, web: /web/.test(short), url: `http://localhost:${5200 + i}/` }));
  const html = render(normalize({ steps: [] }), { title: "t", app: { ports } }).html;
  assert.match(html, /<details class="app-more"><summary>6 registered ports<\/summary>/);
  assert.equal(html.match(/class="app-grp"/g).length, 3);
  assert.match(html, /<span class="app-label">landing<\/span><span class="app-pp"[^>]*>web <span class="app-port">:5200<\/span><\/span><span class="app-pp"[^>]*><span class="app-port">:5201/);
});

test("a service name whose suffix the matcher can't strip still ends the scan", () => {
  // `repo_x` and `repository` once spun the prefix-stripping loop forever; run it in a child so a
  // regression fails on the timeout instead of hanging the test run.
  const src = `import { registeredPorts } from ${JSON.stringify(new URL("../scripts/lib/app.mjs", import.meta.url).href)};
    const text = "| 5000 | repo_x api | claimed |\\n| 5001 | repository web | claimed |\\n| 5002 | repo-web | claimed |\\n| 5003 | repo.x_y | claimed |";
    console.log(JSON.stringify(registeredPorts("repo", text, new Set(["repo-other"])).map((r) => r.port)));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  assert.equal(r.signal, null, "registeredPorts did not return within 5s");
  assert.deepEqual(JSON.parse(r.stdout), [5000, 5002, 5003]);
});
