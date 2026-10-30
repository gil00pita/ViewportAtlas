import { watch } from "node:fs";
import { spawn } from "node:child_process";
let child;
let timer;
let restart = false;
let stopping = false;
function start() {
  child = spawn(process.execPath, ["companion/server.mjs", "--dev"], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (stopping) process.exit(0);
    if (restart) {
      restart = false;
      start();
    } else process.exit(code || 0);
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
const watcher = watch("companion", (event, file) => {
  if (!file?.endsWith(".mjs") || stopping) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    restart = true;
    child.kill("SIGTERM");
  }, 250);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
    watcher.close();
    clearTimeout(timer);
    child?.kill(signal);
  });
start();
