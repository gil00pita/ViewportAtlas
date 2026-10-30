// Restore appearance before the stylesheet paints; this is also bundled with the extension.
try {
  document.documentElement.dataset.theme =
    JSON.parse(localStorage.getItem("atlas-theme")) === "dark"
      ? "dark"
      : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
