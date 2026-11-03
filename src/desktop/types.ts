import type { Device } from "../types";
export type DesktopState = {
  url: string;
  paused: boolean;
  busy: boolean;
  problem: string;
  source: string;
  sequence: number;
  views: { device: Device; status: "loading" | "ready" | "applying" | "out-of-sync"; detail: string; acknowledged: number }[];
  lastExport?: { root: string; runId: string };
};
export type Slot = { id: string; x: number; y: number; width: number; height: number };
export interface DesktopBridge {
  state(): Promise<DesktopState>;
  navigate(url: string): Promise<DesktopState>;
  layout(slots: Slot[]): Promise<void>;
  pause(paused: boolean): Promise<DesktopState>;
  capture(): Promise<DesktopState["lastExport"] | null>;
  reveal(): Promise<void>;
  subscribe(listener: (state: DesktopState) => void): () => void;
}
declare global { interface Window { atlasDesktop: DesktopBridge } }
