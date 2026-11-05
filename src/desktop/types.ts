import type { Device } from "../types";
export type DesktopState = {
  url: string;
  paused: boolean;
  busy: boolean;
  problem: string;
  source: string;
  sequence: number;
  pending: number;
  latency: { samples: number; p95: number };
  mappings: { source: string; viewId: string; selector: string; prepare?: string }[];
  popup: { host: string; armed: boolean } | null;
  download: { filename: string; armed: boolean } | null;
  testOrigin: string;
  canRetry: boolean;
  projects: { selectedId: string; projects: { id: string; name: string; temporary: boolean }[]; unavailableReports: { id: string; detail: string }[] };
  update?: { status: string; detail: string };
  views: { device: Device; status: "loading" | "ready" | "applying" | "out-of-sync"; detail: string; acknowledged: number; excluded: boolean }[];
  lastExport?: { root: string; runId: string };
};
export type Slot = { id: string; x: number; y: number; width: number; height: number };
export interface DesktopBridge {
  state(): Promise<DesktopState>;
  navigate(url: string): Promise<DesktopState>;
  history(command: "back" | "forward" | "reload"): Promise<DesktopState>;
  retry(): Promise<DesktopState>;
  popup(): Promise<void>;
  download(): Promise<void>;
  cancelDownload(): Promise<void>;
  exclude(id: string, excluded: boolean): Promise<void>;
  testMode(origin: string): Promise<void>;
  mapping(value: { source: string; viewId: string; selector: string; prepare?: string }): Promise<void>;
  project(action: "list" | "create" | "select" | "clear-login", body?: { id?: string; name?: string; temporary?: boolean }): Promise<DesktopState["projects"]>;
  data(action: "export" | "preview-import" | "apply-import", body?: { token: string }): Promise<{ token: string; counts: { preferences: number; profiles: number; flows: number; mappings: number; reports: number; duplicates: number } } | null>;
  update(action: "check" | "install"): Promise<void>;
  layout(slots: Slot[]): Promise<void>;
  pause(paused: boolean): Promise<DesktopState>;
  capture(): Promise<DesktopState["lastExport"] | null>;
  reveal(): Promise<void>;
  presentation(visible: boolean): Promise<void>;
  configure(devices: Device[]): Promise<DesktopState>;
  preferences(): Promise<Record<string, unknown>>;
  preference(key: string, value: unknown): Promise<void>;
  review<T = unknown>(path: string, method?: string, body?: unknown): Promise<T>;
  pdf(id: string, layout: "original" | "a4", preview: boolean): Promise<void>;
  save(name: string, data: string): Promise<void>;
  subscribe(listener: (state: DesktopState) => void): () => void;
}
declare global { interface Window { atlasDesktop: DesktopBridge } }
