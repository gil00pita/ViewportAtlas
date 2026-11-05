const { app, protocol } = require("electron");

// Register startup-only settings before asynchronous ESM dependencies load.
if (process.env.ATLAS_DESKTOP_STATE_DIR) app.setPath("userData", process.env.ATLAS_DESKTOP_STATE_DIR);
if (process.platform === "win32") {
  // Evidence capture must keep rendering when native browser views are clipped.
  const disabled = app.commandLine.getSwitchValue("disable-features");
  app.commandLine.appendSwitch("disable-features", [disabled, "CalculateNativeWinOcclusion"].filter(Boolean).join(","));
}
app.setName("Viewport Atlas");
if (process.platform === "win32") app.setAppUserModelId("com.squirrel.ViewportAtlas.viewport-atlas");
protocol.registerSchemesAsPrivileged([{ scheme: "atlas", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (process.platform === "win32" && require("electron-squirrel-startup")) app.quit();
else if (!app.requestSingleInstanceLock()) app.quit();
else import("./main.mjs").catch((error) => {
  console.error("Viewport Atlas could not start:", error);
  app.exit(1);
});
