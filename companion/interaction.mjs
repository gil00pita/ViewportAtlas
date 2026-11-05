// This function is serialized into controlled browser contexts. Never interpolate page text into code.
export function browserEvidence(action) {
  const normalize = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const risky =
    /\b(buy|purchase|pay|checkout|delete|remove|submit|send|confirm|place order|subscribe|log out|sign out|unsubscribe|transfer|cancel order|book now|save changes)\b/i;
  const sensitive = (e) =>
    e.matches?.(
      'input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]',
    ) || e.closest?.("[data-sensitive]") ||
    (action.masks && e.closest?.(action.masks)) || (action.desktop && e.getRootNode?.().host && sensitive(e.getRootNode().host));
  const query = (selector, root = document) => {
    const matches = [...root.querySelectorAll(selector)];
    if (action.desktop) for (const el of root.querySelectorAll("*")) if (el.shadowRoot) matches.push(...query(selector, el.shadowRoot));
    return matches;
  };
  const controls = 'a,button,input,select,textarea,[contenteditable="true"],[role="button"],[role="tab"],[role="menuitem"],summary';
  const descriptor = (e) => {
    const el =
      e?.closest?.(
        controls,
      ) || e;
    if (!el) return null;
    const label = el.getAttribute("aria-label") || el.innerText || "";
    const safeLink =
      el.tagName === "A" &&
      /^https?:/.test(el.href) &&
      !/(?:delete|remove|logout|signout|checkout|purchase|unsubscribe|revoke)(?:[/?#_-]|$)/i.test(
        el.href,
      );
    const safeControl =
      el.matches('[role="tab"],summary,[aria-expanded],[aria-controls]') ||
      el.matches(
        'input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],textarea,select',
      ) ||
      (el.tagName === "BUTTON" &&
        /^(open|close|show|hide|expand|collapse|view|filter|sort|next|previous|back|menu)\b/i.test(
          label,
        )) || (action.desktop && el.matches('input[type="checkbox"],input[type="radio"],input[type="range"],input[type="date"],input[type="datetime-local"],input[type="time"],input[type="month"],input[type="week"],input[type="number"],[contenteditable="true"],[draggable="true"]'));
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      testId: el.getAttribute("data-testid") || "",
      role:
        el.getAttribute("role") ||
        (el.tagName === "A"
          ? "link"
          : ["BUTTON", "SUMMARY"].includes(el.tagName)
            ? "button"
            : ""),
      name: normalize(
        el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.innerText ||
          el.labels?.[0]?.innerText ||
          el.getAttribute("placeholder"),
      ),
      href: el.tagName === "A" ? el.href : "",
      type: el.getAttribute("type") || "",
      fieldName: el.getAttribute("name") || "",
      ...(action.desktop ? { fieldValue: el.matches('input[type="radio"]') ? el.value : "",
        scope: el.closest('form[id],[role="dialog"][id],main[id],nav[id],section[id]')?.id || "" } : {}),
      risky:
        !(safeLink || safeControl) ||
        risky.test(el.innerText || el.getAttribute("aria-label") || "") ||
        (el.matches(
          'button:not([type]),button[type="submit"],input[type="submit"]',
        ) &&
          Boolean(el.closest("form"))),
      sensitive: Boolean(sensitive(el)),
    };
  };
  const visible = (e) =>
    Boolean(e.getClientRects().length) &&
    getComputedStyle(e).visibility !== "hidden" &&
    !e.disabled;
  if (action.type === "describe")
    return descriptor(document.elementFromPoint(action.x, action.y));
  if (action.type === "describe-element") return descriptor(action.element);
  if (action.desktop && action.type === "scroll") {
    const matches = action.selector ? query(action.selector) : [document.scrollingElement];
    if (matches.length !== 1 || !matches[0] || sensitive(matches[0])) return { ok: false, reason: "The corresponding scroll region is missing or ambiguous." };
    const el = matches[0];
    const top = action.ratio * Math.max(0, el.scrollHeight - el.clientHeight), left = action.xRatio * Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollTo({ top, left, behavior: "instant" });
    if (globalThis.__atlasSync) globalThis.__atlasSync.lastScroll = JSON.stringify({ type: "scroll", selector: action.selector, ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight), xRatio: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth) });
    return { ok: Math.abs(el.scrollTop - top) <= 2 && Math.abs(el.scrollLeft - left) <= 2 };
  }
  if (["match", "resolve", "fill", "focus", "blur", "edit", "control", "prepare", "drag"].includes(action.type)) {
    const d = action.descriptor;
    if (!d || (d.risky && !(action.desktop && action.testMode)) || d.sensitive)
      return {
        ok: false,
        reason: "Consequential or sensitive actions are never mirrored.",
      };
    const candidates = query(`${controls},[draggable="true"]`).filter((e) => !sensitive(e));
    const scoped = (e) => (!d.scope || descriptor(e).scope === d.scope) && (!d.fieldValue || e.value === d.fieldValue);
    if (action.selector) {
      const eligible = new Set(candidates);
      const mapped = query(action.selector).filter(e => eligible.has(e) && visible(e));
      if (mapped.length !== 1) return { ok: false, reason: "The saved counterpart mapping is missing or ambiguous." };
      candidates.splice(0, candidates.length, mapped[0]);
    }
    const strategies = [
      d.testId
        ? candidates.filter((e) => e.getAttribute("data-testid") === d.testId)
        : [],
      d.id ? candidates.filter((e) => e.id === d.id) : [],
      d.href
        ? candidates.filter((e) => e.tagName === "A" && e.href === d.href)
        : [],
      d.fieldName
        ? candidates.filter((e) => e.getAttribute("name") === d.fieldName && e.tagName.toLowerCase() === d.tag && scoped(e))
        : [],
      d.name
        ? candidates.filter(
            (e) =>
              descriptor(e).name === d.name &&
              (!d.role || descriptor(e).role === d.role) && scoped(e),
          )
        : [],
    ];
    if (action.selector) strategies.unshift(candidates);
    let hidden = false;
    for (const matches of strategies) {
      if (matches.length) hidden = true;
      const shown = matches.filter(visible);
      if (action.type === "prepare" && !shown.length && matches.length) {
        const ancestors = new Set();
        for (const match of matches) for (let el = match; el; el = el.parentElement) if (el.id) ancestors.add(el.id);
        const toggles = query('[aria-controls][aria-expanded="false"]').filter(el => visible(el) && !sensitive(el) && !descriptor(el).risky && el.getAttribute('aria-controls').split(/\s+/).some(id => ancestors.has(id)));
        if (toggles.length !== 1) return { ok: false, reason: "Prepare the responsive menu or save a counterpart mapping." };
        toggles[0].click();
        return { ok: true, prepared: descriptor(toggles[0]).name };
      }
      if (shown.length > 1)
        return {
          ok: false,
          reason: "More than one element matches this action.",
        };
      if (shown.length === 1) {
          if (descriptor(shown[0]).risky && !(action.desktop && action.testMode))
          return {
            ok: false,
            reason: "The matching action may change server state.",
          };
        if (action.type === "resolve") {
          shown[0].scrollIntoView({ block: "center", inline: "nearest" });
          const r = shown[0].getBoundingClientRect();
          return { ok: true, x: r.x + r.width * (action.point?.x ?? .5), y: r.y + r.height * (action.point?.y ?? .5) };
        }
        if (action.type === "focus") {
          shown[0].focus({ preventScroll: true });
          return { ok: shown[0].getRootNode().activeElement === shown[0] };
        }
        if (action.type === "blur") {
          shown[0].blur();
          return { ok: shown[0].getRootNode().activeElement !== shown[0] };
        }
        if (action.type === "control") {
          const el = shown[0];
          if (el.matches('input[type="checkbox"],input[type="radio"]')) {
            if (typeof action.checked !== "boolean") return { ok: false, reason: "Invalid recorded checked state." };
            if (el.checked !== action.checked) el.click();
            return { ok: el.checked === action.checked, reason: "The page rejected the mirrored checked state." };
          } else if (el.tagName === "SELECT") {
            if (JSON.stringify([...el.selectedOptions].map(o => o.value)) === JSON.stringify(action.selected)) return { ok: true };
            const available = new Set([...el.options].map(option => option.value));
            if (!Array.isArray(action.selected) || action.selected.some(value => !available.has(value))) return { ok: false, reason: "The selected option is unavailable." };
            const selected = new Set(action.selected);
            for (const option of el.options) option.selected = selected.has(option.value);
          } else if (el.matches('input[type="number"],input[type="range"],input[type="date"],input[type="time"],input[type="datetime-local"],input[type="month"],input[type="week"]')) {
            if (typeof action.value !== "string" || action.value.length > 4000) return { ok: false, reason: "Invalid recorded widget value." };
            if (el.value === action.value) return { ok: true };
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(action.value));
          } else return { ok: false, reason: "This widget needs independent preparation." };
          el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
          const ok = el.tagName === "SELECT" ? JSON.stringify([...el.selectedOptions].map(o => o.value)) === JSON.stringify(action.selected) : el.matches('[type="checkbox"],[type="radio"]') ? el.checked === action.checked : el.value === action.value;
          return { ok, reason: ok ? undefined : "The page rejected the mirrored widget state." };
        }
        if (action.type === "edit") {
          const el = shown[0];
          if (typeof action.value !== "string" || action.value.length > 4000)
            return { ok: false, reason: "Live text synchronization supports up to 4,000 characters per field." };
          if (action.desktop && el.isContentEditable) {
            if (el.childElementCount) return { ok: false, reason: "Structured rich-text editing needs independent preparation." };
            el.focus({ preventScroll: true });
            el.textContent = action.value;
            el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: action.inputType || "insertText" }));
            if (Number.isInteger(action.start) && Number.isInteger(action.end)) {
              if (!el.firstChild) el.append(document.createTextNode(''));
              const length = el.firstChild.textContent.length;
              el.getRootNode().getSelection?.()?.setBaseAndExtent(el.firstChild, Math.min(length, action.start), el.firstChild, Math.min(length, action.end));
            }
            return { ok: el.textContent === action.value };
          }
          if (!el.matches('input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="url"],input[type="tel"],textarea'))
            return { ok: false, reason: "This field is not supported by live text synchronization yet." };
          el.focus({ preventScroll: true });
          const changed = el.value !== action.value;
          const prototype = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, action.value);
          if (changed) el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: action.inputType || "insertText" }));
          if (Number.isInteger(action.start) && Number.isInteger(action.end) && el.setSelectionRange) {
            try { el.setSelectionRange(action.start, action.end, action.direction || "none"); } catch { /* Email and other non-selection inputs have no caret interface. */ }
          }
          if (action.commit) el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: el.value === action.value, reason: el.value === action.value ? undefined : "The page changed the mirrored field value." };
        }
        if (action.type === "fill") {
          const el = shown[0];
          if (!el.matches('input:not([type]),input[type="text"],input[type="search"],input[type="email"],textarea,select'))
            return { ok: false, reason: "This field cannot be replayed." };
          if (el.tagName === "SELECT" && ![...el.options].some((option) => option.value === String(action.value)))
            return { ok: false, reason: "The recorded option is no longer available." };
          const prototype = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, String(action.value).slice(0, 4000));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }
        if (action.type === "drag") {
          const destination = query(action.destination).filter(visible);
          if (destination.length !== 1 || sensitive(destination[0])) return { ok: false, reason: "The drop destination is missing or ambiguous." };
          const transfer = new DataTransfer();
          for (const [node, type] of [[shown[0], 'dragstart'], [destination[0], 'dragenter'], [destination[0], 'dragover'], [destination[0], 'drop'], [shown[0], 'dragend']]) node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
          const contents = [...destination[0].querySelectorAll('[draggable="true"]')].map(el => el.id || el.getAttribute('data-testid'));
          return { ok: !action.contents || JSON.stringify(contents) === JSON.stringify(action.contents), reason: "The drop outcome differs across viewports." };
        }
        if (action.doubleClick) shown[0].dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, detail: 2 }));
        else shown[0].click();
        return { ok: true };
      }
    }
    return {
      ok: false,
      reason: hidden
        ? "Matching element is hidden. Open the corresponding menu, then resync."
        : "No corresponding element was found.",
    };
  }
  if (action.type === "scroll-info") {
    const sections = [
      ...document.querySelectorAll(
        "section[id],main[id],h1[id],h2[id],article[id]",
      ),
    ];
    const section = sections
      .filter((e) => e.getBoundingClientRect().top <= 80)
      .at(-1);
    return {
      ratio:
        scrollY /
        Math.max(1, document.documentElement.scrollHeight - innerHeight),
      section: section?.id || "",
      offset: section ? -section.getBoundingClientRect().top : 0,
    };
  }
  if (action.type === "scroll-to") {
    const target = action.section
      ? document.getElementById(action.section)
      : null;
    scrollTo({
      top: target
        ? scrollY + target.getBoundingClientRect().top + action.offset
        : action.ratio *
          Math.max(0, document.documentElement.scrollHeight - innerHeight),
      behavior: "instant",
    });
    return { ok: true };
  }
  if (action.type === "input") {
    const el = document.activeElement;
    if (
      !el ||
      sensitive(el) ||
      !el.matches("input,textarea") ||
      el.type === "hidden"
    )
      return {
        ok: false,
        reason: "This field cannot be edited through the workspace.",
      };
    el.value = String(action.value).slice(0, 4000);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true, descriptor: descriptor(el) };
  }
  if (action.type === "metadata") {
    const excluded =
      action.masks ||
      'input[type="password"],input[autocomplete*="cc-"],[data-sensitive]';
    const safe = (el) => !el.closest(excluded);
    const bounds = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return {
      url: location.href,
      title: document.title,
      description:
        document.querySelector('meta[name="description"]')?.content || "",
      lang: document.documentElement.lang,
      h1: document.querySelectorAll("h1").length,
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      timing: performance.getEntriesByType("navigation").map((t) => ({
        type: t.type,
        domContentLoadedMs: Math.round(t.domContentLoadedEventEnd),
        loadMs: Math.round(t.loadEventEnd),
        responseMs: Math.round(t.responseStart),
      })),
      headings: [...document.querySelectorAll("h1,h2,h3")]
        .filter(safe)
        .slice(0, 50)
        .map((e) => ({
          text: e.textContent?.slice(0, 200),
          level: e.tagName,
          bounds: bounds(e),
        })),
      links: [...document.querySelectorAll("a")]
        .filter(safe)
        .slice(0, 100)
        .map((e) => ({
          name:
            e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 120),
          href: e.href,
        })),
      state: {
        scrollX,
        scrollY,
        openDetails: [...document.querySelectorAll("details[open]")]
          .filter(safe)
          .map((e) => e.id || e.querySelector("summary")?.textContent),
        selectedTabs: [...document.querySelectorAll('[aria-selected="true"]')]
          .filter(safe)
          .map((e) => e.textContent?.slice(0, 100)),
      },
    };
  }
  return null;
}
