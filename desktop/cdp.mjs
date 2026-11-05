// A stopped or hostile page must not hold the trusted workspace indefinitely.
export function pageCommand(entry, method, params, options) {
  return pageOperation(() => entry.view.webContents.debugger.sendCommand(method, params), options);
}

export async function captureScreenshot(entry, params, options) {
  if (!params.captureBeyondViewport) {
    // Prime the native surface while Electron holds its capture visibility lease.
    // This image is discarded; DevTools retains the emulated 2× evidence pixels.
    await pageOperation(() => entry.view.webContents.capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: true }), options);
  }
  return pageCommand(entry, 'Page.captureScreenshot', params, options);
}

function pageOperation(dispatch, { signal, timeout = 15000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason || new Error('Page operation cancelled.'));
    const timer = setTimeout(() => finish(reject, new Error('The browser did not acknowledge the operation in time. Its outcome is uncertain; do not repeat it automatically.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (!settled) return dispatch(); }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
