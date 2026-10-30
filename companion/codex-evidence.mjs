import { redactText, redactUrl } from "./core.mjs";

// Allocate the prompt fairly across views instead of cutting a JSON string in
// the middle of a code snapshot. Capture files retain the larger local snapshot.
export function codexEvidence(evidence, includePageCode = false) {
  const count = Math.max(1, evidence.length);
  const share = Math.floor(140000 / count);
  const text = (value, limit = 500) => redactText(value ?? "").slice(0, limit);
  return evidence.map((entry) => {
    const meta = entry.metadata || {};
    const result = {
      deviceId: text(entry.deviceId, 80), screenshot: text(entry.screenshot),
      deviceScaleFactor: entry.deviceScaleFactor, width: entry.width, height: entry.height,
      metadata: {
        url: redactUrl(meta.url).slice(0, 1000), title: text(meta.title), description: text(meta.description, 1000),
        lang: text(meta.lang, 40), h1: meta.h1, canonical: meta.canonical ? redactUrl(meta.canonical).slice(0, 1000) : "",
        overflow: meta.overflow, viewport: meta.viewport, timing: meta.timing?.slice(0, 3),
        headings: meta.headings?.slice(0, 50).map((heading) => ({ text: text(heading.text, 200), level: heading.level, bounds: heading.bounds })),
        links: meta.links?.slice(0, 100).map((link) => ({ name: text(link.name, 120), href: redactUrl(link.href).slice(0, 500) })),
        state: meta.state ? { scrollX: meta.state.scrollX, scrollY: meta.state.scrollY,
          openDetails: meta.state.openDetails?.slice(0, 10).map((value) => text(value, 120)),
          selectedTabs: meta.state.selectedTabs?.slice(0, 10).map((value) => text(value, 120)) } : undefined,
        truncated: Boolean(meta.headings?.length > 50 || meta.links?.length > 100),
      },
    };
    // Leave room for code in audits with many selected viewports.
    while (JSON.stringify(result).length > share * (includePageCode ? 0.4 : 0.9) && (result.metadata.links?.length || result.metadata.headings?.length)) {
      if ((result.metadata.links?.length || 0) > (result.metadata.headings?.length || 0)) result.metadata.links.pop();
      else result.metadata.headings.pop();
      result.metadata.truncated = true;
    }
    if (includePageCode && entry.pageCode) {
      const code = entry.pageCode;
      const remaining = Math.max(0, share - JSON.stringify(result).length - 2000);
      const html = text(code.html, Math.floor(remaining * 0.7));
      const css = text(code.css, Math.floor(remaining * 0.3));
      result.pageCode = {
        html, css, scriptUrls: code.scriptUrls?.slice(0, 6).map((url) => text(url, 100)),
        unavailableStylesheets: code.unavailableStylesheets,
        truncated: Boolean(code.truncated || html.length < code.html.length || css.length < code.css.length || code.scriptUrls?.length > 6 || code.scriptUrls?.some((url) => url.length > 100)),
        scope: text(code.scope),
      };
    }
    return result;
  });
}
