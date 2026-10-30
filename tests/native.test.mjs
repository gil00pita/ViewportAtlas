import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("native host frames partial input safely and authenticates its loopback requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-native-"));
  await writeFile(join(root, "native-token"), "test-native-token", {
    mode: 0o600,
  });
  const service = createServer((req, res) => {
    assert.equal(req.headers["x-atlas-token"], "test-native-token");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ connected: true }));
  });
  await new Promise((r) => service.listen(0, "127.0.0.1", r));
  const child = spawn(
    process.execPath,
    [resolve("companion/native-host.mjs")],
    {
      env: {
        ...process.env,
        ATLAS_STATE_DIR: root,
        ATLAS_PORT: String(service.address().port),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  try {
    const message = Buffer.from(
      JSON.stringify({ id: "correlation-id", path: "/health" }),
    );
    const length = Buffer.alloc(4);
    length.writeUInt32LE(message.length);
    const response = new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(
        () => reject(new Error("Native host timed out")),
        10000,
      );
      child.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
          clearTimeout(timeout);
          resolve(JSON.parse(buffer.subarray(4, buffer.readUInt32LE(0) + 4)));
        }
      });
      child.on("error", reject);
    });
    child.stdin.write(length.subarray(0, 2));
    child.stdin.write(
      Buffer.concat([length.subarray(2), message.subarray(0, 5)]),
    );
    child.stdin.write(message.subarray(5));
    const result = await response;
    assert.equal(result.id, "correlation-id");
    assert.equal(result.data.connected, true);
  } finally {
    child.kill();
    await new Promise((r) => service.close(r));
    await rm(root, { recursive: true, force: true });
  }
});
