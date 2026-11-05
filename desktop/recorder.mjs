// Runs in an isolated world. Every recorded value has passed the private-field gate.
export function installRecorder(evidence, binding) {
  if (window !== top || globalThis.__atlasSync) return;
  const state = { applying: false, composing: false, masks: "", testOrigin: "", lastScroll: "", hover: "", drag: null };
  globalThis.__atlasSync = state;
  const editable = el => el?.matches?.('input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],textarea,[contenteditable="true"]');
  const widget = el => el?.matches?.('select,input[type="checkbox"],input[type="radio"],input[type="range"],input[type="number"],input[type="date"],input[type="datetime-local"],input[type="time"],input[type="month"],input[type="week"]');
  const targetOf = el => {
    const target = evidence({ type: "describe-element", element: el, desktop: true, masks: state.masks });
    return target?.risky && state.testOrigin === location.origin && !target.sensitive ? { ...target, risky: false, consequential: true } : target;
  };
  const element = event => event.composedPath()[0];
  const send = event => {
    if (!state.applying) globalThis[binding](JSON.stringify({ ...event, url: location.href }));
  };
  const blocked = reason => send({ type: "blocked", reason });
  const selector = el => el?.id ? `#${CSS.escape(el.id)}` : el?.getAttribute?.('data-testid') ? `[data-testid=${JSON.stringify(el.getAttribute('data-testid'))}]` : "";
  const focus = event => {
    if (!event.isTrusted) return;
    const el = element(event), target = targetOf(el);
    if (!target) return;
    if (el.localName?.includes('-') && !el.shadowRoot) return blocked("This custom or closed-shadow control needs a compatibility check.");
    if (target.sensitive) return blocked("Private fields are edited independently and excluded from synchronization.");
    if (editable(el) || widget(el) || !target.risky) send({ type: "focus", target });
    else if (el.closest?.('input,select,textarea,[contenteditable],canvas,iframe')) blocked("This control needs independent preparation. Synchronization is paused.");
  };
  const edit = event => {
    const el = element(event);
    if (!event.isTrusted || event.isComposing || state.composing || !editable(el)) return;
    const target = targetOf(el);
    if (!target || target.sensitive) return;
    if (el.isContentEditable && el.childElementCount) return blocked("Structured rich-text editing needs independent preparation. Only plain text is synchronized.");
    const value = el.isContentEditable ? el.textContent : el.value;
    if (value.length > 4000) return blocked("This field exceeds the synchronization limit of 4,000 characters.");
    let start = el.selectionStart, end = el.selectionEnd;
    if (el.isContentEditable) {
      const selection = getSelection();
      if (selection?.anchorNode && el.contains(selection.anchorNode) && el.contains(selection.focusNode)) {
        const range = document.createRange(); range.selectNodeContents(el); range.setEnd(selection.anchorNode, selection.anchorOffset); start = range.toString().length;
        range.setEnd(selection.focusNode, selection.focusOffset); end = range.toString().length;
      }
    }
    send({ type: "edit", target, value, start, end,
      direction: el.selectionDirection, inputType: event.inputType, selectionOnly: event.type === "selection", commit: event.type === "change" });
  };
  const change = event => {
    const el = element(event), target = targetOf(el);
    if (!event.isTrusted || !widget(el) || !target || target.sensitive || target.risky) return;
    send({ type: "control", target, ...(el.tagName === "SELECT" ? { selected: [...el.selectedOptions].map(o => o.value) } : el.matches('[type="checkbox"],[type="radio"]') ? { checked: el.checked } : { value: el.value }) });
  };
  const click = event => {
    if (!event.isTrusted) return;
    const el = element(event), target = targetOf(el);
    if (!target) return;
    // Followers retain DOM focus, so switching to one may produce no focusin.
    if ((editable(el) || widget(el)) && !target.sensitive && !target.risky) {
      send({ type: "focus", target });
      return;
    }
    if (el.closest?.('a[download]') || (target.href && /\.(zip|pdf|csv|docx?|xlsx?|exe|dmg)$/i.test(new URL(target.href).pathname))) return blocked("A file link runs in the source only. Approve any requested download in the workspace.");
    if (el.matches?.('canvas,iframe')) return blocked("Canvas and frame interactions require a compatibility check before synchronization.");
    if (target.sensitive || target.risky || event.metaKey || event.ctrlKey || el.closest?.('a[target="_blank"]')) {
      blocked("This private, consequential, or unidentified action runs in the source only. Prepare the other views or replay a saved journey before continuing.");
      return;
    }
    send({ type: event.type === "dblclick" ? "double-click" : "click", target });
  };
  document.addEventListener("focusin", focus, true);
  document.addEventListener("focusout", event => {
    if (!event.isTrusted) return;
    const target = targetOf(element(event));
    if (target && !target.sensitive && !target.risky) send({ type: "blur", target });
  }, true);
  document.addEventListener("compositionstart", () => { state.composing = true; }, true);
  document.addEventListener("compositionend", event => { state.composing = false; queueMicrotask(() => edit(event)); }, true);
  for (const type of ["input", "change"]) document.addEventListener(type, event => { edit(event); change(event); }, true);
  document.addEventListener("selectionchange", event => {
    if (!event.isTrusted || !document.hasFocus()) return;
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    if (editable(el) && !state.composing) edit({ isTrusted: true, composedPath: () => [el], type: "selection" });
  }, true);
  for (const type of ["click", "dblclick"]) document.addEventListener(type, click, true);
  document.addEventListener("keydown", event => {
    if (!event.isTrusted || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") send({ type: "key", key: "Escape", target: targetOf(element(event)) });
  }, true);
  let scrollFrame = 0;
  document.addEventListener("scroll", event => {
    if (state.applying || !event.isTrusted) return;
    const el = event.target === document ? document.scrollingElement : event.target;
    if (!el || (el !== document.scrollingElement && !selector(el))) return;
    if (el !== document.scrollingElement && targetOf(el)?.sensitive) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const nested = el !== document.scrollingElement;
      const data = { type: "scroll", selector: nested ? selector(el) : "", ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight), xRatio: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth) };
      const signature = JSON.stringify(data);
      if (signature === state.lastScroll) return;
      state.lastScroll = signature;
      send(data);
    });
  }, true);
  document.addEventListener("pointerout", event => { if (event.isTrusted) state.hover = ""; }, true);
  document.addEventListener("pointerover", event => {
    if (!event.isTrusted || state.applying) return;
    const el = element(event), target = targetOf(el);
    if (!target || target.sensitive || target.risky || !(el.closest?.('a,button,[role="menuitem"],[aria-haspopup],[aria-expanded]'))) return;
    const signature = JSON.stringify(target);
    if (state.hover === signature) return;
    state.hover = signature;
    const rect = el.getBoundingClientRect();
    send({ type: "hover", target, point: { x: Math.max(0, Math.min(1, (event.clientX - rect.x) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.y) / Math.max(1, rect.height))) } });
  }, true);
  document.addEventListener("dragstart", event => {
    const el = element(event), target = targetOf(el);
    if (!event.isTrusted || target?.risky || target?.sensitive || !selector(el)) return blocked("This drag source needs independent preparation.");
    state.drag = target;
  }, true);
  document.addEventListener("pointerdown", event => {
    const el = element(event), target = targetOf(el);
    if (event.isTrusted && el.matches?.('[draggable="true"]') && target && !target.risky && !target.sensitive) state.drag = target;
  }, true);
  document.addEventListener("pointerup", () => { setTimeout(() => { state.drag = null; }, 0); }, true);
  document.addEventListener("drop", event => {
    if (!event.isTrusted || !state.drag) return;
    const target = element(event), destination = selector(target);
    const source = state.drag; state.drag = null;
    if (!destination || event.dataTransfer?.files.length || targetOf(target)?.sensitive) return blocked("File drops and unidentified drop targets are handled in the source only.");
    setTimeout(() => send({ type: "drag", target: source, destination, contents: [...target.querySelectorAll('[draggable="true"]')].map(el => el.id || el.getAttribute('data-testid')) }), 0);
  }, true);
  document.addEventListener("submit", event => { if (event.isTrusted && state.testOrigin !== location.origin) blocked("Form submission runs in the source only. Other views are paused to prevent duplicate submissions."); }, true);
  window.addEventListener("blur", () => { if (document.activeElement?.matches('iframe,frame')) blocked("Frame interactions need a compatibility check before synchronization."); });
}
