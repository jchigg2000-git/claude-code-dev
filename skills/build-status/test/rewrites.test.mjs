// The comment box's Improve and Enrich: the page queues the owner's draft, `comments --wait` wakes
// the keeper, `rewrite` records its result, and the page offers it beside the box until the owner
// uses or dismisses it. None of it becomes a comment.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { normalize } from "../scripts/lib/normalize.mjs";
import { render } from "../scripts/lib/render.mjs";
import { http, portOf, sandbox, urlFrom } from "./helpers.mjs";

const sandboxes = [];
after(() => sandboxes.forEach((s) => s.cleanup()));

test("Improve queues the draft, wakes the watcher, and the keeper's rewrite is offered until closed", async () => {
  const sb = sandbox();
  sandboxes.push(sb);
  sb.cli(["init", "--steps-json", '["a"]']);
  const port = portOf(urlFrom(sb.cli(["render"])));
  const origin = `http://127.0.0.1:${port}`;
  const post = (body) =>
    http(port, { method: "POST", path: "/rewrite", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const page = async () => (await http(port, { headers: { host: `127.0.0.1:${port}` } })).body;
  const state = () => JSON.parse(readFileSync(join(sb.repo, ".claude", "build-status.json"), "utf8"));

  assert.match(await page(), /class="crw-btn" data-mode="improve"[^>]*>Improve</);
  assert.equal((await post({ text: "make header teal", mode: "shout" })).status, 400);
  const r = JSON.parse((await post({ text: "make header teal", mode: "improve" })).body);
  assert.equal(r.id, "r1");
  assert.equal(JSON.parse((await post({ text: "make header teal", mode: "improve" })).body).id, "r1", "a double click queues once");
  assert.match(await page(), /data-rid="r1" data-status="pending"/);

  assert.match(sb.cli(["comments", "--wait", "--timeout", "1s"]), /r1 {2}\[improve\] rewrite pending .*"make header teal"/);
  sb.cli(["rewrite", "r1", "--text-file", "-"], { input: "Change the page header to teal (#0f766e).\n" });
  assert.equal(sb.cliStatus(["comments", "--wait", "--timeout", "1s"]).code, 2, "a done rewrite no longer wakes the watcher");
  const html = await page();
  assert.match(html, /Improved by the keeper/);
  assert.match(html, /class="crw-use" data-id="r1" data-result="Change the page header to teal \(#0f766e\)\."/);
  assert.deepEqual(state().comments ?? [], [], "a rewrite is never a comment");

  // A new request supersedes the offer; closing it leaves nothing under the box.
  assert.equal(JSON.parse((await post({ text: "more", mode: "enrich" })).body).id, "r2");
  assert.deepEqual(state().rewrites.map((x) => x.status), ["closed", "pending"]);
  assert.equal(sb.cliStatus(["rewrite", "r1", "late"]).code, 3, "a closed request can't be filled");
  sb.cli(["rewrite", "r2", "--fail", "the draft is only one word"]);
  assert.match(await page(), /The keeper couldn&#39;t enrich it|The keeper couldn't enrich it/);
  assert.equal((await post({ id: "r2", close: true })).status, 200);
  assert.doesNotMatch(await page(), /class="crw /);

  // A request nobody took up for 30 minutes stops waking watchers and says so on the page.
  const old = new Date(Date.now() - 31 * 60e3).toISOString();
  const stale = render(normalize({ rewrites: [{ id: "r9", mode: "improve", text: "x", at: old, status: "pending" }] }), { title: "t", live: true, port: 1 }).html;
  assert.match(stale, /data-status="stale"/);
  assert.match(stale, /not picked up/);
});
