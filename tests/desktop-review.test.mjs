import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReviewStore, validatePreference } from "../desktop/review-store.mjs";
import { ReviewWorkspace } from "../desktop/review-workspace.mjs";
import { newRun } from "../companion/core.mjs";

const devices = [{ id: "phone", name: "Phone", width: 393, height: 852, mobile: true }];
const profile = { id: "general", name: "Review", prompt: "Review", categories: ["Accessibility"], devices: ["phone"], ai: false, fullPage: true, masks: "", exportPdf: false };

test("desktop preferences and report history survive restart; interrupted work retains evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-review-"));
  try {
    const store = await new ReviewStore(join(root, "state")).open();
    await Promise.all([
      store.setPreference("atlas-devices", devices),
      store.setPreference("atlas-profiles", [profile]),
      store.setPreference("atlas-theme", "dark"),
    ]);
    const run = newRun("https://example.com", devices, profile);
    run.screenshots = [{ deviceId: "phone", path: `/evidence/${run.id}/screenshots/phone.png`, width: 393, height: 852 }];
    await store.register(run, join(root, "report"));
    const restored = await new ReviewStore(join(root, "state")).open();
    assert.deepEqual(restored.preferences["atlas-devices"], devices);
    assert.deepEqual(restored.preferences["atlas-profiles"], [profile]);
    assert.equal(restored.preferences["atlas-theme"], "dark");
    assert.equal(restored.get(run.id).status, "failed");
    assert.match(restored.get(run.id).error, /stopped during this audit/);
    assert.equal(restored.get(run.id).screenshots.length, 1);
    assert.equal(JSON.parse(await readFile(join(root, "report", "run.json"))).status, "failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("desktop preference validation rejects malformed devices and unsupported operations", async () => {
  assert.throws(() => validatePreference("arbitrary-key", true), /Unsupported/);
  assert.throws(() => validatePreference("atlas-devices", [...devices, ...devices]), /unique IDs/);
  assert.throws(() => validatePreference("atlas-profiles", [{ ...profile, ai: "yes" }]), /Invalid audit profile/);
  assert.throws(() => validatePreference("atlas-audit-mode", "unsupported"), /Invalid audit mode/);
  const review = new ReviewWorkspace({});
  await assert.rejects(review.request("/evaluate", "POST", { javascript: "process.exit()" }), /not available/);
  await assert.rejects(review.request("/runs", "DELETE"), /Invalid review operation/);
});
