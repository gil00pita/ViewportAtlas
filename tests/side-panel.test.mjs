import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("toolbar delegates open and close to Chrome's native side-panel toggle without a competing click handler", async () => {
  const source = (await readFile(new URL("../extension/background.mjs", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "");
  const calls = [];
  const addListener = () => {};
  const chrome = {
    action: { onClicked: { addListener: () => { calls.push(["click handler"]); } } },
    sidePanel: { setPanelBehavior: async (behavior) => { calls.push(["native toggle", behavior.openPanelOnActionClick]); } },
    storage: { local: { set: async (value) => { calls.push(["store", value.currentUrl]); } } },
    tabs: { create: async () => { calls.push(["tab"]); } },
    debugger: { onEvent: { addListener }, onDetach: { addListener } },
    runtime: { onMessage: { addListener }, sendMessage: async (value) => { calls.push(["target", value.url]); } },
  };
  runInNewContext(source, { chrome, URL, browserEvidence: () => {}, createFlowController: () => ({ busy: false }) });
  assert.deepEqual(calls, [["native toggle", true]]);
});
