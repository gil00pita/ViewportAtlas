import { api, assetUrl, downloadBlob, extensionMode } from "./api";

export type PdfLayout = "original" | "a4";

export async function exportPdfReport(runId: string, preview: boolean, layout: PdfLayout = "original") {
  // Reserve the preview during the click, before asynchronous PDF generation.
  const tab = preview ? window.open("about:blank", "_blank") : null;
  if (preview && !tab) {
    throw new Error(
      "Allow pop-ups for Viewport Atlas to preview the PDF, or download the report instead.",
    );
  }
  if (tab) {
    tab.opener = null;
    tab.document.title = "Preparing PDF report";
    tab.document.body.textContent = "Preparing your PDF report…";
  }
  let url: string | undefined;
  try {
    // Native messaging starts a stopped companion before the binary HTTP request.
    if (extensionMode) await api("/health");
    const response = await fetch(
      assetUrl(`/api/runs/${encodeURIComponent(runId)}/report.pdf?inline=1&layout=${layout}`),
    );
    if (!response.ok) {
      let message = `PDF export failed (HTTP ${response.status}).`;
      try {
        const error = await response.json();
        if (typeof error.error === "string") message = error.error;
      } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    if ((await blob.slice(0, 5).text()) !== "%PDF-") {
      throw new Error(
        "The companion did not return a valid PDF. Try generating the report again.",
      );
    }
    if (tab) {
      if (tab.closed) return;
      url = URL.createObjectURL(blob);
      tab.location.replace(url);
      const previewUrl = url;
      const timer = window.setInterval(() => {
        if (tab.closed) {
          URL.revokeObjectURL(previewUrl);
          window.clearInterval(timer);
        }
      }, 1000);
    } else {
      downloadBlob(`Viewport-Atlas-${runId}${layout === "a4" ? "-A4" : ""}.pdf`, blob);
    }
  } catch (error) {
    tab?.close();
    if (url) URL.revokeObjectURL(url);
    throw error;
  }
}
