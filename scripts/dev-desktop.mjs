import { spawn } from "node:child_process";
import { resolve } from "node:path";
import electron from "electron";
import { build } from "vite";

// Keep development on the same atlas:// protocol and IPC boundary as packaged apps.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let child, watcher, timer;
let stopping = false;
let failed = false;
let generation = 0;
let queue = Promise.resolve();

async function stopChild() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null) return;
  await new Promise((done) => {
    const force = setTimeout(() => running.kill("SIGKILL"), 5000);
    running.once("close", () => { clearTimeout(force); done(); });
    running.kill("SIGTERM");
  });
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  process.exitCode = code;
  await watcher?.close();
  await queue;
  await stopChild();
}

function restart(version) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue.then(async () => {
      if (stopping || version !== generation) return;
      await stopChild();
      if (stopping || version !== generation) return;
      const running = spawn(electron, [".", ...process.argv.slice(2)], { stdio: "inherit", env });
      child = running;
      running.once("spawn", () => console.log(`[desktop] Started Electron (PID ${running.pid}).`));
      running.once("error", (error) => { console.error(error); void shutdown(1); });
      running.once("exit", (code, signal) => {
        if (child === running) console.log(`[desktop] Electron exited (${signal || code}). Waiting for changes; press Ctrl+C to stop.`);
      });
    }).catch((error) => { console.error(error); void shutdown(1); });
  }, 150);
}

try {
  watcher = await build({
    configFile: resolve("vite.desktop.config.ts"),
    build: { watch: {} },
    plugins: [{
      name: "desktop-runtime-watch",
      buildStart() {
        for (const directory of ["desktop", "companion", "public"]) this.addWatchFile(resolve(directory));
      },
    }],
  });
  watcher.on("event", (event) => {
    if (event.code === "START") {
      generation++;
      failed = false;
      clearTimeout(timer);
    }
    if (event.code === "ERROR") failed = true;
    if (event.code === "END" && !failed && !stopping) restart(generation);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void shutdown(); });
} catch (error) {
  console.error(error);
  await shutdown(1);
}
