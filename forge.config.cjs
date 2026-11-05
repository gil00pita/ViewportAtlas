const release = process.env.ATLAS_RELEASE === "1";
const platform = process.platform;
const required = platform === "darwin"
  ? ["MAC_SIGNING_IDENTITY", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]
  : platform === "win32" ? ["WINDOWS_CERTIFICATE_FILE", "WINDOWS_CERTIFICATE_PASSWORD"] : [];
if (release) for (const key of required) if (!process.env[key]) throw new Error(`Signed release builds require ${key}.`);
module.exports = {
  packagerConfig: {
    name: "Viewport Atlas", executableName: "viewport-atlas", appBundleId: "com.viewportatlas.desktop",
    appCategoryType: "public.app-category.developer-tools",
    asar: { unpackDir: "**/node_modules/@img/**" },
    ignore: [/^\/\.context(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/out(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/src(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/dist\/web(?:\/|$)/],
    ...(release && platform === "darwin" ? {
      osxSign: { identity: process.env.MAC_SIGNING_IDENTITY },
      osxNotarize: { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID },
    } : {}),
    ...(release && platform === "win32" ? { windowsSign: { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } } : {}),
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (_config, buildPath) => {
      await require('node:fs/promises').writeFile(require('node:path').join(buildPath, 'desktop/release.json'), JSON.stringify({ signed: release }));
    },
  },
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "win32"] },
    { name: "@electron-forge/maker-squirrel", platforms: ["win32"], config: {
      name: "ViewportAtlas", authors: "Viewport Atlas", description: "Responsive browser workspace and evidence-based website reviews",
      ...(release ? { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } : {}),
    } },
  ],
  publishers: [{ name: "@electron-forge/publisher-github", config: { repository: { owner: "gil00pita", name: "ViewportAtlas" }, draft: true, prerelease: false } }],
};
