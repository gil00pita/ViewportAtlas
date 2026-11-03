import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve, delimiter } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

test("companion queues a flow's captured screens while analysis runs and preserves each screen context", { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-flow-service-"));
  const reserved = createServer();
  await new Promise((done) => reserved.listen(0, "127.0.0.1", done));
  const port = reserved.address().port;
  await new Promise((done) => reserved.close(done));
  const base = `http://127.0.0.1:${port}`;
  const release = join(root, "release-analysis");
  let child;
  try {
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "codex"), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'exec') { console.log('Codex test fixture'); process.exit(0); }
process.stdin.resume();
const timer = setInterval(() => {
  if (!fs.existsSync(process.env.ATLAS_FLOW_TEST_RELEASE)) return;
  clearInterval(timer);
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({summary:'Fixture analysis complete',findings:[]}));
}, 30);
`, { mode: 0o700 });
    child = spawn(process.execPath, [resolve("companion/server.mjs")], {
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, ATLAS_PORT: String(port), ATLAS_STATE_DIR: join(root, "state"), ATLAS_OUTPUT_DIR: join(root, "output"), ATLAS_FLOW_TEST_RELEASE: release, ATLAS_CODEX_MODEL: "fixture" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
      await new Promise((done) => setTimeout(done, 30));
    }
    const request = (body) => fetch(`${base}/api/runs`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const png = await sharp({ create: { width: 400, height: 320, channels: 3, background: "white" } }).png().toBuffer();
    const devices = [{ id: "desktop", name: "Desktop", width: 400, height: 320, mobile: false }];
    const payload = { url: "https://example.com/", devices,
      profile: { name: "Queue regression", categories: ["UX / UI"], devices: ["desktop"], prompt: "Fixture", ai: true, fullPage: false, masks: "[data-sensitive]", exportPdf: false },
      snapshots: [{ deviceId: "desktop", png: png.toString("base64"), width: 400, height: 320, metadata: { url: "https://example.com/", title: "Screen", h1: 1, links: [], headings: [], timing: [], state: {} }, conditions: { deviceScaleFactor: 1 } }],
      flow: { batchId: "test-flow", planName: "Browse", screenName: "First screen", screenIndex: 0 } };
    const firstResponse = await request(payload);
    assert.equal(firstResponse.status, 202);
    const first = await firstResponse.json();
    let analyzing;
    for (let i = 0; i < 100; i++) {
      analyzing = await (await fetch(`${base}/api/runs/${first.id}`)).json();
      if (analyzing.progress.includes("Analyzing")) break;
      await new Promise((done) => setTimeout(done, 30));
    }
    assert.equal(analyzing.status, "running");
    assert(analyzing.progress.includes("Analyzing"));
    const secondResponse = await request({ ...payload, flow: { ...payload.flow, screenName: "Second screen", screenIndex: 1 } });
    assert.equal(secondResponse.status, 202, await secondResponse.clone().text());
    const second = await secondResponse.json();
    assert.equal((await (await fetch(`${base}/api/runs/${first.id}`)).json()).status, "running");
    assert.equal((await request(payload)).status, 400, "Duplicate flow screens are rejected");
    assert.equal((await request({ ...payload, flow: undefined })).status, 400, "A separate audit cannot overwrite the active flow");
    assert.equal((await request({ ...payload, flow: { ...payload.flow, batchId: "other-flow" } })).status, 400);
    assert.equal((await request({ ...payload, snapshots: undefined })).status, 400);
    await writeFile(release, "continue");
    for (const run of [first, second]) {
      let result;
      for (let i = 0; i < 100; i++) {
        result = await (await fetch(`${base}/api/runs/${run.id}`)).json();
        if (result.status !== "running") break;
        await new Promise((done) => setTimeout(done, 30));
      }
      assert.equal(result.status, "completed", JSON.stringify(result.checks));
      assert.equal(result.flow.batchId, "test-flow");
      const stored = JSON.parse(await readFile(join(root, "output", run.id, "metadata.json"), "utf8"));
      assert.deepEqual(stored.flow, run.flow);
    }
  } finally {
    await writeFile(release, "continue");
    if (child && child.exitCode === null) {
      const stopped = new Promise((done) => child.once("exit", done));
      child.kill("SIGTERM"); await stopped;
    }
    await rm(root, { recursive: true, force: true });
  }
});
