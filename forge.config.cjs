module.exports = {
  packagerConfig: {
    name: "Viewport Atlas", executableName: "viewport-atlas",
    // Sharp's native binary loads libvips beside it through the OS loader.
    asar: { unpackDir: "**/node_modules/@img/**" },
    ignore: [/^\/\.context(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/out(?:\/|$)/, /^\/tests(?:\/|$)/, /^\/src(?:\/|$)/, /^\/docs(?:\/|$)/, /^\/dist\/web(?:\/|$)/],
  },
  rebuildConfig: {},
  makers: [
    { name: "@electron-forge/maker-zip", platforms: ["darwin", "win32"] },
  ],
};
