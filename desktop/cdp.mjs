// A stopped or hostile page must not hold the trusted workspace indefinitely.
export function pageCommand(entry, method, params, { signal, timeout = 15000 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason || new Error('Page operation cancelled.'));
    const timer = setTimeout(() => finish(reject, new Error('The browser did not acknowledge the operation in time. Its outcome is uncertain; do not repeat it automatically.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (!settled) return entry.view.webContents.debugger.sendCommand(method, params); }).then(value => finish(resolve, value), error => finish(reject, error));
  });
}
