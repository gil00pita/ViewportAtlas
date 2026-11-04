import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { access } from "node:fs/promises";

const folder = resolve("out", `Viewport Atlas-${process.platform}-${process.arch}`);
const executable = process.platform === "darwin"
  ? join(folder, "Viewport Atlas.app", "Contents", "MacOS", "viewport-atlas")
  : join(folder, process.platform === "win32" ? "viewport-atlas.exe" : "viewport-atlas");
await access(executable);
const child = spawn(process.execPath, ["--test", "tests/desktop.integration.mjs"], {
  stdio: "inherit", env: { ...process.env, ATLAS_DESKTOP_EXECUTABLE: executable },
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
