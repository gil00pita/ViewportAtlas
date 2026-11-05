import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { _electron } from "playwright";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { execFileSafe } from "../companion/codex.mjs";

let electron, window, server, root, url, views;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
async function until(read, expected, message = "Condition did not settle", timeout = 10000) {
  const end = Date.now() + timeout;
  let actual;
  while (Date.now() < end) {
    try { actual = await read(); } catch (error) {
      if (!/Execution context was destroyed|Cannot find context/i.test(error.message)) throw error;
      await new Promise(done => setTimeout(done, 30)); continue;
    }
    if (typeof expected === "function" ? expected(actual) : JSON.stringify(actual) === JSON.stringify(expected)) return actual;
    await new Promise((done) => setTimeout(done, 30));
  }
  assert.fail(`${message}: ${JSON.stringify(actual)}`);
}
async function launch() {
  const executablePath = process.env.ATLAS_DESKTOP_EXECUTABLE;
  const displayScale = process.env.ATLAS_DESKTOP_TEST_SCALE_FACTOR;
  if (displayScale && !['1', '2'].includes(displayScale)) throw new Error('Choose display scale 1 or 2 for desktop tests.');
  const launchArgs = [...(displayScale ? [`--force-device-scale-factor=${displayScale}`] : []), ...(executablePath ? [] : [resolve('desktop/entry.cjs')])];
  const childEnv = { ...env, ATLAS_DESKTOP_STATE_DIR: join(root, "state"), ATLAS_CODEX_EXECUTABLE: join(root, "codex-fixture.cjs"), ATLAS_CODEX_TEST_PROMPT: join(root, "ai-prompt.txt") };
  if (process.env.ATLAS_INSTALLED_SMOKE) childEnv.PATH = process.platform === 'win32' ? `${process.env.SystemRoot}\\system32;${process.env.SystemRoot}` : '/usr/bin:/bin:/usr/sbin:/sbin';
  electron = await _electron.launch({ ...(executablePath ? { executablePath } : {}), args: launchArgs,
    env: childEnv, timeout: 30000 });
  window = await electron.firstWindow();
  const dimensions=(process.env.ATLAS_DESKTOP_TEST_WINDOW_SIZE || '1500x1000').split('x').map(Number);
  if(dimensions.length!==2||dimensions.some(size=>!Number.isInteger(size)||size<600||size>3840))throw new Error('Choose desktop test dimensions between 600 and 3840.');
  // Window creation is constrained by the hosted runner's small work area.
  // Set the content size explicitly so native controls have repeatable targets.
  await electron.evaluate(({BrowserWindow},{dimensions,custom})=>{const owner=BrowserWindow.getAllWindows()[0];if(custom)owner.setMinimumSize(0,0);owner.setContentSize(...dimensions);},{dimensions,custom:Boolean(process.env.ATLAS_DESKTOP_TEST_WINDOW_SIZE)});
  await window.waitForFunction(() => window.atlasDesktop);
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.views.length === 3 && !state.busy && state.views.every((view) => view.status === "ready"), "Desktop did not load");
  await until(() => window.locator(".desktop-device-status").allTextContents(), (statuses) => statuses.length === 3 && statuses.every((status) => status === "Ready to follow"), "Workspace UI did not finish loading");
  assert.equal(await window.locator(".desktop-message").getAttribute("role"), "status", "Workspace displayed a startup error");
  views = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
    .filter((view) => view.webContents)
    .map((view) => view.webContents.id));
  assert.equal(views.length, 3);
  const state = await window.evaluate(() => window.atlasDesktop.state());
  assert((await Promise.all(views.map(id => inspect(id, 'location.href')))).every(url => url === state.url), 'Startup announced ready before its initial navigation completed');
  if (process.env.CI) console.log('Desktop display:', await electron.evaluate(({screen,BrowserWindow})=>({displayScale:screen.getDisplayMatching(BrowserWindow.getAllWindows()[0].getBounds()).scaleFactor,window:BrowserWindow.getAllWindows()[0].getContentSize()})));
}
async function inspect(id, expression) {
  return electron.evaluate(({ webContents }, { id, expression }) => webContents.fromId(id).executeJavaScript(expression), { id, expression });
}
async function values(selector = 'input[name="name"]') {
  return Promise.all(views.map((id) => inspect(id, `document.querySelector(${JSON.stringify(selector)})?.value`)));
}
async function click(id, selector) {
  await until(() => window.evaluate(() => window.atlasDesktop.state()), state => state.pending === 0, 'Earlier interactions were not acknowledged before switching controls');
  await electron.evaluate(({ BrowserWindow, app }) => {
    if(BrowserWindow.getAllWindows()[0].isFocused())return;
    app.show?.();
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0].show();
    if (BrowserWindow.getAllWindows()[0].isMinimized()) BrowserWindow.getAllWindows()[0].restore();
    BrowserWindow.getAllWindows()[0].focus();
  });
  await until(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()), true, "App window did not activate");
  await electron.evaluate(async ({ webContents, BrowserWindow }, { id, selector }) => {
    const wc = webContents.fromId(id);
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find((view) => view.webContents?.id === id);
    wc.focus();
    const point = await wc.executeJavaScript(`(async () => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const rect = el.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: innerWidth }; })()`);
    const scale = view.getBounds().width / point.width;
    const previousUrl=wc.getURL();
    for (const type of ["mouseDown", "mouseUp"]) wc.sendInputEvent({ type, x: Math.round(point.x * scale), y: Math.round(point.y * scale), button: "left", clickCount: 1 });
    try { await wc.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); }
    catch(error){if(!/WebFrame was removed|context.*destroyed/i.test(error.message)||(!wc.isLoadingMainFrame()&&wc.getURL()===previousUrl))throw error;}
  }, { id, selector });
  await until(() => window.evaluate(() => window.atlasDesktop.state()), state => state.pending === 0, 'Control interaction was not acknowledged');
}
async function insert(id, text) {
  await electron.evaluate(async ({ webContents }, { id, text }) => { await webContents.fromId(id).insertText(text); }, { id, text });
}
before(async () => {
  root = await mkdtemp(join(tmpdir(), "atlas desktop é-"));
  await writeFile(join(root, "codex-fixture.cjs"), `const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]!=='exec'){console.log('Local Codex integration fixture');process.exit(0);}let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>text+=chunk);process.stdin.on('end',()=>{fs.writeFileSync(process.env.ATLAS_CODEX_TEST_PROMPT,text);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Local CLI fixture reviewed evidence.'}}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({summary:'Local fixture analysis complete',findings:[]}));});`);
  const bundle = await build({ entryPoints: ["tests/fixtures/desktop-controlled.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  server = createServer((req, res) => {
    if (req.url === "/download") { res.setHeader("Content-Type", "text/plain"); res.setHeader("Content-Disposition", 'attachment; filename="fixture-download.txt"'); res.end("Downloaded test fixture"); return; }
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/sign-in") res.setHeader("Set-Cookie", "atlas_login=persisted; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/");
    res.setHeader("Content-Type", "text/html");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.end('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desktop fixture</title><style>body{margin:12px}input,textarea{display:block;margin:8px 0 16px;min-height:32px;max-width:90%}#private{color:red}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${server.address().port}`;
  await launch();
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  await until(() => values(), ["", "", ""]);
}, { timeout: 60000 });
after(async () => {
  await electron?.close();
  await new Promise((done) => server?.close(done));
  if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("live browser views retain exact CSS dimensions and isolated privileges", async () => {
  const metrics = await Promise.all(views.map((id) => inspect(id, '({width:innerWidth,height:innerHeight,density:devicePixelRatio,node:typeof require,bridge:typeof window.atlasDesktop})')));
  assert.deepEqual(metrics.map((m) => [m.width, m.height, m.density]), [[393, 852, 2], [820, 1180, 2], [1440, 900, 2]]);
  assert(metrics.every((m) => m.node === "undefined" && m.bridge === "undefined"));
  assert.deepEqual(await Promise.all(views.map((id) => inspect(id, 'document.querySelector("input[name=name]").id'))), ["name-mobile", "name-wide", "name-wide"]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.navigate("file:///etc/passwd")), /HTTP and HTTPS/);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.layout([{ id: "phone", x: -1, y: 0, width: 20, height: 20 }])), /layout/);
});

test("clicking a field and native text entry synchronize React state without stealing source focus", async () => {
  await click(views[0], 'input[name="name"]');
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.activeElement?.name'))), ["name", "name", "name"], "Field focus was not mirrored");
  await insert(views[0], "Hello");
  await until(() => values(), ["Hello", "Hello", "Hello"], "Native typing was not mirrored");
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.querySelector("#name-state").textContent'))), ["Hello", "Hello", "Hello"], "Controlled React state was not updated");
  assert.equal(await electron.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.id), views[0]);
  await insert(views[0], " world");
  await until(() => values(), ["Hello world", "Hello world", "Hello world"]);
});

test("resizing the workspace fits every live view without changing responsive breakpoints", async () => {
  const original = await electron.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0];
    const original = owner.getContentSize();
    owner.setContentSize(1100, 760);
    return original;
  });
  try {
    await until(() => window.evaluate(() => {
      const slots = [...document.querySelectorAll("[data-browser-slot]")].map((slot) => slot.getBoundingClientRect());
      return slots.every((slot) => slot.bottom <= innerHeight - 60) && document.documentElement.scrollHeight <= innerHeight;
    }), true, "Browser views overflowed the app window");
    assert.deepEqual(await Promise.all(views.map((id) => inspect(id, "innerWidth"))), [393, 820, 1440]);
    assert.equal(await window.locator(".desktop-message").getAttribute("role"), "status");
  } finally {
    await electron.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), original);
    await until(() => window.evaluate(() => innerWidth), original[0]);
  }
});

