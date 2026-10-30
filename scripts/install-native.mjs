import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, platform } from "node:os";
const id = process.argv[2];
if (!/^[a-p]{32}$/.test(id || "")) {
  console.error(
    "Usage: npm run install:native -- YOUR_32_CHARACTER_CHROME_EXTENSION_ID",
  );
  process.exit(1);
}
if (!["darwin", "linux"].includes(platform())) {
  console.error(
    "Native Messaging installation currently supports macOS and Linux. Use npm start for standalone mode on this platform.",
  );
  process.exit(1);
}
const state = join(homedir(), ".viewport-atlas");
await mkdir(state, { recursive: true, mode: 0o700 });
const hostPath = join(state, "native-host");
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
await writeFile(
  hostPath,
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("companion/native-host.mjs"))} "$@"\n`,
  { mode: 0o700 },
);
const dir =
  platform() === "darwin"
    ? join(
        homedir(),
        "Library/Application Support/Google/Chrome/NativeMessagingHosts",
      )
    : join(homedir(), ".config/google-chrome/NativeMessagingHosts");
await mkdir(dir, { recursive: true });
await writeFile(
  join(dir, "com.viewportatlas.companion.json"),
  JSON.stringify(
    {
      name: "com.viewportatlas.companion",
      description: "Viewport Atlas local companion",
      path: hostPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${id}/`],
    },
    null,
    2,
  ),
);
await writeFile(join(state, "extension-id"), id, { mode: 0o600 });
console.log(
  "Native host registered for your extension. Restart the companion and reload the extension. Keep this checkout and its Node installation at their current paths.",
);
