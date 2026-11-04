const { app, protocol } = require("electron");

// Register startup-only settings before asynchronous ESM dependencies load.
if (process.env.ATLAS_DESKTOP_STATE_DIR) app.setPath("userData", process.env.ATLAS_DESKTOP_STATE_DIR);
app.setName("Viewport Atlas");
protocol.registerSchemesAsPrivileged([{ scheme: "atlas", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

import("./main.mjs").catch((error) => {
  console.error("Viewport Atlas could not start:", error);
  app.exit(1);
});
