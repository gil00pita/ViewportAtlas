import type { Health } from "./types";
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        id?: string;
        sendMessage: (
          message: unknown,
        ) => Promise<{ data?: unknown; error?: string }>;
      };
    };
  }
}
export const extensionMode = Boolean(window.chrome?.runtime?.id);
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (extensionMode) {
    const result = await window.chrome!.runtime!.sendMessage({
      type: "api",
      path,
      method,
      body,
    });
    if (result.error) throw new Error(result.error);
    return result.data as T;
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
export async function health() {
  return api<Health>("/health");
}
export function assetUrl(path: string) {
  return extensionMode && path.startsWith("/")
    ? `http://127.0.0.1:4318${path}`
    : path;
}
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadJson(name: string, data: unknown) {
  downloadBlob(
    name,
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
}
