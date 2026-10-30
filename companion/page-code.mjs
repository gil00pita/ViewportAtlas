// Serialized into the page in both Playwright and Chrome CDP. No external reads.
export function collectPageCode({ masks = "" } = {}) {
  const HTML_LIMIT = 32000, CSS_LIMIT = 16000, NODE_LIMIT = 2500;
  const selectors = ['input[type="password"],input[type="file"],input[autocomplete*="cc-"],input[autocomplete*="password"],[data-sensitive]', masks].filter(Boolean).join(",");
  document.querySelectorAll(selectors); // Invalid masks must fail closed.
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const safeUrl = (value) => {
    if (value.length > 4096) { truncated = true; return "[URL omitted: too long]"; }
    try {
      const url = new URL(value, document.baseURI);
      if (!["http:", "https:"].includes(url.protocol)) return "[omitted]";
      url.username = ""; url.password = ""; url.search = ""; url.hash = "";
      return url.href.slice(0, 512);
    } catch { return "[omitted]"; }
  };
  // Keep layout and presentation declarations, excluding generated content,
  // URLs, custom-property payloads, and embedded data.
  const safeStyle = (style) => [...style].filter((name) =>
    /^(display|position|top|right|bottom|left|inset(?:-.+)?|z-index|width|height|min-.+|max-.+|margin(?:-.+)?|padding(?:-.+)?|border(?:-.+)?|box-sizing|box-shadow|color|background-color|font(?:-.+)?|line-height|letter-spacing|text-align|text-decoration(?:-.+)?|text-transform|white-space|word-break|overflow(?:-.+)?|flex(?:-.+)?|grid(?:-.+)?|gap|row-gap|column-gap|align-.+|justify-.+|order|opacity|visibility|transform|object-fit|aspect-ratio|cursor)$/.test(name) &&
    !/url\s*\(|expression\s*\(|data:|https?:|[<>]/i.test(style.getPropertyValue(name)),
  ).map((name) => `${name}: ${style.getPropertyValue(name).slice(0, 512)}${style.getPropertyPriority(name) ? " !important" : ""};`).join(" ");
  const attributes = new Set(["id", "class", "role", "lang", "dir", "type", "name", "alt", "title", "width", "height", "tabindex", "disabled", "required", "for", "colspan", "rowspan", "scope", "open", "hidden"]);
  const urls = new Set(["href", "src", "action", "poster"]);
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  let html = "", visited = 0, truncated = false;
  const append = (value) => {
    const remaining = HTML_LIMIT - html.length;
    if (value.length > remaining) truncated = true;
    html += value.slice(0, Math.max(0, remaining));
  };
  const walk = (node, depth = 0) => {
    if (html.length >= HTML_LIMIT || ++visited > NODE_LIMIT || depth > 48) { truncated = true; return; }
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent || "", remaining = HTML_LIMIT - html.length;
      if (value.length > remaining) truncated = true;
      append(escape(value.slice(0, Math.max(0, remaining)))); return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches(selectors)) { append("<!-- masked region omitted -->"); return; }
    const tag = node.localName;
    if (["script", "style", "noscript", "template", "meta", "base", "link", "iframe", "object", "embed"].includes(tag)) return;
    append(`<${tag}`);
    for (const attribute of node.attributes) {
      const name = attribute.name.toLowerCase();
      let value;
      if (urls.has(name)) value = safeUrl(attribute.value);
      else if (name === "style") value = safeStyle(node.style);
      else if (attributes.has(name) || /^aria-[a-z-]+$/.test(name)) value = attribute.value.slice(0, 1000);
      if (value) append(` ${name}="${escape(value)}"`);
    }
    append(">");
    if (voidTags.has(tag)) return;
    if (["textarea", "select", "option"].includes(tag) || node.isContentEditable) append("[editable content omitted]");
    else if (tag === "svg") append("<!-- SVG paths omitted -->");
    else for (const child of node.childNodes) {
      walk(child, depth + 1);
      if (html.length >= HTML_LIMIT || visited >= NODE_LIMIT) break;
    }
    append(`</${tag}>`);
  };
  walk(document.documentElement);
  let css = "", rulesVisited = 0, unavailableStylesheets = 0;
  const stylesheets = [], scriptUrls = [];
  const readRules = (rules, depth = 0) => {
    if (depth > 8) { truncated = true; return ""; }
    let result = "";
    for (const rule of rules) {
      if (++rulesVisited > 1500 || result.length + css.length >= CSS_LIMIT) { truncated = true; break; }
      if (rule.selectorText && rule.style) {
        // Attribute-value selectors can contain form values or session tokens.
        if (/\[[^\]]*=/.test(rule.selectorText)) continue;
        let element;
        try { element = document.querySelector(rule.selectorText); } catch { continue; }
        if (!element || element.closest(selectors)) continue;
        const declarations = safeStyle(rule.style);
        if (declarations) result += `${rule.selectorText.slice(0, 1000)} { ${declarations} }\n`;
      } else if (rule.cssRules) {
        let header;
        if (rule.type === 4) header = `@media ${rule.conditionText}`;
        else if (rule.type === 12) header = `@supports ${rule.conditionText}`;
        else if (rule.constructor.name === "CSSLayerBlockRule") header = `@layer ${rule.name || ""}`;
        else if (rule.constructor.name === "CSSContainerRule") header = `@container ${rule.containerName || ""} ${rule.conditionText}`;
        else continue;
        if (/\[[^\]]*=|url\s*\(/i.test(header)) continue;
        const nested = readRules(rule.cssRules, depth + 1);
        if (nested) result += `${header.slice(0, 1000)} {\n${nested}}\n`;
      }
    }
    return result;
  };
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
  if (sheets.length > 20) truncated = true;
  for (const sheet of sheets.slice(0, 20)) {
    let readable = true;
    try { css += readRules(sheet.cssRules); }
    catch { readable = false; unavailableStylesheets++; }
    stylesheets.push({ url: sheet.href ? safeUrl(sheet.href) : "[inline or adopted stylesheet]", readable });
    if (css.length >= CSS_LIMIT) { truncated = true; break; }
  }
  const scripts = document.querySelectorAll("script[src]");
  if (scripts.length > 12) truncated = true;
  for (const script of [...scripts].slice(0, 12)) {
    if (!script.closest(selectors)) scriptUrls.push(safeUrl(script.src));
  }
  return {
    html, css: css.slice(0, CSS_LIMIT), scriptUrls, stylesheets,
    truncated, unavailableStylesheets,
    scope: "Rendered HTML and matching readable CSS only. Form values, masked regions, inline scripts, event handlers, embedded documents, and JavaScript bundles are omitted. No source repository or server code is available.",
  };
}
