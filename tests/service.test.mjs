import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
test("HTTP audit lifecycle serves PDF and evidence from a hidden destination, blocks cross-site requests, and restores history", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-service-"));
  const fixture = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html lang="en"><head><title>Service fixture</title><meta name="description" content="Service test"></head><body><h1>Real evidence</h1><p>Locally captured.</p></body></html>',
    );
  });
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const portServer = createServer();
  await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
  const port = portServer.address().port;
  await new Promise((r) => portServer.close(r));
  const base = `http://127.0.0.1:${port}`;
  let child;
  const start = async () => {
    child = spawn(process.execPath, [resolve("companion/server.mjs")], {
      env: {
        ...process.env,
        ATLAS_PORT: String(port),
        ATLAS_STATE_DIR: join(root, "state"),
        ATLAS_OUTPUT_DIR: join(root, ".hidden-output"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("Service did not start");
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exit = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exit;
  };
  const call = async (path, body) => {
    const r = await fetch(base + "/api" + path, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    assert(r.ok, JSON.stringify(data));
    return data;
  };
  try {
    await start();
    const devices = [
      {
        id: "desktop",
        name: "Desktop",
        width: 1280,
        height: 800,
        mobile: false,
      },
    ];
    const url = `http://127.0.0.1:${fixture.address().port}`;
    await call("/views", { url, devices });
    const profile = {
      id: "service",
      name: "Service audit",
      prompt: "Review current page",
      categories: ["SEO"],
      devices: ["desktop"],
      ai: false,
      fullPage: false,
      masks: "[data-sensitive]",
      outputFolder: "",
      exportPdf: true,
    };
    let run = await call("/runs", { url, devices, profile });
    for (let i = 0; i < 100 && run.status === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      run = await (await fetch(`${base}/api/runs/${run.id}`)).json();
    }
    assert.equal(run.status, "completed");
    const pdf = await fetch(`${base}/api/runs/${run.id}/report.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
    const image = await fetch(base + run.screenshots[0].path);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/png");
    const rejected = await fetch(base + "/api/views", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, devices }),
    });
    assert.equal(rejected.status, 403);
    const crossSite = await fetch(base + "/api/runs", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);
    await stop();
    await start();
    const history = await (await fetch(base + "/api/runs")).json();
    assert(history.some((r) => r.id === run.id && r.status === "completed"));
  } finally {
    await stop();
    await new Promise((r) => fixture.close(r));
    await rm(root, { recursive: true, force: true });
  }
});
