const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("atlasDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  navigate: (url) => ipcRenderer.invoke("desktop:navigate", url),
  history: (command) => ipcRenderer.invoke("desktop:history", command),
  retry: () => ipcRenderer.invoke("desktop:retry"),
  popup: () => ipcRenderer.invoke("desktop:popup"),
  download: () => ipcRenderer.invoke("desktop:download"),
  cancelDownload: () => ipcRenderer.invoke("desktop:cancel-download"),
  exclude: (id, excluded) => ipcRenderer.invoke("desktop:exclude", id, excluded),
  testMode: (origin) => ipcRenderer.invoke("desktop:test-mode", origin),
  mapping: (value) => ipcRenderer.invoke("desktop:mapping", value),
  project: (action, body) => ipcRenderer.invoke("desktop:project", action, body),
  data: (action, body) => ipcRenderer.invoke("desktop:data", action, body),
  update: (action) => ipcRenderer.invoke("desktop:update", action),
  layout: (slots) => ipcRenderer.invoke("desktop:layout", slots),
  pause: (paused) => ipcRenderer.invoke("desktop:pause", paused),
  capture: () => ipcRenderer.invoke("desktop:capture"),
  reveal: () => ipcRenderer.invoke("desktop:reveal"),
  presentation: (visible) => ipcRenderer.invoke("desktop:presentation", visible),
  configure: (devices) => ipcRenderer.invoke("desktop:configure", devices),
  preferences: () => ipcRenderer.invoke("desktop:preferences"),
  preference: (key, value) => ipcRenderer.invoke("desktop:preference", key, value),
  review: (path, method, body) => ipcRenderer.invoke("desktop:review", path, method, body),
  pdf: (id, layout, preview) => ipcRenderer.invoke("desktop:pdf", id, layout, preview),
  save: (name, data) => ipcRenderer.invoke("desktop:save", name, data),
  subscribe: (listener) => {
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("desktop:changed", receive);
    return () => ipcRenderer.removeListener("desktop:changed", receive);
  },
});
