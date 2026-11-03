// Serialized into an isolated browser world. No page text is interpolated as code.
export function installRecorder(evidence, binding) {
  if (window !== top || globalThis.__atlasSync) return;
  const state = { applying: false };
  globalThis.__atlasSync = state;
  const editable = (el) => el?.matches?.('input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],textarea');
  const send = (event) => {
    if (state.applying) return;
    globalThis[binding](JSON.stringify({ ...event, url: location.href }));
  };
  const targetOf = (el) => evidence({ type: "describe-element", element: el });
  const focus = (event) => {
    if (!event.isTrusted) return;
    const target = targetOf(event.target);
    if (!target) return;
    if (target.sensitive) return send({ type: "blocked", reason: "Private fields are edited independently and excluded from synchronization." });
    if (editable(event.target)) send({ type: "focus", target });
    else if (event.target.closest?.('input,select,textarea,[contenteditable]'))
      send({ type: "blocked", reason: "This control is not supported by live text synchronization yet. Other views are paused." });
  };
  const edit = (event) => {
    if (!event.isTrusted || event.isComposing || !editable(event.target)) return;
    const el = event.target, target = targetOf(el);
    if (!target || target.sensitive) return;
    if (el.value.length > 4000) return send({ type: "blocked", reason: "This field exceeds the live synchronization limit of 4,000 characters." });
    send({ type: "edit", target, value: el.value, start: el.selectionStart, end: el.selectionEnd,
      direction: el.selectionDirection, inputType: event.inputType, commit: event.type === "change" });
  };
  const click = (event) => {
    if (!event.isTrusted) return;
    const target = targetOf(event.target);
    if (!target) return;
    if (editable(event.target) && !target.sensitive) return send({ type: "focus", target });
    if (target.sensitive || target.risky || event.metaKey || event.ctrlKey || event.target.closest?.('a[target="_blank"]')) {
      // Plain page background clicks do not imply a meaningful unmatched action.
      if (event.target.closest?.('a,button,input,select,textarea,[role="button"],[role="tab"],summary'))
        send({ type: "blocked", reason: "This action needs independent preparation. Use Reload views to restart synchronization." });
      return;
    }
    send({ type: "click", target });
  };
  document.addEventListener("focusin", focus, true);
  document.addEventListener("input", edit, true);
  document.addEventListener("change", edit, true);
  document.addEventListener("click", click, true);
  document.addEventListener("submit", (event) => {
    if (event.isTrusted) send({ type: "blocked", reason: "Form submission runs in the source only. Other views are paused to prevent duplicate submissions." });
  }, true);
}
