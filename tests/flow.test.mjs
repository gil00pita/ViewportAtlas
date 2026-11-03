import test from "node:test";
import assert from "node:assert/strict";
import { flowUrl, validateFlowContext } from "../companion/flow-contract.mjs";

test("recorded flow addresses retain routes but reject credentials and secret query parameters", () => {
  assert.equal(flowUrl("https://example.com/search?q=shoes#results"), "https://example.com/search?q=shoes#results");
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com?access_token=secret", "https://example.com?code=secret"])
    assert.throws(() => flowUrl(url));
});
test("flow report context has bounded screen names and indices and no extra payload", () => {
  const context = { batchId: "local-batch-1", planName: "Browse products", screenName: "Product details", screenIndex: 0 };
  assert.deepEqual(validateFlowContext({ ...context, ignored: "not retained" }), context);
  for (const invalid of [{ screenIndex: -1 }, { screenIndex: 20 }, { screenIndex: 1.5 }, { screenName: "" }, { screenName: "x".repeat(161) }, { batchId: "../escape" }])
    assert.throws(() => validateFlowContext({ ...context, ...invalid }));
});
