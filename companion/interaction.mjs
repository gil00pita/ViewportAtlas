// This function is serialized into controlled browser contexts. Never interpolate page text into code.
export function browserEvidence(action) {
  const normalize = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const risky =
    /\b(buy|purchase|pay|checkout|delete|remove|submit|send|confirm|place order|subscribe|log out|sign out|unsubscribe|transfer|cancel order|book now|save changes)\b/i;
  const sensitive = (e) =>
    e.matches?.(
      'input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]',
    ) || e.closest?.("[data-sensitive]");
  const descriptor = (e) => {
    const el =
      e?.closest?.(
        'a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],summary',
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
        'input[type="text"],input[type="search"],input[type="email"],textarea',
      ) ||
      (el.tagName === "BUTTON" &&
        /^(open|close|show|hide|expand|collapse|view|filter|sort|next|previous|back|menu)\b/i.test(
          label,
        ));
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
  if (action.type === "match") {
    const d = action.descriptor;
    if (!d || d.risky || d.sensitive)
      return {
        ok: false,
        reason: "Consequential or sensitive actions are never mirrored.",
      };
    const candidates = [
      ...document.querySelectorAll(
        'a,button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],summary',
      ),
    ].filter((e) => !sensitive(e));
    const strategies = [
      d.testId
        ? candidates.filter((e) => e.getAttribute("data-testid") === d.testId)
        : [],
      d.id ? candidates.filter((e) => e.id === d.id) : [],
      d.href
        ? candidates.filter((e) => e.tagName === "A" && e.href === d.href)
        : [],
      d.name
        ? candidates.filter(
            (e) =>
              descriptor(e).name === d.name &&
              (!d.role || descriptor(e).role === d.role),
          )
        : [],
    ];
    let hidden = false;
    for (const matches of strategies) {
      if (matches.length) hidden = true;
      const shown = matches.filter(visible);
      if (shown.length > 1)
        return {
          ok: false,
          reason: "More than one element matches this action.",
        };
      if (shown.length === 1) {
        if (descriptor(shown[0]).risky)
          return {
            ok: false,
            reason: "The matching action may change server state.",
          };
        shown[0].click();
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
