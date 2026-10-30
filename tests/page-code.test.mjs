import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { collectPageCode } from "../companion/page-code.mjs";
import { codexEvidence } from "../companion/codex-evidence.mjs";
import { validateProfile } from "../companion/core.mjs";
let browser, page;
before(async () => {
  browser = await chromium.launch({ headless: true }); page = await browser.newPage();
  await page.route("https://cdn.example.com/**", (route) => route.abort());
});
after(async () => { await browser?.close(); });

test("page code includes rendered structure and responsive CSS while excluding private and executable payloads", async () => {
  await page.setContent(`<!doctype html><html lang="en"><head><base href="https://example.com/path/"><style>
    .action { display: flex; gap: 12px; color: red; background-image: url('/private?token=CSS_SECRET'); --private: PRIVATE_PROPERTY; }
    @media (max-width: 600px) { .action { flex-direction: column; } }
    @layer controls { .action { min-height: 44px; } }
    @container (max-width: 600px) { .action { gap: 8px; } }
    .action::before { content: "GENERATED_SECRET"; }
    [data-value="SELECTOR_SECRET"] { color: blue; }
  </style><script>window.inlineSecret="INLINE_SECRET";</script><script type="application/json">{"token":"JSON_SECRET"}</script>
  <meta name="csrf-token" content="META_SECRET"></head><body>
    <h1>Rendered heading</h1><button class="action" onclick="alert('HANDLER_SECRET')" data-token="DATA_SECRET">Continue</button>
    <input type="password" value="PASSWORD_SECRET"><input type="hidden" value="HIDDEN_SECRET"><input value="FORM_SECRET">
    <textarea>TEXTAREA_SECRET</textarea><select><option value="OPTION_SECRET">SELECT_SECRET</option></select>
    <div contenteditable="true">EDITABLE_SECRET</div><section class="private"><span>MASK_SECRET</span></section>
    <div data-sensitive aria-label="SENSITIVE_LABEL">SENSITIVE_TEXT</div><!-- COMMENT_SECRET -->
    <a href="https://user:URL_PASSWORD@example.com/next?token=QUERY_SECRET#FRAGMENT_SECRET">Next</a>
    <img alt="Preview" src="data:image/png;base64,IMAGE_SECRET"><iframe srcdoc="FRAME_SECRET"></iframe>
    <script src="https://cdn.example.com/app.js?key=SCRIPT_SECRET"></script>
  </body></html>`);
  const result = await page.evaluate(collectPageCode, { masks: ".private" });
  assert(result.html.includes('<h1>Rendered heading</h1>'));
  assert(result.html.includes('class="action"'));
  assert(result.css.includes("display: flex"));
  assert(result.css.includes("@media (max-width: 600px)"));
  assert(result.css.includes("flex-direction: column"));
  assert(result.css.includes("@layer controls"));
  assert(result.css.includes("min-height: 44px"));
  assert(result.css.includes("@container"));
  assert.deepEqual(result.scriptUrls, ["https://cdn.example.com/app.js"]);
  for (const secret of ["CSS_SECRET", "PRIVATE_PROPERTY", "GENERATED_SECRET", "SELECTOR_SECRET", "INLINE_SECRET", "JSON_SECRET", "META_SECRET", "HANDLER_SECRET", "DATA_SECRET", "PASSWORD_SECRET", "HIDDEN_SECRET", "FORM_SECRET", "TEXTAREA_SECRET", "OPTION_SECRET", "SELECT_SECRET", "EDITABLE_SECRET", "MASK_SECRET", "SENSITIVE_LABEL", "SENSITIVE_TEXT", "COMMENT_SECRET", "URL_PASSWORD", "QUERY_SECRET", "FRAGMENT_SECRET", "IMAGE_SECRET", "FRAME_SECRET", "SCRIPT_SECRET"]) {
    assert(!JSON.stringify(result).includes(secret), secret);
  }
  assert.equal(await page.locator('input[type="password"]').getAttribute("value"), "PASSWORD_SECRET", "Capture must not mutate the inspected page");
  await assert.rejects(page.evaluate(collectPageCode, { masks: "[" }), /not a valid selector|InvalidSelector|SyntaxError/i);
});

test("large code snapshots are bounded and inaccessible stylesheets are reported", async () => {
  await page.setContent(`<body><h1>Large fixture</h1><div>${"Long visible text ".repeat(5000)}</div></body>`);
  await page.evaluate(() => {
    const inaccessible = { href: "https://cdn.example.com/private.css?token=secret", get cssRules() { throw new DOMException("Blocked", "SecurityError"); } };
    Object.defineProperty(document, "adoptedStyleSheets", { configurable: true, value: [inaccessible] });
  });
  const code = await page.evaluate(collectPageCode);
  assert(code.html.length <= 32000 && code.css.length <= 16000);
  assert.equal(code.truncated, true);
  assert.equal(code.unavailableStylesheets, 1);
  assert.deepEqual(code.stylesheets.at(-1), { url: "https://cdn.example.com/private.css", readable: false });
});

test("prompt evidence budgets code fairly across views and omits it unless explicitly enabled", () => {
  const evidence = Array.from({ length: 16 }, (_, index) => ({
    deviceId: `view-${index}`, screenshot: `screenshots/${index}.png`, width: 393, height: 852, deviceScaleFactor: 2,
    metadata: { url: "https://example.com/?token=PRIVATE", title: "Title", headings: Array.from({ length: 50 }, () => ({ text: "x".repeat(200), level: "H2", bounds: { x: 0, y: 0, width: 10, height: 10 } })), links: Array.from({ length: 100 }, () => ({ name: "y".repeat(120), href: "https://example.com/" + "z".repeat(1000) })) },
    pageCode: { html: "<main>" + "h".repeat(31980) + "</main>", css: "c".repeat(16000), scriptUrls: [], scope: "Rendered HTML and CSS", truncated: false, unavailableStylesheets: 0 },
  }));
  const projected = codexEvidence(evidence, true);
  const json = JSON.stringify(projected);
  assert(json.length < 150000);
  assert.equal(JSON.parse(json).length, 16);
  assert(projected.every((entry) => entry.pageCode.html.length > 0 && entry.pageCode.css.length > 0 && entry.pageCode.truncated));
  assert(!json.includes("PRIVATE"));
  assert(codexEvidence(evidence).every((entry) => !("pageCode" in entry)));
  assert.equal(evidence[0].pageCode.truncated, false, "Prompt projection must not mutate saved captures");
});

test("page-code profile option is backwards compatible and must be boolean", () => {
  const profile = { name: "Test", prompt: "", categories: ["UX / UI"], ai: true, fullPage: false, masks: "" };
  assert.equal(validateProfile(profile), profile);
  assert.equal(validateProfile({ ...profile, includePageCode: true }).includePageCode, true);
  assert.throws(() => validateProfile({ ...profile, includePageCode: "yes" }), /Invalid audit profile/);
});
