import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { FlowState } from "./types";

export function useFlowPlanner(enabled: boolean, notify: (message: string) => void) {
  const [state, setState] = useState<FlowState | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const refresh = useCallback(async () => {
    const result = await api<FlowState>("/flows");
    setState(result);
    return result;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<FlowState>("/flows");
        if (!disposed) setState(result);
      } catch { /* The audit panel already exposes companion connection recovery. */ }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [enabled]);
  const perform = useCallback(async (path: string, method = "POST", body: unknown = {}) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await api(path, method, body);
      await refresh();
    } catch (error) { notify((error as Error).message); }
    finally { pendingRef.current = false; setPending(false); }
  }, [notify, refresh]);
  return { state, pending, perform, running: state?.job?.status === "running", recording: Boolean(state?.recording),
    plan: state?.plans.find((plan) => plan.id === state.selectedId) };
}
