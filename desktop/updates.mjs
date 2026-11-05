export class DesktopUpdates {
  constructor({ updater, version, platform, arch, enabled, busy, changed = () => {} }) {
    Object.assign(this, { updater, busy, changed });
    this.state = { status: enabled ? "idle" : "disabled", detail: enabled ? "Updates are delivered from GitHub Releases." : "Automatic updates are available in signed installed builds." };
    if (!enabled) return;
    updater.setFeedURL({ url: `https://update.electronjs.org/gil00pita/ViewportAtlas/${platform}-${arch}/${version}` });
    for (const [event, status, detail] of [["checking-for-update", "checking", "Checking GitHub Releases…"], ["update-available", "downloading", "Downloading the application update…"], ["update-not-available", "idle", "You have the latest published version."], ["update-downloaded", "ready", "An update is ready. Restart after your review finishes."]]) updater.on(event, () => this.publish(status, detail));
    updater.on("error", error => this.publish("error", `Update check failed: ${error.message}`));
    this.timer = setInterval(() => this.check(), 6 * 60 * 60 * 1000);
    this.timer.unref?.();
    this.initial = setTimeout(() => this.check(), 15000);
    this.initial.unref?.();
  }
  publish(status, detail) { this.state = { status, detail }; this.changed(this.state); }
  check() {
    if (["disabled", "checking", "downloading", "ready"].includes(this.state.status)) return this.state;
    if (this.busy()) { this.publish("deferred", "Update checks wait until recording, replay, and report work finish."); return this.state; }
    try { this.updater.checkForUpdates(); } catch (error) { this.publish("error", error.message); }
    return this.state;
  }
  install() {
    if (this.state.status !== "ready") throw new Error("No downloaded update is ready.");
    if (this.busy()) throw new Error("Finish or cancel recording, replay, downloads, and report work, and wait for settings to save before restarting to update.");
    this.updater.quitAndInstall();
  }
  close() { clearTimeout(this.initial); clearInterval(this.timer); }
}