test("selection replacement, deletion, Unicode, and switching source preserve field values", async () => {
  await inspect(views[0], 'document.querySelector("input[name=name]").setSelectionRange(6, 11)');
  await insert(views[0], "世界 🌿");
  await until(() => values(), ["Hello 世界 🌿", "Hello 世界 🌿", "Hello 世界 🌿"]);
  await click(views[2], 'input[name="name"]');
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.source === "desktop");
  await inspect(views[2], 'document.querySelector("input[name=name]").setSelectionRange(0, 5)');
  await insert(views[2], "Hi");
  await until(() => values(), ["Hi 世界 🌿", "Hi 世界 🌿", "Hi 世界 🌿"]);
  await electron.evaluate(({ webContents }, id) => {
    const wc = webContents.fromId(id);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
  }, views[2]);
  await until(() => values(), ["H 世界 🌿", "H 世界 🌿", "H 世界 🌿"]);
});

test("textarea input and ordinary UI clicks follow across responsive screens", async () => {
  await click(views[1], "#notes");
  await insert(views[1], "First line\nPasted text: café");
  await until(() => values("#notes"), Array(3).fill("First line\nPasted text: café"));
  await click(views[0], "summary");
  await until(() => Promise.all(views.map((id) => inspect(id, 'document.querySelector("details").open'))), [true, true, true]);
});

test("masked 2× viewport screenshots and a real PDF export through the desktop interface", async () => {
  await electron.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
  const capture = window.evaluate(() => window.atlasDesktop.capture());
  await until(() => window.evaluate(() => window.atlasDesktop.state()), state => state.busy, "Capture did not enter its protected state");
  assert(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.filter(v=>v.webContents).every(view=>{
    const bounds=view.getBounds();return !view.getVisible() || bounds.x+ bounds.width<=0;
  })), 'Capturing browser surfaces covered the review controls');
  const result = await capture;
  assert(result?.runId);
  const run = JSON.parse(await readFile(join(result.root, "run.json"), "utf8"));
  assert.equal(run.status, "completed");
  assert(run.checks.some((check) => check.name === "Automated and AI checks" && check.status === "not_run"));
  for (let index = 0; index < 3; index++) {
    const screenshot = run.screenshots[index];
    const file = join(result.root, "screenshots", `${screenshot.deviceId}.png`);
    const info = await sharp(file).metadata();
    assert.equal(info.width, screenshot.width * 2);
    assert.equal(info.height, screenshot.height * 2);
    const rect = await inspect(views[index], '(() => {const r=document.querySelector("[data-sensitive]").getBoundingClientRect(); return {x:r.x,y:r.y};})()');
    const { data } = await sharp(file).extract({ left: Math.ceil(rect.x * 2) + 4, top: Math.ceil(rect.y * 2) + 4, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data], [52, 78, 80], "Private region was not masked");
    assert.equal(await inspect(views[index], 'document.querySelector("[data-atlas-capture-mask]")'), null);
    assert.equal(await inspect(views[index], 'getComputedStyle(document.querySelector("[data-sensitive]")).visibility'), "visible", "Capture did not restore the private region");
    assert.equal(await inspect(views[index], 'getComputedStyle(document.querySelector("[data-sensitive] input")).visibility'), "visible", "Nested masks did not restore the field");
  }
  const pdf = await readFile(join(result.root, "report.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert(pdf.length > 10000);
  assert.equal(await inspect(views[2], "innerWidth"), 1440, "Capture changed responsive layout");
});

test("consequential clicks run once and visibly pause synchronization", async () => {
  await click(views[0], "#purchase");
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.paused && Boolean(state.problem));
  assert.deepEqual(await Promise.all(views.map((id) => inspect(id, 'Number(document.body.dataset.purchases || 0)'))), [1, 0, 0]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.pause(false)), /Reload views/);
});

