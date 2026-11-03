// Fixed functions serialized into inspected pages. Page content is always data.
export function flowPageState(masks = "") {
  const excluded = ['[data-sensitive]', masks].filter(Boolean).join(",");
  const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest(excluded);
  return {
    url: location.href,
    title: document.title,
    ready: document.readyState,
    heading: [...document.querySelectorAll("h1")].filter(visible)[0]?.textContent?.trim().slice(0, 160) || "",
    tabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(visible).map((el) => (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 120)),
    details: [...document.querySelectorAll("details[open]")].filter(visible).map((el) => el.id || el.querySelector("summary")?.textContent?.trim().slice(0, 120) || ""),
    dialogs: [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible).map((el) => el.getAttribute("aria-label") || document.getElementById(el.getAttribute("aria-labelledby"))?.textContent?.trim().slice(0, 120) || "dialog"),
  };
}

export function recordFlowPage(evidence, stateOfPage, options) {
  if (window !== top || window.__atlasFlowRecorder) return;
  let timer, scrollTimer, maxWait, changed = false;
  const send = (event) => {
    try { window[options.binding](JSON.stringify({ ...event, url: location.href })); } catch { /* Recording may have stopped. */ }
  };
  const privateTarget = (el) => el?.closest?.('input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]') || (options.masks && el?.closest?.(options.masks));
  const later = () => {
    clearTimeout(timer);
    const snapshot = () => { changed = false; clearTimeout(timer); clearTimeout(maxWait); maxWait = null; send({ type: "state", state: stateOfPage(options.masks) }); };
    timer = setTimeout(snapshot, 500);
    if (!maxWait) maxWait = setTimeout(snapshot, 3000);
  };
  const click = (event) => {
    if (!event.isTrusted) return;
    if (!event.target.closest?.('a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],summary')) return;
    changed = true;
    if (privateTarget(event.target)) send({ type: "blocked", label: "Private interaction omitted" });
    else {
      const target = evidence({ type: "describe-element", element: event.target, masks: options.masks });
      if (target?.risky || target?.sensitive || event.ctrlKey || event.metaKey || event.target.closest?.('a[target="_blank"],iframe'))
        send({ type: "blocked", label: "Interaction needs manual review" });
      else if (target) send({ type: "click", target, label: target.name || target.id || "Click control" });
    }
    later();
  };
  const change = (event) => {
    if (!event.isTrusted || privateTarget(event.target)) return;
    const target = evidence({ type: "describe-element", element: event.target, masks: options.masks });
    if (!target || target.risky || target.sensitive) return;
    if (!event.target.matches('input:not([type]),input[type="text"],input[type="search"],input[type="email"],textarea,select')) return;
    changed = true;
    send({ type: "input", target, label: target.name || target.id || "Edit field", value: event.target.value.slice(0, 4000) });
    later();
  };
  const scroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => send({ type: "scroll", scroll: evidence({ type: "scroll-info" }), label: "Scroll page" }), 250);
  };
  const observer = new MutationObserver(() => { if (changed) later(); });
  const submit = (event) => { if (event.isTrusted) send({ type: "blocked", label: "Form submission needs manual review" }); };
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "aria-expanded", "aria-selected", "hidden", "class"] });
  document.addEventListener("click", click, true);
  document.addEventListener("change", change, true);
  document.addEventListener("submit", submit, true);
  window.addEventListener("scroll", scroll, { passive: true });
  window.__atlasFlowRecorder = {
    stop() {
      clearTimeout(timer); clearTimeout(scrollTimer); clearTimeout(maxWait); observer.disconnect();
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("scroll", scroll);
      delete window.__atlasFlowRecorder;
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => send({ type: "state", state: stateOfPage(options.masks) }), { once: true });
  else send({ type: "state", state: stateOfPage(options.masks) });
}
