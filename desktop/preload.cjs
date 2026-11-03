const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("atlasDesktop", {
  state: () => ipcRenderer.invoke("desktop:state"),
  navigate: (url) => ipcRenderer.invoke("desktop:navigate", url),
  layout: (slots) => ipcRenderer.invoke("desktop:layout", slots),
  pause: (paused) => ipcRenderer.invoke("desktop:pause", paused),
  capture: () => ipcRenderer.invoke("desktop:capture"),
  reveal: () => ipcRenderer.invoke("desktop:reveal"),
  subscribe: (listener) => {
    const receive = (_event, state) => listener(state);
    ipcRenderer.on("desktop:changed", receive);
    return () => ipcRenderer.removeListener("desktop:changed", receive);
  },
});