test("ambiguous counterparts stop synchronization and a fresh reload recovers", async () => {
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  await until(() => values(), ["", "", ""]);
  await inspect(views[1], '(() => { const input=document.querySelector("input[name=name]"); input.removeAttribute("id"); const duplicate=input.cloneNode(); input.after(duplicate); })()');
  await click(views[0], 'input[name="name"]');
  await until(() => window.evaluate(() => window.atlasDesktop.state()), (state) => state.paused && state.problem.includes("More than one"));
  await assert.rejects(window.evaluate(() => window.atlasDesktop.capture()), /Resume synchronization|Reload views/);
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
  const recovered = await window.evaluate(() => window.atlasDesktop.state());
  assert.equal(recovered.paused, false);
  assert.equal(recovered.problem, "");
});

test("editing while paused requires recovery instead of silently resuming divergent views", async () => {
  await window.evaluate(() => window.atlasDesktop.pause(true));
  await click(views[0], 'input[name="name"]');
  await insert(views[0], "Independent");
  await until(() => values(), ["Independent", "", ""]);
  await assert.rejects(window.evaluate(() => window.atlasDesktop.pause(false)), /Reload views/);
  await window.evaluate((url) => window.atlasDesktop.navigate(url), url);
});

test("controlled checkboxes, select changes, nested scrolling, navigation and history converge", async () => {
  await click(views[0], "#newsletter");
  await until(() => Promise.all(views.map(id => inspect(id, 'document.querySelector("#checked-state").textContent'))), Array(3).fill("true"));
  // Native keyboard selection drives the controlled React select.
  await electron.evaluate(async ({ webContents }, id) => {
    const wc = webContents.fromId(id);
    wc.focus(); await wc.executeJavaScript('document.querySelector("#choice").focus()');
    for (const [key, code, windowsVirtualKeyCode] of [["ArrowDown","ArrowDown",40]]) {
      for (const type of ["keyDown", "keyUp"]) await wc.debugger.sendCommand("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode });
    }
  }, views[0]);
  await until(() => values("#choice"), Array(3).fill("two"));
  await inspect(views[0], 'document.querySelector("#nested-scroll").scrollTop = 250');
  await until(() => Promise.all(views.map(id => inspect(id, 'document.querySelector("#nested-scroll").scrollTop'))), [250,250,250]);
  await click(views[0], "#next-page");
  await until(() => Promise.all(views.map(id => inspect(id, 'location.pathname'))), ["/next","/next","/next"]);
  await window.evaluate(() => window.atlasDesktop.history("back"));
  await until(() => Promise.all(views.map(id => inspect(id, 'location.pathname'))), ["/","/","/"]);
  await window.evaluate(() => window.atlasDesktop.history("forward"));
  await until(() => Promise.all(views.map(id => inspect(id, 'location.pathname'))), ["/next","/next","/next"]);
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
});

test("desktop records and replays a multi-page journey through the shared action engine", async () => {
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
  await window.evaluate(() => window.atlasDesktop.review("/flows/record", "POST", { masks: "" }));
  await click(views[0], 'input[name="name"]');
  await insert(views[0], "Recorded value");
  await until(() => values(), Array(3).fill("Recorded value"));
  await window.evaluate(() => window.atlasDesktop.review("/flows/checkpoint", "POST", {}));
  await click(views[0], "#next-page");
  await until(() => Promise.all(views.map(id => inspect(id, 'location.pathname'))), ["/next","/next","/next"]);
  assert((await window.evaluate(() => window.atlasDesktop.review('/flows'))).recording,
    `Navigation interrupted recording: ${(await window.evaluate(() => window.atlasDesktop.state())).problem}`);
  await window.evaluate(() => window.atlasDesktop.review("/flows/checkpoint", "POST", {}));
  await window.evaluate(() => window.atlasDesktop.review("/flows/stop", "POST", {}));
  const saved = await window.evaluate(() => window.atlasDesktop.review("/flows"));
  assert(saved.plans[0].steps.some(step => step.type === "input" && step.action.value === "Recorded value"));
  assert(!JSON.stringify(saved).includes("secret-never-export"));
  const devices = (await window.evaluate(() => window.atlasDesktop.state())).views.map(v => v.device);
  const profile = { id:"flow-test", name:"Flow test", prompt:"", categories:["SEO"], devices:devices.map(d=>d.id), ai:false, fullPage:false, masks:"", exportPdf:false, outputFolder:root };
  await window.evaluate(({ devices, profile }) => window.atlasDesktop.review("/flows/run", "POST", { devices, profile }), { devices, profile });
  const state = await until(() => window.evaluate(() => window.atlasDesktop.review("/flows")), s => s.job?.status !== "running", "Flow replay did not settle", 60000);
  await until(() => window.evaluate(() => window.atlasDesktop.state()), state => !state.busy, "Replay cleanup did not release the workspace");
  assert.equal(state.job.status, "completed", state.job.error);
  assert.equal(state.job.screens.length, 3);
  assert(state.job.screens.every(screen => screen.status === "completed" && screen.runId));
  await window.evaluate(() => window.atlasDesktop.presentation(true));
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
});

test("IME commits, responsive menus, open-shadow input, hover, Escape and DOM drops synchronize", async () => {
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
  const install = () => {
    const style = document.createElement('style'); style.textContent = '#responsive-nav{display:none}#responsive-nav.open{display:block}@media(min-width:1000px){#responsive-nav{display:block}}#hover-control:hover{background:rgb(0,255,0)}';document.head.append(style);
    const region=document.createElement('section'); region.innerHTML='<button id="menu-toggle" type="button" aria-expanded="false" aria-controls="responsive-nav">Open menu</button><nav id="responsive-nav"><button id="show-panel" type="button">Show panel</button></nav><button id="hover-control" type="button">Show hover menu</button><div id="plain-editor" contenteditable="true" aria-label="Plain editor"></div><div id="drag-item" draggable="true" style="height:40px">Move this item</div><div id="drop-zone" style="height:80px">Drop here</div>';
    document.body.prepend(region);
    document.querySelector('#menu-toggle').addEventListener('click',event=>{document.querySelector('#responsive-nav').classList.add('open');event.target.setAttribute('aria-expanded','true');});
    document.querySelector('#show-panel').addEventListener('click',()=>document.body.dataset.panel='shown');
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelector('[role="dialog"]')?.remove();});
    document.querySelector('#drag-item').addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain','drag-item'));
    document.querySelector('#drop-zone').addEventListener('dragover',event=>event.preventDefault());
    document.querySelector('#drop-zone').addEventListener('drop',event=>{event.preventDefault();event.currentTarget.append(document.getElementById(event.dataTransfer.getData('text/plain')));});
    globalThis.__dragLog=[];for(const type of ['pointerdown','dragstart','dragenter','dragover','drop'])document.addEventListener(type,event=>globalThis.__dragLog.push({type,target:event.target.id,x:event.clientX,y:event.clientY,data:event.dataTransfer?.getData('text/plain')}),true);
    const host=document.createElement('div');host.id='shadow-host';document.body.prepend(host);const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<input name="shadow-name" aria-label="Shadow name"><input type="password" value="shadow-secret-never-export" aria-label="Private shadow field">';
  };
  await Promise.all(views.map(id=>inspect(id,`(${install})()`)));
  await click(views[2], '#show-panel');
  await until(()=>Promise.all(views.map(id=>inspect(id,'document.body.dataset.panel'))),['shown','shown','shown']);
  await click(views[0], 'input[name="name"]');
  await electron.evaluate(async({webContents},id)=>{
    const wc=webContents.fromId(id);
    await wc.debugger.sendCommand('Input.imeSetComposition',{text:'日',selectionStart:1,selectionEnd:1});
    await wc.debugger.sendCommand('Input.imeSetComposition',{text:'日本',selectionStart:2,selectionEnd:2});
    await wc.debugger.sendCommand('Input.insertText',{text:'日本'});
  },views[0]);
  await until(()=>values(),Array(3).fill('日本'));
  await electron.evaluate(async({webContents},id)=>{const wc=webContents.fromId(id);wc.focus();await wc.executeJavaScript('document.querySelector("#shadow-host").shadowRoot.querySelector("input").focus()');await wc.insertText('Shadow text');},views[0]);
  await until(()=>Promise.all(views.map(id=>inspect(id,'document.querySelector("#shadow-host").shadowRoot.querySelector("input").value'))),Array(3).fill('Shadow text'));
  await click(views[0], '#plain-editor');await insert(views[0],'Editable text');
  await until(()=>Promise.all(views.map(id=>inspect(id,'document.querySelector("#plain-editor").textContent'))),Array(3).fill('Editable text'));
  await Promise.all(views.map(id=>inspect(id,'(()=>{const d=document.createElement("div");d.setAttribute("role","dialog");d.textContent="Dialog";document.body.append(d)})()')));
  await electron.evaluate(({webContents},id)=>{for(const type of ['keyDown','keyUp'])webContents.fromId(id).sendInputEvent({type,keyCode:'Escape'});},views[0]);
  await until(()=>Promise.all(views.map(id=>inspect(id,'Boolean(document.querySelector("[role=dialog]"))'))),[false,false,false]);
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),state=>state.pending===0,'Escape was not acknowledged before hover');
  await electron.evaluate(async({webContents,BrowserWindow},id)=>{
    const wc=webContents.fromId(id);
    wc.sendInputEvent({type:'mouseMove',x:0,y:0});
    const rect=await wc.executeJavaScript('(async()=>{const e=document.querySelector("#hover-control");e.scrollIntoView({block:"center"});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=e.getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()');
    const view=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===id);const scale=view.getBounds().width/await wc.executeJavaScript('innerWidth');
    wc.sendInputEvent({type:'mouseMove',x:Math.round(rect.x*scale),y:Math.round(rect.y*scale)});
  },views[0]);
  await until(()=>Promise.all(views.map(id=>inspect(id,'getComputedStyle(document.querySelector("#hover-control")).backgroundColor'))),Array(3).fill('rgb(0, 255, 0)'));
  await electron.evaluate(async({webContents,BrowserWindow},id)=>{
    const wc=webContents.fromId(id);const rects=await wc.executeJavaScript('(()=>{document.querySelector("#drag-item").scrollIntoView({block:"center"});const point=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x+5,y:r.y+5}};return {source:point("#drag-item"),target:point("#drop-zone")}})()');
    const view=BrowserWindow.getAllWindows()[0].contentView.children.find(v=>v.webContents?.id===id);const scale=view.getBounds().width/await wc.executeJavaScript('innerWidth');
    const point=p=>({x:Math.round(p.x*scale),y:Math.round(p.y*scale)});
    wc.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point(rects.source)});
    for(const type of ['dragEnter','dragOver','drop'])await wc.debugger.sendCommand('Input.dispatchDragEvent',{type,...rects.target,data:{items:[{mimeType:'text/plain',data:'drag-item'}],dragOperationsMask:1}});
    wc.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point(rects.target)});
  },views[0]);
  try { await until(()=>Promise.all(views.map(id=>inspect(id,'document.querySelector("#drop-zone").contains(document.querySelector("#drag-item"))'))),[true,true,true]); }
  catch(error){assert.fail(`${error.message}: ${JSON.stringify(await inspect(views[0],'globalThis.__dragLog'))}`);}
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("private shadow and opaque embedded regions remain masked in native evidence", async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await Promise.all(views.map(id=>inspect(id,`(()=>{
    const region=document.createElement('section');
    const host=document.createElement('div');host.id='shadow-host';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<input type="password" value="shadow-secret-never-export">';
    const opaque=document.createElement('atlas-private-box');opaque.id='opaque';opaque.style.cssText='display:block;width:100px;height:40px';opaque.attachShadow({mode:'closed'}).textContent='Private opaque content';
    const frame=document.createElement('iframe');frame.id='private-frame';frame.srcdoc='<p>Private embedded content</p>';frame.width='100';frame.height='40';
    region.append(host,opaque,frame);document.body.prepend(region);scrollTo(0,0);
  })()`)));
  await electron.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},root);
  const captured=await window.evaluate(()=>window.atlasDesktop.capture());
  for(let index=0;index<3;index++){
    const device=(await window.evaluate(()=>window.atlasDesktop.state())).views[index].device.id;
    for(const expression of ['document.querySelector("#shadow-host").shadowRoot.querySelector("[type=password]")','document.querySelector("#opaque")','document.querySelector("#private-frame")']){
      const rect=await inspect(views[index],`(()=>{const r=(${expression}).getBoundingClientRect();return {x:r.x,y:r.y}})()`);
      const pixel=await sharp(join(captured.root,'screenshots',`${device}.png`)).extract({left:Math.ceil(rect.x*2)+4,top:Math.ceil(rect.y*2)+4,width:1,height:1}).removeAlpha().raw().toBuffer();
      assert.deepEqual([...pixel],[52,78,80],"Private embedded region was not masked");
      assert.equal(await inspect(views[index],`getComputedStyle(${expression}).visibility`),'visible');
    }
  }
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("counterpart mappings, safe retry, viewport exclusion and explicit consequential test mode",async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  const sourceId=await inspect(views[0],'document.querySelector("input[name=name]").id');
  await inspect(views[1],'(()=>{const el=document.querySelector("input[name=name]");el.id="mapped-name";el.name="different-name";el.setAttribute("aria-label","Different label")})()');
  await click(views[0],'input[name=name]');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),s=>s.paused&&s.canRetry);
  await window.evaluate(({source})=>window.atlasDesktop.mapping({source,viewId:'tablet',selector:'#mapped-name'}),{source:sourceId});
  await window.evaluate(()=>window.atlasDesktop.retry());
  await insert(views[0],'Mapped name');
  await until(()=>Promise.all(views.map((id,index)=>inspect(id,`document.querySelector('${index===1?'#mapped-name':'input[name=name]'}').value`))),Array(3).fill('Mapped name'));
  await window.evaluate(({source})=>window.atlasDesktop.mapping({source,viewId:'tablet',selector:''}),{source:sourceId});
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await window.evaluate(()=>window.atlasDesktop.exclude('tablet',true));
  await click(views[0],'input[name=name]');await insert(views[0],'Excluded test');
  await until(()=>values(),['Excluded test','','Excluded test']);
  await window.evaluate(()=>window.atlasDesktop.exclude('tablet',false));
  await until(()=>values(),['','','']);
  await window.evaluate(url=>window.atlasDesktop.testMode(url),url);
  await click(views[0],'#purchase');
  await until(()=>Promise.all(views.map(id=>inspect(id,'Number(document.body.dataset.purchases||0)'))),[1,1,1]);
  assert.equal((await window.evaluate(()=>window.atlasDesktop.state())).paused,false);
  await window.evaluate(()=>window.atlasDesktop.testMode(''));
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("desktop review UI uses the live session for real audits, finding edits, evidence and PDF exports", async () => {
  await click(views[0], 'input[name="name"]');
  await insert(views[0], "Retain this live state");
  await until(() => values(), Array(3).fill("Retain this live state"));
  await Promise.all(views.map(id => inspect(id, `(() => {
    const region = document.createElement('section');
    region.id = 'audit-private'; region.style.cssText = 'margin-top:1300px;height:90px;background:red';
    region.textContent = 'DO-NOT-EXPORT-THIS'; document.body.append(region);
    document.body.insertAdjacentHTML('beforeend', '<img src="/missing.png">');
  })()`)));
  await window.getByRole("button", { name: "Audit settings & reports" }).click();
  await until(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.webContents).every(v => !v.getVisible())), true, "Native browsers obscured review controls");
  await window.locator(".run-audit").waitFor();
  await window.screenshot({ path: resolve(".context/desktop-review.png") });
  const profile = { id: "desktop-test", name: "Desktop integration", prompt: "Review the page", categories: ["Accessibility", "SEO", "UX / UI"],
    devices: ["phone", "tablet", "desktop"], ai: false, fullPage: true, masks: "#audit-private", exportPdf: true, outputFolder: root };
  const devices = (await window.evaluate(() => window.atlasDesktop.state())).views.map(v => v.device);
  await window.evaluate(async ({ devices, profile }) => {
    await window.atlasDesktop.preference("atlas-devices", devices);
    await window.atlasDesktop.preference("atlas-profiles", [profile]);
  }, { devices, profile });
  const run = await window.evaluate(({ devices, profile }) => window.atlasDesktop.review("/runs", "POST", { devices, profile }), { devices, profile });
  await assert.rejects(window.evaluate((url) => window.atlasDesktop.navigate(url), url), /current operation|audit/);
  const completed = await until(() => window.evaluate(id => window.atlasDesktop.review(`/runs/${id}`), run.id), r => r.status !== "running", "Audit did not finish", 60000);
  assert.equal(completed.status, "completed", JSON.stringify(completed.checks));
  assert.equal(completed.screenshots.length, 3);
  assert.equal(completed.checks.filter(c => c.name === "axe-core accessibility" && c.status === "completed").length, 3);
  assert(completed.findings.some(f => f.source === "axe-core"));
  assert(!completed.checks.some(c => c.status === "failed"), JSON.stringify(completed.checks));
  assert(completed.checks.some(c => c.name === "Codex analysis" && c.status === "not_run"));
  assert.deepEqual(await values(), Array(3).fill("Retain this live state"));
  for (let index = 0; index < 3; index++) {
    const shot = completed.screenshots[index];
    assert(shot.height > devices[index].height, "Full-page evidence stopped at the viewport");
    const rect = await inspect(views[index], '(() => { const r=document.querySelector("#audit-private").getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY};})()');
    const pixel = await sharp(join(completed.outputFolder, "screenshots", `${shot.deviceId}.png`))
      .extract({ left: Math.ceil(rect.x * 2) + 4, top: Math.ceil(rect.y * 2) + 4, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], [52, 78, 80], "Custom private region below the viewport was not masked");
    assert.equal(await inspect(views[index], 'getComputedStyle(document.querySelector("#audit-private")).visibility'), "visible");
  }
  const evidence = await window.evaluate(async path => {
    const image = new Image(); image.src = `atlas://evidence/${path.slice('/evidence/'.length)}`;
    await image.decode(); return image.naturalWidth;
  }, completed.screenshots[0].path);
  assert.equal(evidence, 786, "Desktop evidence protocol did not serve the captured image");
  await assert.rejects(window.evaluate(() => window.atlasDesktop.review("/evaluate", "POST", {})), /not available/);
  const finding = { ...completed.findings[0], status: "verified" };
  const edited = await window.evaluate(({ id, finding }) => window.atlasDesktop.review(`/runs/${id}/findings/${finding.id}`, "PATCH", finding), { id: run.id, finding });
  assert.equal(edited.findings[0].status, "verified");
  await electron.evaluate(({ dialog }, root) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${root}/export-a4.pdf` }); }, root);
  await window.evaluate(id => window.atlasDesktop.pdf(id, "a4", false), run.id);
  assert.equal((await readFile(join(root, "export-a4.pdf"))).subarray(0, 5).toString(), "%PDF-");
  await electron.evaluate(({ shell }) => { shell.openPath = async file => { globalThis.atlasOpenedEvidence = file; return ""; }; });
  await window.evaluate(({ id, path }) => window.atlasDesktop.review(`/runs/${id}/evidence`, "POST", { path }), { id: run.id, path: completed.screenshots[0].path });
  assert.match(await electron.evaluate(() => globalThis.atlasOpenedEvidence), /screenshots[/\\]phone\.png$/);
  await assert.rejects(window.evaluate(id => window.atlasDesktop.review(`/runs/${id}/evidence`, "POST", { path: `/evidence/${id}/../private.png` }), run.id), /Unsupported evidence/);
  assert((await window.evaluate(() => window.atlasDesktop.review("/runs"))).some(r => r.id === run.id));
  await window.getByRole("button", { name: "Audit history", exact: true }).click();
  await window.locator(".history-row").filter({ hasText: "Desktop integration" }).getByRole("button", { name: "View report" }).click();
  await window.locator(".finding-row").first().waitFor();
  await window.screenshot({ path: resolve(".context/desktop-findings.png") });
  await window.getByRole("button", { name: "Return to live workspace", exact: true }).click();
  await until(() => window.locator(".desktop-app").isVisible(), true);
  await until(() => electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.webContents).every(v => v.getVisible())), true);
});

test("desktop audits fail closed for invalid masking and cancellation retains the run", async () => {
  const devices = (await window.evaluate(() => window.atlasDesktop.state())).views.map(v => v.device);
  const profile = { name: "Invalid mask", prompt: "", categories: ["Accessibility"], ai: false, fullPage: false, masks: ":invalid-selector(", exportPdf: false, outputFolder: root };
  const run = await window.evaluate(({ devices, profile }) => window.atlasDesktop.review("/runs", "POST", { devices, profile }), { devices, profile });
  const failed = await until(() => window.evaluate(id => window.atlasDesktop.review(`/runs/${id}`), run.id), r => r.status !== "running");
  assert.equal(failed.status, "failed");
  assert.equal(failed.screenshots.length, 0);
  assert.equal(await inspect(views[0], 'document.querySelector("[data-atlas-capture-mask]")'), null);
  const cancelled = await window.evaluate(async ({ devices, profile }) => {
    const run = await window.atlasDesktop.review("/runs", "POST", { devices, profile: { ...profile, masks: "", fullPage: true } });
    await window.atlasDesktop.review(`/runs/${run.id}/cancel`, "POST", {});
    return run;
  }, { devices, profile });
  const stopped = await until(() => window.evaluate(id => window.atlasDesktop.review(`/runs/${id}`), cancelled.id), r => r.status !== "running");
  assert.equal(stopped.status, "cancelled");
  assert.match(stopped.error, /cancelled/);
});

test("invalid active privacy masks pause live synchronization until corrected",async()=>{
  const preferences=await window.evaluate(()=>window.atlasDesktop.preferences());
  const profiles=preferences['atlas-profiles'];assert(profiles?.length);
  await window.evaluate(profiles=>window.atlasDesktop.preference('atlas-profiles',profiles),profiles.map(profile=>({...profile,masks:':invalid-selector('})));
  const blocked=await window.evaluate(()=>window.atlasDesktop.state());assert(blocked.paused);assert.match(blocked.problem,/Privacy masks/);
  await window.evaluate(profiles=>window.atlasDesktop.preference('atlas-profiles',profiles),profiles);
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  assert.equal((await window.evaluate(()=>window.atlasDesktop.state())).paused,false);
});

test("desktop optional AI and page-code evidence reach a local CLI fixture without private values", async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await Promise.all(views.map(id=>inspect(id,'(()=>{const e=document.createElement("section");e.dataset.sensitive="true";e.textContent="PRIVATE-CODE-SENTINEL";document.body.prepend(e)})()')));
  const devices=(await window.evaluate(()=>window.atlasDesktop.state())).views.slice(0,1).map(v=>v.device);
  const profile={id:'ai-fixture',name:'Local fixture only',prompt:'Review evidence',categories:['SEO'],devices:devices.map(d=>d.id),ai:true,includePageCode:true,liveCodexOutput:true,fullPage:false,masks:'',exportPdf:false,outputFolder:root};
  const started=await window.evaluate(({devices,profile})=>window.atlasDesktop.review('/runs','POST',{devices,profile}),{devices,profile});
  const run=await until(()=>window.evaluate(id=>window.atlasDesktop.review(`/runs/${id}`),started.id),r=>r.status!=='running','Local CLI fixture audit did not finish',30000);
  assert.equal(run.status,'completed',run.error);assert(run.checks.some(c=>c.name==='Codex analysis'&&c.status==='completed'),JSON.stringify(run.checks));
  const prompt=await readFile(join(root,'ai-prompt.txt'),'utf8');assert(prompt.includes('pageCode'));assert(!prompt.includes('PRIVATE-CODE-SENTINEL'));assert(!prompt.includes('secret-never-export'));assert.equal(run.summary,'Local fixture analysis complete');assert(run.codexOutput.length);
  const code=await readFile(join(run.outputFolder,'page-code',`${devices[0].id}.json`),'utf8');assert(!code.includes('PRIVATE-CODE-SENTINEL'));
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("managed popups retain website isolation and a website download is saved without replaying it",async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  const open=`(() => { window.open(${JSON.stringify(`${url}/sign-in`)},'_blank'); return true; })()`;
  await inspect(views[0],open);
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),s=>s.paused&&Boolean(s.popup));
  assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  await window.evaluate(()=>window.atlasDesktop.popup());
  await inspect(views[0],open);
  await until(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),2);
  await until(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.webContents.getURL().startsWith('http')&&!w.webContents.isLoadingMainFrame())),true);
  const privileges=await electron.evaluate(async({BrowserWindow})=>{
    const popup=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http'));
    await new Promise(resolve=>popup.webContents.isLoading()?popup.webContents.once('did-finish-load',resolve):resolve());
    return popup.webContents.executeJavaScript('({node:typeof require,bridge:typeof window.atlasDesktop,opener: Boolean(window.opener)})');
  });
  assert.equal(privileges.node,'undefined');assert.equal(privileges.bridge,'undefined');assert.equal(privileges.opener,true);
  await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http')).close());
  await until(()=>electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await electron.evaluate(({webContents},{id,url})=>webContents.fromId(id).downloadURL(url),{id:views[0],url:`${url}/download`});
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),s=>Boolean(s.download));
  await electron.evaluate(({dialog},root)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:`${root}/website-download.txt`});},root);
  await window.evaluate(()=>window.atlasDesktop.download());
  await until(()=>readFile(join(root,'website-download.txt'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;}),'Downloaded test fixture');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),s=>!s.download);
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("desktop device editing and saved sets configure real native viewport dimensions", async () => {
  await window.getByRole("button", { name: "Audit settings & reports" }).click();
  await window.getByLabel("Custom audit instructions").fill("Saved desktop audit preferences");
  await window.getByRole("button", { name: "Audit profiles", exact: true }).click();
  await window.getByRole("button", { name: "Create profile", exact: true }).click();
  await window.getByLabel("Profile name", { exact: true }).fill("My desktop profile");
  await window.getByRole("button", { name: "Save profile", exact: true }).click();
  const savedProfile = await until(() => window.evaluate(() => window.atlasDesktop.preferences()), p => p["atlas-profiles"].some(profile => profile.name === "My desktop profile"));
  assert.deepEqual(savedProfile["atlas-profiles"].find(p => p.name === "My desktop profile").devices, ["phone", "tablet", "desktop"]);
  await window.getByRole("button", { name: "Settings", exact: true }).click();
  await window.getByRole("textbox", { name: "Device 1 name", exact: true }).fill("Custom phone");
  await window.getByRole("spinbutton", { name: "Device 1 width", exact: true }).fill("412");
  await window.getByRole("button", { name: "Save devices", exact: true }).click();
  await window.getByLabel("Save the current devices as a set").fill("My responsive set");
  await window.getByRole("button", { name: "Save set", exact: true }).click();
  await window.screenshot({ path: resolve(".context/desktop-settings.png") });
  await window.getByRole("button", { name: "Dark theme", exact: true }).click();
  const original = await electron.evaluate(({ BrowserWindow }) => {
    const owner = BrowserWindow.getAllWindows()[0]; const size = owner.getContentSize(); owner.setContentSize(1000, 720); return size;
  });
  await until(() => window.evaluate(() => innerWidth), 1000);
  await window.screenshot({ path: resolve(".context/desktop-settings-narrow-dark.png") });
  await electron.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), original);
  await until(() => window.evaluate(() => innerWidth), original[0]);
  await window.getByRole("button", { name: "Dark theme", exact: true }).click();
  await window.getByRole("button", { name: "Return to live workspace", exact: true }).click();
  await until(() => window.evaluate(() => window.atlasDesktop.state()), s => !s.busy && s.views[0]?.device.width === 412);
  const widths = await electron.evaluate(async ({ BrowserWindow }) => Promise.all(BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.webContents).map(v => v.webContents.executeJavaScript("innerWidth"))));
  assert.deepEqual(widths, [412, 820, 1440]);
  const preferences = await window.evaluate(() => window.atlasDesktop.preferences());
  assert.equal(preferences["atlas-device-sets"][0].name, "My responsive set");
  assert.equal(preferences["atlas-devices"][0].name, "Custom phone");
  // Native views were intentionally recreated when their configured sizes changed.
  views = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.webContents).map(v => v.webContents.id));
});

test("persistent website authentication survives app restart", async () => {
  await window.evaluate((url) => window.atlasDesktop.navigate(url), `${url}/sign-in`);
  const cookie = await electron.evaluate(async ({ session }, url) => (await session.fromPartition("persist:atlas-review").cookies.get({ url }))[0], url);
  assert.equal(cookie.value, "persisted");
  await electron.close();
  await launch();
  const restored = await electron.evaluate(async ({ session }, url) => (await session.fromPartition("persist:atlas-review").cookies.get({ url }))[0], url);
  assert.equal(restored.value, "persisted");
  const history = await window.evaluate(() => window.atlasDesktop.review("/runs"));
  assert(history.some(r => r.findings.some(f => f.status === "verified")), "Finding edits did not survive restart");
  const preferences = await window.evaluate(() => window.atlasDesktop.preferences());
  assert.equal(preferences["atlas-profiles"][0].prompt, "Saved desktop audit preferences");
  assert.equal(preferences["atlas-devices"][0].width, 412);
  assert.equal(preferences["atlas-device-sets"][0].name, "My responsive set");
});

test("cancelling desktop replay retains completed screen evidence", async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await window.evaluate(()=>window.atlasDesktop.review('/flows/record','POST',{masks:''}));
  await inspect(views[0],'document.querySelector("h1").textContent="A screen that will require manual recovery"');
  await window.evaluate(()=>window.atlasDesktop.review('/flows/checkpoint','POST'));
  await window.evaluate(()=>window.atlasDesktop.review('/flows/stop','POST'));
  const devices=(await window.evaluate(()=>window.atlasDesktop.state())).views.slice(0,1).map(v=>v.device);
  const profile={id:'cancellation',name:'Replay cancellation',prompt:'',categories:['SEO'],devices:devices.map(d=>d.id),ai:false,fullPage:false,masks:'',exportPdf:false,outputFolder:root};
  await window.evaluate(body=>window.atlasDesktop.review('/flows/run','POST',body),{devices,profile});
  const state=await until(()=>window.evaluate(()=>window.atlasDesktop.review('/flows')),s=>s.job?.screens[0]?.status==='completed','First screen evidence was not retained',30000);
  await window.evaluate(()=>window.atlasDesktop.review('/flows/cancel','POST'));
  await until(()=>window.evaluate(()=>window.atlasDesktop.review('/flows')),s=>s.job?.status==='cancelled');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),state=>!state.busy,'Replay cancellation did not release the workspace');
  const run=await window.evaluate(id=>window.atlasDesktop.review(`/runs/${id}`),state.job.screens[0].runId);
  assert.equal(run.status,'completed');assert(run.screenshots.length);
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});

test("project sessions isolate sign-ins, clear-login controls, history and temporary-session restart", async () => {
  await window.evaluate(url => window.atlasDesktop.navigate(url), `${url}/sign-in`);
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
  const invoke = async action => {
    await Promise.all([window.waitForEvent("load"), window.evaluate(action).catch(error => { if (!/context.*destroyed|Target.*closed/i.test(error.message)) throw error; })]);
    await window.waitForFunction(() => document.querySelector(".desktop-app"));
  };
  const cookies = () => electron.evaluate(async ({ BrowserWindow }, url) => {
    const view = BrowserWindow.getAllWindows()[0].contentView.children.find(v => v.webContents);
    return view.webContents.session.cookies.get({ url });
  }, url);
  const devices=(await window.evaluate(()=>window.atlasDesktop.state())).views.slice(0,1).map(v=>v.device);
  const profile={id:'project-fixture',name:'Project migration fixture',prompt:'',categories:['SEO'],devices:devices.map(d=>d.id),ai:false,fullPage:false,masks:'',exportPdf:false,outputFolder:root};
  const started=await window.evaluate(({devices,profile})=>window.atlasDesktop.review('/runs','POST',{devices,profile}),{devices,profile});
  await until(()=>window.evaluate(id=>window.atlasDesktop.review(`/runs/${id}`),started.id),r=>r.status!=='running');
  await electron.evaluate(({dialog},root)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:`${root}/project-export.json`});},root);
  await window.evaluate(()=>window.atlasDesktop.data('export'));
  const exported=await readFile(join(root,'project-export.json'),'utf8');assert(!exported.includes('secret-never-export'));assert.equal(JSON.parse(exported).version,1);
  await invoke(() => window.atlasDesktop.project("create", { name: "Isolated temporary project", temporary: true }));
  await until(() => window.evaluate(() => window.atlasDesktop.state()), s => s.projects.selectedId !== "default" && !s.busy && s.views.length === 3);
  const temporaryId = (await window.evaluate(() => window.atlasDesktop.state())).projects.selectedId;
  assert.equal((await cookies()).length, 0);
  assert.equal((await window.evaluate(() => window.atlasDesktop.review("/runs"))).length, 0);
  await electron.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[`${root}/project-export.json`]});},root);
  const preview=await window.evaluate(()=>window.atlasDesktop.data('preview-import'));
  assert(preview.counts.reports>=1);
  assert.equal((await window.evaluate(()=>window.atlasDesktop.review('/runs'))).length,0,'Import preview wrote report data');
  await Promise.all([window.waitForEvent('load'),window.evaluate(token=>window.atlasDesktop.data('apply-import',{token}),preview.token).catch(error=>{if(!/context.*destroyed/i.test(error.message))throw error;})]);
  await window.waitForFunction(()=>document.querySelector('.desktop-app'));
  assert((await window.evaluate(()=>window.atlasDesktop.review('/runs'))).some(run=>run.id===started.id));
  await window.evaluate(url => window.atlasDesktop.navigate(url), `${url}/sign-in`);
  assert.equal((await cookies())[0].value, "persisted");
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
  await invoke(() => window.atlasDesktop.project("clear-login"));
  await until(cookies, []);
  await invoke(() => window.atlasDesktop.project("select", { id: "default" }));
  await until(() => window.evaluate(() => window.atlasDesktop.state()), s => s.projects.selectedId === "default" && !s.busy);
  assert.equal((await cookies())[0].value, "persisted", "Clearing the other project cleared this project's sign-in");
  await Promise.all([window.waitForEvent("load"), window.evaluate(id => window.atlasDesktop.project("select", { id }), temporaryId).catch(error => { if (!/context.*destroyed/i.test(error.message)) throw error; })]);
  await window.waitForFunction(() => document.querySelector(".desktop-app"));
  await until(() => window.evaluate(() => window.atlasDesktop.state()), s => s.projects.selectedId === temporaryId && !s.busy);
  await window.evaluate(url => window.atlasDesktop.navigate(url), `${url}/sign-in`);
  await window.evaluate(url => window.atlasDesktop.navigate(url), url);
  await electron.close(); await launch();
  assert.equal((await cookies()).length, 0, "Temporary cookies survived restart");
  await window.evaluate(()=>window.atlasDesktop.review('/flows/record','POST',{masks:''}));
  const recording=await window.evaluate(()=>window.atlasDesktop.review('/flows'));
  const closed=electron.waitForEvent('close');
  if(process.platform==='win32')await execFileSafe('taskkill',['/PID',String(electron.process().pid),'/T','/F'],{timeout:10000});
  else electron.process().kill('SIGKILL');
  await closed;
  await launch();
  const recovered=await window.evaluate(()=>window.atlasDesktop.review('/flows'));
  assert.equal(recovered.recording,null);assert.equal(recovered.plans.find(plan=>plan.id===recording.selectedId).interruption.reason,'app_restarted');
});

test('a late blur from the previous view preserves the active source and keyboard focus',async()=>{
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
  await click(views[0],'input[name="name"]');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),state=>state.source==='phone'&&state.pending===0,'Initial source focus was not acknowledged');
  await click(views[2],'input[name="name"]');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),state=>state.source==='desktop'&&state.pending===0,'New source focus was not acknowledged');
  await inspect(views[0],'document.querySelector("input[name=name]").blur();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await until(()=>window.evaluate(()=>window.atlasDesktop.state()),state=>state.pending===0);
  assert.equal((await window.evaluate(()=>window.atlasDesktop.state())).source,'desktop','Blur incorrectly claimed source ownership');
  assert.equal(await inspect(views[2],'document.activeElement?.name'),'name','A stale blur removed focus from the new source');
  await window.evaluate(url=>window.atlasDesktop.navigate(url),url);
});
