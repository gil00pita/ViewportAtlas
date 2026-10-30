import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  Monitor,
  Smartphone,
  Tablet,
  LayoutDashboard,
  FileText,
  History,
  Layers,
  Settings,
  ArrowUpRight,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Link2,
  MousePointer2,
  ArrowDownUp,
  TextCursorInput,
  Maximize,
  MoreHorizontal,
  Check,
  CheckCheck,
  X,
  FolderOpen,
  Download,
  ExternalLink,
  ShieldCheck,
  Accessibility,
  Gauge,
  Search,
  ScanLine,
  Sparkles,
  SlidersHorizontal,
  Globe,
  HelpCircle,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Upload,
  CheckCircle2,
  Info,
  ZoomIn,
  ZoomOut,
  PanelRightClose,
  PanelRightOpen,
  GripVertical,
  Shield,
  Terminal,
  Unplug,
  Menu,
  Send,
  GitCompareArrows,
  BookOpen,
  Moon,
  Sun,
} from "lucide-react";
import { api, assetUrl, downloadJson, extensionMode, health } from "./api";
import {
  DEVICES,
  CATEGORIES,
  PROFILES,
  type Device,
  type Profile,
  type View,
  type Run,
  type Health,
  type Finding,
  type Category,
} from "./types";
type Page =
  "workspace" | "reports" | "history" | "templates" | "settings" | "guide";
type Sync = {
  navigation: boolean;
  clicks: boolean;
  scrolling: boolean;
  forms: boolean;
};
const categoryIcons = {
  Accessibility,
  Performance: Gauge,
  "UX / UI": MousePointer2,
  SEO: Search,
  "Best practices": ShieldCheck,
};
function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}
const deviceIcon = (d: Device, size = 16) =>
  d.mobile ? (
    <Smartphone size={size} />
  ) : d.width < 1000 ? (
    <Tablet size={size} />
  ) : (
    <Monitor size={size} />
  );
function IconButton({
  label,
  children,
  onClick,
  active,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${checked ? "checked" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span />
    </button>
  );
}
function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    load<string>("atlas-theme", "light") === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save("atlas-theme", theme);
  }, [theme]);
  const [page, setPage] = useState<Page>("workspace");
  const [tab, setTab] = useState<"views" | "findings">("views");
  const [status, setStatus] = useState<Health | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const connected = Boolean(status);
  const [devices, setDevices] = useState<Device[]>(() =>
    load("atlas-devices", DEVICES.slice(0, 3)),
  );
  const [deviceSets, setDeviceSets] = useState<
    { name: string; devices: Device[] }[]
  >(() => load("atlas-device-sets", []));
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    load("atlas-profiles", PROFILES),
  );
  const [profileId, setProfileId] = useState(() =>
    load("atlas-profile-id", "general"),
  );
  const profile =
    profiles.find((p) => p.id === profileId) || profiles[0] || PROFILES[0];
  const [views, setViews] = useState<View[]>([]);
  const [url, setUrl] = useState(() => load("atlas-url", ""));
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeDevice, setActiveDevice] = useState(devices[0]?.id || "");
  const [sync, setSync] = useState<Sync>(() =>
    load("atlas-sync", {
      navigation: true,
      clicks: true,
      scrolling: true,
      forms: false,
    }),
  );
  const [imageVersion, setImageVersion] = useState(0);
  const [zoom, setZoom] = useState(100);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(1000);
  const [canvasGap, setCanvasGap] = useState(20);
  const [rightPanel, setRightPanel] = useState(true);
  const [modal, setModal] = useState<
    "devices" | "capture" | "export" | "manual" | "profile" | null
  >(null);
  const [toast, setToast] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const runId = run?.id;
  const [runBusy, setRunBusy] = useState(false);
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [findingDevice, setFindingDevice] = useState("all");
  const [verification, setVerification] = useState("all");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [templateEditor, setTemplateEditor] = useState<Profile | null>(null);
  const [manual, setManual] = useState({
    title: "",
    impact: "",
    recommendation: "",
    severity: "medium",
    category: "UX / UI",
  });
  const [exportBoard, setExportBoard] = useState("");
  const [miroBoards, setMiroBoards] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [exportBusy, setExportBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [captureResult, setCaptureResult] = useState<
    | {
        deviceId: string;
        path: string;
        width: number;
        height: number;
        truncated: boolean;
      }[]
    | null
  >(null);
  const [customDevice, setCustomDevice] = useState({
    name: "Custom device",
    width: 1024,
    height: 768,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRequest = useRef(0);
  const operation = useRef(false);
  const draggedDevice = useRef<string | null>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 6000);
  }, []);
  const refreshHealth = useCallback(async () => {
    try {
      const h = await health();
      setStatus(h);
      setConnectionError("");
      return h;
    } catch (e) {
      setStatus(null);
      setConnectionError((e as Error).message);
      return null;
    }
  }, []);
  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 20000);
    return () => clearInterval(t);
  }, [refreshHealth]);
  useEffect(() => {
    save("atlas-devices", devices);
  }, [devices]);
  useEffect(() => {
    save("atlas-profiles", profiles);
  }, [profiles]);
  useEffect(() => {
    save("atlas-profile-id", profileId);
  }, [profileId]);
  useEffect(() => {
    save("atlas-sync", sync);
  }, [sync]);
  useEffect(() => {
    save("atlas-device-sets", deviceSets);
  }, [deviceSets]);
  useEffect(() => {
    if (connected && !url) {
      const initial = extensionMode ? "" : `${location.origin}/demo.html`;
      if (initial) {
        setUrl(initial);
        setAddress(initial);
      }
    }
  }, [connected, url]);
  useEffect(() => {
    if (!devices.some((d) => d.id === activeDevice && !d.hidden))
      setActiveDevice(
        devices.find((d) => !d.hidden)?.id || devices[0]?.id || "",
      );
  }, [devices, activeDevice]);
  useEffect(() => {
    if (
      !connected ||
      busy ||
      runBusy ||
      page !== "workspace" ||
      tab !== "views"
    )
      return;
    const timer = setInterval(async () => {
      if (document.hidden || operation.current) return;
      try {
        const data = await api<View[]>("/views");
        setViews(data);
        setImageVersion((v) => v + 1);
      } catch {}
    }, 4000);
    return () => clearInterval(timer);
  }, [connected, busy, runBusy, page, tab]);
  const loadViews = useCallback(
    async (target: string, list: Device[]) => {
      if (!target || !list.length) return;
      const request = ++viewRequest.current;
      setBusy(true);
      try {
        const data = await api<View[]>("/views", "POST", {
          url: target,
          devices: list,
        });
        if (request === viewRequest.current) {
          setViews(data);
          setImageVersion((v) => v + 1);
          save("atlas-url", target);
        }
      } catch (e) {
        if (request === viewRequest.current)
          setViews(
            list.map((d) => ({
              id: d.id,
              device: d,
              url: target,
              error: (e as Error).message,
            })),
          );
        notify((e as Error).message);
      } finally {
        if (request === viewRequest.current) setBusy(false);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (connected && url) loadViews(url, devices);
  }, [connected, url, devices, loadViews]);
  useEffect(() => {
    if (extensionMode)
      api<{ url: string }>("/current-tab")
        .then((d) => {
          setUrl(d.url);
          setAddress(d.url);
        })
        .catch((e) => notify(e.message));
  }, [notify]);
  useEffect(() => {
    setAddress(url);
  }, [url]);
  const refreshHistory = useCallback(async () => {
    try {
      setRuns(await api<Run[]>("/runs"));
    } catch (e) {
      notify((e as Error).message);
    }
  }, [notify]);
  useEffect(() => {
    if (connected) refreshHistory();
  }, [connected, refreshHistory]);
  useEffect(() => {
    if (!runBusy || !runId) return;
    const t = setInterval(async () => {
      try {
        const r = await api<Run>(`/runs/${runId}`);
        setRun(r);
        if (r.status !== "running") {
          setRunBusy(false);
          setTab("findings");
          setPage("workspace");
          refreshHistory();
          notify(
            r.status === "completed"
              ? `Review ready · ${r.findings.length} findings backed by evidence`
              : r.error || `Audit ${r.status}`,
          );
        }
      } catch (e) {
        setRunBusy(false);
        notify(
          `Companion disconnected. Reconnect, then reopen the audit from history. ${(e as Error).message}`,
        );
      }
    }, 1000);
    return () => clearInterval(t);
  }, [runBusy, runId, notify, refreshHistory]);
  const interact = async (id: string, action: Record<string, unknown>) => {
    if (operation.current) return;
    operation.current = true;
    try {
      setActiveDevice(id);
      const data = await api<View[]>(`/views/${id}/action`, "POST", {
        action,
        sync,
      });
      setViews(data);
      setImageVersion((v) => v + 1);
      const source = data.find((v) => v.id === id);
      if (source?.url) setAddress(source.url);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      operation.current = false;
    }
  };
  const navigate = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const target = new URL(
        address.includes("://") ? address : `https://${address}`,
      );
      if (!["http:", "https:"].includes(target.protocol))
        throw Error("Only HTTP and HTTPS pages are supported.");
      if (target.href === url) loadViews(url, devices);
      else setUrl(target.href);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const updateProfile = (patch: Partial<Profile>) => {
    setProfiles((ps) =>
      ps.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)),
    );
  };
  const selectPage = (next: Page) => {
    setPage(next);
    setMenu(null);
    setSidebarOpen(false);
    if (next === "history" || next === "reports") refreshHistory();
  };
  const startAudit = async () => {
    if (!profile.categories.length) {
      notify("Choose at least one audit category.");
      return;
    }
    if (profile.ai && !consent) {
      setModal("capture");
      return;
    }
    setModal(null);
    setRun(null);
    setRunBusy(true);
    try {
      const d = devices.filter((d) => profile.devices.includes(d.id));
      if (!d.length)
        throw Error("Choose at least one device in audit settings.");
      const result = await api<Run>("/runs", "POST", {
        url: views.find((v) => v.id === activeDevice)?.url || url,
        devices: d,
        profile,
      });
      setRun(result);
      notify("Audit started. Evidence is being captured locally.");
    } catch (e) {
      setRunBusy(false);
      notify((e as Error).message);
    }
  };
  const capture = async () => {
    setBusy(true);
    setModal("capture");
    setCaptureResult(null);
    try {
      const result = await api<{
        screenshots: NonNullable<typeof captureResult>;
      }>("/capture", "POST", {
        devices: devices.filter((d) => !d.hidden),
        masks: profile.masks,
        fullPage: profile.fullPage,
      });
      setCaptureResult(result.screenshots);
      notify("Screenshots saved locally. Sensitive fields are masked.");
    } catch (e) {
      notify((e as Error).message);
      setModal(null);
    } finally {
      setBusy(false);
    }
  };
  const saveFinding = async (f: Finding) => {
    if (!run) return;
    try {
      const updated = await api<Run>(
        `/runs/${run.id}/findings/${f.id}`,
        "PATCH",
        f,
      );
      setRun(updated);
      setSelectedFinding(null);
      notify("Finding updated. Report and evidence package saved.");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const addManual = async () => {
    if (!run || !manual.title.trim()) return;
    try {
      const f: Finding = {
        id: crypto.randomUUID(),
        category: manual.category as Category,
        title: manual.title.trim(),
        severity: manual.severity as Finding["severity"],
        url: run.url,
        devices: [activeDevice],
        evidence: [],
        impact: manual.impact,
        recommendation: manual.recommendation,
        source: "manual",
        confidence: 1,
        status: "unverified",
      };
      setRun(await api<Run>(`/runs/${run.id}/findings`, "POST", f));
      setModal(null);
      setManual({
        title: "",
        impact: "",
        recommendation: "",
        severity: "medium",
        category: "UX / UI",
      });
      notify("Manual observation added.");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const openRun = (r: Run) => {
    setRun(r);
    setRunBusy(r.status === "running");
    setPage("workspace");
    setTab("findings");
  };
  const filteredFindings =
    run?.findings.filter(
      (f) =>
        (severity === "all" || f.severity === severity) &&
        (category === "all" || f.category === category) &&
        (findingDevice === "all" || f.devices.includes(findingDevice)) &&
        (verification === "all" || f.status === verification) &&
        (!search ||
          `${f.title} ${f.impact}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    ) || [];
  const selectedCount = devices.filter((d) =>
    profile.devices.includes(d.id),
  ).length;
  const visibleDevices = devices.filter((d) => !d.hidden);
  const example = url.includes("/demo.html");
  const showExport = async () => {
    if (!run) {
      notify("Run an audit first to export a report.");
      return;
    }
    setModal("export");
    if (status?.miro)
      try {
        setMiroBoards(await api("/miro/boards"));
      } catch (e) {
        notify((e as Error).message);
      }
  };
  const doMiroExport = async () => {
    if (!run || !exportBoard) return;
    setExportBusy(true);
    try {
      const result = await api<{ url: string; created: number }>(
        `/runs/${run.id}/miro`,
        "POST",
        { boardId: exportBoard },
      );
      notify(`${result.created} editable Miro objects exported.`);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  };
  const importProfiles = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const list = Array.isArray(data) ? data : [data];
      if (
        !list.length ||
        list.length > 50 ||
        list.some(
          (p) =>
            !p ||
            typeof p.name !== "string" ||
            !p.name.trim() ||
            p.name.length > 100 ||
            typeof p.prompt !== "string" ||
            p.prompt.length > 16000 ||
            (p.description !== undefined &&
              typeof p.description !== "string") ||
            (p.masks !== undefined && typeof p.masks !== "string") ||
            (p.outputFolder !== undefined &&
              typeof p.outputFolder !== "string") ||
            (p.ai !== undefined && typeof p.ai !== "boolean") ||
            (p.fullPage !== undefined && typeof p.fullPage !== "boolean") ||
            (p.exportPdf !== undefined && typeof p.exportPdf !== "boolean") ||
            (p.devices !== undefined &&
              (!Array.isArray(p.devices) ||
                p.devices.some((d: unknown) => typeof d !== "string"))) ||
            !Array.isArray(p.categories) ||
            p.categories.some(
              (c: string) => !CATEGORIES.includes(c as Category),
            ),
        )
      )
        throw Error("Choose a valid Viewport Atlas profiles JSON file.");
      setProfiles((ps) => [
        ...ps,
        ...list.map((p) => ({ ...PROFILES[0], ...p, id: crypto.randomUUID() })),
      ]);
      notify(`${list.length} profile${list.length > 1 ? "s" : ""} imported.`);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const newProfile = () => {
    setTemplateEditor({
      ...PROFILES[0],
      id: crypto.randomUUID(),
      name: "Untitled profile",
    });
    setModal("profile");
  };
  const findingOpen = Boolean(selectedFinding);
  useEffect(() => {
    if (!modal && !findingOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),textarea,select,[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        setSelectedFinding(null);
      }
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [modal, findingOpen]);
  const renderSidebar = () => (
    <aside
      aria-label="Workspace navigation"
      className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
    >
      <a
        href="#workspace"
        className="brand"
        onClick={(e) => {
          e.preventDefault();
          selectPage("workspace");
        }}
      >
        <img src="/viewport-atlas-logo.svg" alt="" />
        <span>
          Viewport
          <span>
            Atlas<span className="brand-dot">.</span>
          </span>
        </span>
      </a>
      <div className="sidebar-tagline">Every screen. One clear picture.</div>
      <div className="workspace-picker">
        <span className="workspace-avatar">V</span>
        <span>
          My workspace<small>Personal workspace</small>
        </span>
        <ChevronDown size={14} />
      </div>
      <nav aria-label="Main navigation">
        {(
          [
            { id: "workspace", icon: LayoutDashboard, label: "Workspace" },
            { id: "reports", icon: FileText, label: "Reports" },
            { id: "history", icon: History, label: "Audit history" },
            { id: "templates", icon: Layers, label: "Audit profiles" },
          ] as const
        ).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? "selected" : ""}`}
            onClick={() => selectPage(id)}
          >
            <Icon size={18} />
            <span>{label}</span>
            {id === "workspace" && <span className="nav-indicator" />}
            {id === "reports" &&
              runs.filter((r) => r.status === "completed").length > 0 && (
                <span className="nav-count">
                  {runs.filter((r) => r.status === "completed").length}
                </span>
              )}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => selectPage("guide")}>
          <BookOpen size={18} />
          <span>Getting started</span>
          <ArrowUpRight size={14} />
        </button>
        <button
          className={`nav-item ${page === "settings" ? "selected" : ""}`}
          onClick={() => selectPage("settings")}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <div className="companion-card">
          <div className="companion-heading">
            <span className={`status-dot ${status ? "online" : ""}`} />
            <strong>Local companion</strong>
            <span className="local-tag">LOCAL</span>
          </div>
          <p>
            {status
              ? "Connected and ready to explore."
              : "Waiting for connection."}
          </p>
          <button onClick={() => selectPage("settings")}>
            {status ? "Manage connection" : "Connect companion"}
            <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="sidebar-foot">
          <ShieldCheck size={14} />
          <span>Your workspace stays yours.</span>
        </div>
      </div>
    </aside>
  );
  const renderHeader = () => (
    <header className="app-header">
      <div className="breadcrumbs">
        <IconButton
          label="Toggle navigation"
          className="mobile-menu"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <Menu size={19} />
        </IconButton>
        <span>My workspace</span>
        <ChevronRight size={13} />
        <strong>
          {page === "workspace"
            ? "Responsive preview"
            : page === "templates"
              ? "Audit profiles"
              : page === "history"
                ? "Audit history"
                : page === "settings"
                  ? "Settings"
                  : page === "guide"
                    ? "Getting started"
                    : "Reports"}
        </strong>
      </div>
      <div className="header-right">
        <span className="header-local">
          <span className={`status-dot ${status ? "online" : ""}`} />
          {status ? "Companion connected" : "Companion offline"}
        </span>
        <span className="header-divider" />
        <button
          type="button"
          className="icon-button theme-toggle"
          aria-label="Dark theme"
          aria-pressed={theme === "dark"}
          title={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
          onClick={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <IconButton label="Getting started" onClick={() => selectPage("guide")}>
          <HelpCircle size={18} />
        </IconButton>
        <span className="user-avatar" title="Personal local workspace">
          You
        </span>
      </div>
    </header>
  );
  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setCanvasWidth(entries[0].contentRect.width);
      setCanvasGap(
        Number.parseFloat(getComputedStyle(entries[0].target).columnGap) || 20,
      );
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [page, tab]);
  const renderDevice = (d: Device, index: number) => {
    const v = views.find((v) => v.id === d.id);
    return (
      <DevicePreview
        key={d.id}
        device={d}
        view={v}
        active={activeDevice === d.id}
        imageVersion={imageVersion}
        busy={busy}
        basis={
          (Math.max(
            d.mobile ? 199 : d.width < 1000 ? 220 : 270,
            ((canvasWidth -
              Math.max(0, visibleDevices.length - 1) * canvasGap) *
              (d.mobile ? 0.82 : d.width < 1000 ? 1.1 : 1.5)) /
              visibleDevices.reduce(
                (total, item) =>
                  total + (item.mobile ? 0.82 : item.width < 1000 ? 1.1 : 1.5),
                0,
              ),
          ) *
            zoom) /
          100
        }
        index={index}
        onSelect={() => setActiveDevice(d.id)}
        onAction={(action) => interact(d.id, action)}
        onMenu={() => setMenu(menu === d.id ? null : d.id)}
        menu={menu === d.id}
        onRotate={() =>
          setDevices((ds) =>
            ds.map((x) =>
              x.id === d.id ? { ...x, width: x.height, height: x.width } : x,
            ),
          )
        }
        onHide={() =>
          setDevices((ds) =>
            ds.map((x) => (x.id === d.id ? { ...x, hidden: true } : x)),
          )
        }
        onRemove={() =>
          setDevices((ds) =>
            ds.length > 1 ? ds.filter((x) => x.id !== d.id) : ds,
          )
        }
        onMove={() =>
          setDevices((ds) => {
            const n = [...ds];
            const i = n.findIndex((x) => x.id === d.id);
            if (i > 0) [n[i - 1], n[i]] = [n[i], n[i - 1]];
            return n;
          })
        }
        onDrag={() => {
          draggedDevice.current = d.id;
        }}
        onDrop={() => {
          const source = draggedDevice.current;
          if (source && source !== d.id)
            setDevices((ds) => {
              const list = [...ds];
              const from = list.findIndex((x) => x.id === source);
              const to = list.findIndex((x) => x.id === d.id);
              list.splice(to, 0, list.splice(from, 1)[0]);
              return list;
            });
        }}
      />
    );
  };
  const renderSettingsPanel = () => (
    <aside className="audit-panel" aria-label="Audit configuration">
      <div className="panel-heading">
        <div>
          <ScanLine size={18} />
          <h2>Audit settings</h2>
        </div>
        <IconButton
          label="Hide audit settings"
          onClick={() => setRightPanel(false)}
        >
          <PanelRightClose size={16} />
        </IconButton>
      </div>
      <div className="audit-panel-body">
        <div className="field-label">
          Audit profile <span>6 built-in profiles</span>
        </div>
        <div className="profile-select">
          <Layers size={16} />
          <select
            value={profile.id}
            onChange={(e) => setProfileId(e.target.value)}
            aria-label="Audit profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <p className="field-description">{profile.description}</p>
        <div className="panel-section">
          <div className="section-heading">
            <h3>What to check</h3>
            <button
              className="text-button"
              onClick={() =>
                updateProfile({
                  categories:
                    profile.categories.length === CATEGORIES.length
                      ? []
                      : CATEGORIES,
                })
              }
            >
              {profile.categories.length === CATEGORIES.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          <div className="category-list">
            {CATEGORIES.map((c) => {
              const Icon = categoryIcons[c];
              const checked = profile.categories.includes(c);
              return (
                <button
                  key={c}
                  className="category-option"
                  aria-pressed={checked}
                  onClick={() =>
                    updateProfile({
                      categories: checked
                        ? profile.categories.filter((x) => x !== c)
                        : [...profile.categories, c],
                    })
                  }
                >
                  <span className={`checkbox ${checked ? "checked" : ""}`}>
                    {checked && <Check size={11} />}
                  </span>
                  <Icon size={16} />
                  <span>{c}</span>
                  {c === "UX / UI" && <span className="tiny-label">AI</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="panel-section">
          <div className="section-heading">
            <h3>Devices to audit</h3>
            <span>{selectedCount} selected</span>
          </div>
          <div className="audit-devices">
            {devices.map((d) => (
              <button
                key={d.id}
                className={`audit-device ${profile.devices.includes(d.id) ? "checked" : ""}`}
                onClick={() =>
                  updateProfile({
                    devices: profile.devices.includes(d.id)
                      ? profile.devices.filter((x) => x !== d.id)
                      : [...profile.devices, d.id],
                  })
                }
                aria-pressed={profile.devices.includes(d.id)}
              >
                {deviceIcon(d, 15)}
                <span>
                  {d.width < 1000
                    ? d.mobile
                      ? "Mobile"
                      : "Tablet"
                    : "Desktop"}
                </span>
                {profile.devices.includes(d.id) && <Check size={11} />}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-section">
          <div className="section-heading">
            <h3>Custom instructions</h3>
            <span>Optional</span>
          </div>
          <textarea
            className="instructions"
            placeholder="Anything you’d like us to focus on?"
            aria-label="Custom audit instructions"
            value={
              profile.prompt ===
              PROFILES.find((p) => p.id === profile.id)?.prompt
                ? ""
                : profile.prompt
            }
            onChange={(e) => updateProfile({ prompt: e.target.value })}
          />
          <div className="ai-setting">
            <div>
              <Sparkles size={15} />
              <span>Codex analysis</span>
            </div>
            <Toggle
              label="Enable Codex analysis"
              checked={profile.ai}
              onChange={() => {
                updateProfile({ ai: !profile.ai });
                setConsent(false);
              }}
            />
          </div>
          <p className="field-description">
            {profile.ai
              ? "Screenshots and page evidence are sent to Codex. Review before running."
              : "Optional AI insights, using your local Codex CLI."}
          </p>
        </div>
        <div className="capture-row">
          <div>
            <ScanLine size={15} />
            <span>Full-page screenshots</span>
          </div>
          <Toggle
            label="Full-page screenshots"
            checked={profile.fullPage}
            onChange={() => updateProfile({ fullPage: !profile.fullPage })}
          />
        </div>
        <button
          className="advanced-settings"
          onClick={() => {
            setTemplateEditor({ ...profile });
            setModal("profile");
          }}
        >
          <SlidersHorizontal size={15} />
          <span>Advanced settings</span>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="audit-panel-footer">
        <div className="scope-note">
          <Info size={13} />
          <span>Just this page. No site-wide crawling.</span>
        </div>
        <button
          className="primary-button run-audit"
          disabled={runBusy || busy || !status || !selectedCount}
          onClick={startAudit}
        >
          {runBusy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <ScanLine size={17} />
          )}
          <span>{runBusy ? "Audit in progress…" : "Run audit"}</span>
          {!runBusy && <span className="button-shortcut">↵</span>}
        </button>
        {runBusy && (
          <>
            <p className="progress-text" role="status">
              {run?.progress || "Preparing audit…"}
            </p>
            <button
              className="text-button"
              onClick={() =>
                run &&
                api(`/runs/${run.id}/cancel`, "POST", {}).catch((e) =>
                  notify(e.message),
                )
              }
            >
              Cancel audit
            </button>
          </>
        )}
        <div className="local-footnote">
          <ShieldCheck size={12} />
          <span>Evidence saved locally. AI is optional.</span>
        </div>
      </div>
    </aside>
  );
  const renderWorkspace = () => (
    <>
      <div className="page-intro">
        <div>
          <h1>
            Every screen. One clear picture<span>.</span>
          </h1>
          <p>A fresh perspective on your website, at every size.</p>
        </div>
        <div className="intro-actions">
          <button className="button" onClick={showExport}>
            <Download size={15} />
            Export report
          </button>
          <button
            className="primary-button"
            onClick={() => setModal("devices")}
          >
            <Plus size={17} />
            Add view
          </button>
        </div>
      </div>
      <div className="workspace-shell">
        <div className="workspace-topline">
          <div className="workspace-tabs">
            <button
              className={tab === "views" ? "active" : ""}
              onClick={() => setTab("views")}
            >
              <Monitor size={16} />
              Responsive workspace
            </button>
            <button
              className={tab === "findings" ? "active" : ""}
              onClick={() => setTab("findings")}
            >
              <CheckCheck size={16} />
              Findings
              {run && (
                <span className="tab-count">
                  {run.findings.filter((f) => f.status !== "dismissed").length}
                </span>
              )}
            </button>
          </div>
          <div className="topline-actions">
            <span className="saved-indicator">
              <Check size={13} />
              Saved locally
            </span>
            {!rightPanel && (
              <IconButton
                label="Show audit settings"
                onClick={() => setRightPanel(true)}
              >
                <PanelRightOpen size={17} />
              </IconButton>
            )}
          </div>
        </div>
        <div className="workspace-body">
          <div className="workspace-main">
            {tab === "views" ? (
              <>
                <div className="address-toolbar">
                  <div className="address-nav">
                    <IconButton
                      label="Go back"
                      disabled={!views.length || busy}
                      onClick={() => interact(activeDevice, { type: "back" })}
                    >
                      <ArrowLeft size={16} />
                    </IconButton>
                    <IconButton
                      label="Go forward"
                      disabled={!views.length || busy}
                      onClick={() =>
                        interact(activeDevice, { type: "forward" })
                      }
                    >
                      <ArrowRight size={16} />
                    </IconButton>
                    <IconButton
                      label="Reload all views"
                      disabled={busy}
                      onClick={() => loadViews(url, devices)}
                    >
                      <RotateCw size={15} className={busy ? "spin" : ""} />
                    </IconButton>
                  </div>
                  <form className="address-input" onSubmit={navigate}>
                    <Globe size={15} />
                    <input
                      aria-label="Website address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Enter a website URL…"
                    />
                    <button
                      type="submit"
                      title="Navigate to website"
                      aria-label="Navigate to website"
                    >
                      <ArrowRight size={15} />
                    </button>
                  </form>
                  <IconButton
                    label="Open website in a new tab"
                    onClick={() =>
                      window.open(address, "_blank", "noopener,noreferrer")
                    }
                  >
                    <ExternalLink size={15} />
                  </IconButton>
                  <span className="toolbar-divider" />
                  <button
                    className="capture-button"
                    aria-label="Capture screenshots"
                    onClick={capture}
                    disabled={busy || !views.length}
                  >
                    <ScanLine size={15} />
                    <span>Capture</span>
                  </button>
                </div>
                <div className="sync-toolbar">
                  <div className="sync-group">
                    <span className="sync-label">
                      <Link2 size={14} />
                      Sync
                    </span>
                    {(
                      [
                        { key: "navigation", label: "Navigation", icon: Link2 },
                        { key: "clicks", label: "Clicks", icon: MousePointer2 },
                        {
                          key: "scrolling",
                          label: "Scroll",
                          icon: ArrowDownUp,
                        },
                        {
                          key: "forms",
                          label: "Inputs",
                          icon: TextCursorInput,
                        },
                      ] as const
                    ).map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        className={`sync-chip ${sync[key] ? "on" : ""}`}
                        aria-pressed={sync[key]}
                        title={
                          key === "forms"
                            ? "Sensitive fields and submissions are never mirrored"
                            : `Synchronize ${label.toLowerCase()}`
                        }
                        onClick={() =>
                          setSync((s) => ({ ...s, [key]: !s[key] }))
                        }
                      >
                        <Icon size={12} />
                        {label}
                        <span className="chip-dot" />
                      </button>
                    ))}
                  </div>
                  <div className="view-controls">
                    <button
                      className="text-button zoom-fit"
                      onClick={() => setZoom(100)}
                    >
                      <Maximize size={13} />
                      Fit
                    </button>
                    <span className="toolbar-divider" />
                    <IconButton
                      label="Zoom out"
                      onClick={() => setZoom((z) => Math.max(50, z - 10))}
                    >
                      <ZoomOut size={14} />
                    </IconButton>
                    <span className="zoom-label">{zoom}%</span>
                    <IconButton
                      label="Zoom in"
                      onClick={() => setZoom((z) => Math.min(150, z + 10))}
                    >
                      <ZoomIn size={14} />
                    </IconButton>
                  </div>
                </div>
                <div className="canvas-top">
                  <div>
                    <span className="canvas-label">Device views</span>
                    <span className="count-label">{visibleDevices.length}</span>
                    <span className="canvas-description">
                      Different sizes. Same perspective.
                    </span>
                  </div>
                  <div className="canvas-top-right">
                    <button
                      className="text-button"
                      onClick={() => {
                        const name = window.prompt(
                          "Name this device set",
                          "My device set",
                        );
                        if (name?.trim()) {
                          setDeviceSets((s) => [
                            ...s,
                            { name: name.trim(), devices },
                          ]);
                          notify("Device set saved.");
                        }
                      }}
                    >
                      <Layers size={13} />
                      Save set
                    </button>
                    {devices.some((d) => d.hidden) && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setDevices((ds) =>
                            ds.map((d) => ({ ...d, hidden: false })),
                          )
                        }
                      >
                        <Eye size={13} />
                        Show hidden
                      </button>
                    )}
                  </div>
                </div>
                <div className="device-canvas" ref={canvasRef}>
                  {!status ? (
                    <div className="connection-empty">
                      <img
                        src="/viewport-atlas-logo.svg"
                        alt="Viewport Atlas"
                      />
                      <h2>Let’s get connected.</h2>
                      <p>
                        Start the local companion to bring your website into
                        focus.
                      </p>
                      <code>npm run dev</code>
                      <button
                        className="primary-button"
                        onClick={() => refreshHealth()}
                      >
                        Reconnect companion
                      </button>
                      <p className="subtle">{connectionError}</p>
                    </div>
                  ) : (
                    visibleDevices.map(renderDevice)
                  )}
                </div>
                <div className="canvas-bottom">
                  <span>
                    <span className={`status-dot ${busy ? "" : "online"}`} />
                    {busy
                      ? "Loading selected views…"
                      : views.length
                        ? `${visibleDevices.length} views ready`
                        : "Preparing views…"}
                    {example && (
                      <span className="example-badge">Example website</span>
                    )}
                  </span>
                  <span>
                    <MousePointer2 size={12} />
                    Click a view to interact
                    <span className="bottom-dot">·</span>Chromium viewport
                    emulation
                  </span>
                </div>
                <div className="workspace-tip">
                  <span className="tip-icon">
                    <Sparkles size={15} />
                  </span>
                  <p>
                    <strong>A little perspective goes a long way.</strong>{" "}
                    Click, scroll, and explore in one view. Your other screens
                    follow along.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => selectPage("guide")}
                  >
                    Explore the guide
                    <ArrowUpRight size={13} />
                  </button>
                </div>
              </>
            ) : (
              renderFindings()
            )}
          </div>
          {rightPanel && renderSettingsPanel()}
        </div>
      </div>
      <div className="workspace-disclaimer">
        <Shield size={12} />
        <span>
          {extensionMode
            ? "Browser tabs share Chrome cookies and server state."
            : "Standalone views share an isolated Chromium session."}{" "}
          Passwords and payment fields are masked.{" "}
          <button onClick={() => selectPage("guide")}>
            How previews work
            <ArrowUpRight size={11} />
          </button>
        </span>
        <span className="version-label">
          VIEWPORT ATLAS <b>v0.1</b>
        </span>
      </div>
    </>
  );
  const renderFindings = () => (
    <div className="findings-view">
      <div className="findings-heading">
        <div>
          <h2>
            {run ? "A clearer picture." : "Start with a little evidence."}
          </h2>
          <p>
            {run
              ? `${run.findings.filter((f) => f.status !== "dismissed").length} findings · ${run.devices.length} device views · ${new Date(run.createdAt).toLocaleDateString()}`
              : "Run your first audit to uncover what’s working and what needs attention."}
          </p>
        </div>
        {run && (
          <button className="button" onClick={() => setModal("manual")}>
            <Plus size={14} />
            Add observation
          </button>
        )}
      </div>
      {run ? (
        <>
          <div className="audit-summary">
            <div className={`run-status ${run.status}`}>
              <span className="status-dot online" />
              {run.status}
            </div>
            <span className="summary-url">{run.url}</span>
            <button className="text-button" onClick={showExport}>
              <Download size={14} />
              Export
            </button>
          </div>
          {run.status === "running" && (
            <p className="notice">
              <Loader2 className="spin" size={16} />
              {run.progress}
            </p>
          )}
          {run.error && (
            <p className="notice warning">
              <AlertTriangle size={16} />
              {run.error}
            </p>
          )}
          {run.comparison && (
            <div className="comparison-bar">
              <GitCompareArrows size={16} />
              <span>
                <strong>{run.comparison.new.length}</strong> new
              </span>
              <span>
                <strong>{run.comparison.resolved.length}</strong> resolved
              </span>
              <span>
                <strong>{run.comparison.recurring.length}</strong> recurring
              </span>
              <span>Compared with previous review of this URL</span>
            </div>
          )}
          <div className="finding-filters">
            <select
              aria-label="Filter by severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="all">All severities</option>
              {["critical", "high", "medium", "low", "info"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Filter by device"
              value={findingDevice}
              onChange={(e) => setFindingDevice(e.target.value)}
            >
              <option value="all">All devices</option>
              {run.devices.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by verification"
              value={verification}
              onChange={(e) => setVerification(e.target.value)}
            >
              <option value="all">All statuses</option>
              {["unverified", "verified", "dismissed"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="finding-list">
            {filteredFindings.length ? (
              filteredFindings.map((f) => (
                <button
                  key={f.id}
                  className={`finding-row ${f.status === "dismissed" ? "dismissed" : ""}`}
                  onClick={() => setSelectedFinding({ ...f })}
                >
                  <span className={`severity-mark ${f.severity}`}>
                    <AlertTriangle size={16} />
                  </span>
                  <div>
                    <div className="finding-title">{f.title}</div>
                    <div className="finding-meta">
                      <span>{f.category}</span>
                      <span>·</span>
                      <span>
                        {f.devices.length} view
                        {f.devices.length !== 1 ? "s" : ""}
                      </span>
                      <span>·</span>
                      <span>
                        {f.source === "codex"
                          ? "AI judgment"
                          : f.source === "manual"
                            ? "Manual observation"
                            : `Automated · ${f.source}`}
                      </span>
                    </div>
                  </div>
                  <span className={`severity-badge ${f.severity}`}>
                    {f.severity}
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <CheckCircle2 size={35} />
                <h3>
                  {run.status === "running"
                    ? "Checks are in progress."
                    : "No findings in this selection."}
                </h3>
                <p>
                  {run.status === "running"
                    ? "Results appear here as the audit progresses."
                    : "Review the methods below. Automated checks cannot establish complete accessibility compliance."}
                </p>
              </div>
            )}
          </div>
          <details className="methods" open>
            <summary>
              Audit methods & limitations <ChevronDown size={15} />
            </summary>
            {run.checks.map((c, i) => (
              <div className="method-row" key={i}>
                <span className={`method-status ${c.status}`}>
                  {c.status === "completed" ? (
                    <Check size={13} />
                  ) : c.status === "failed" ? (
                    <X size={13} />
                  ) : (
                    <Info size={13} />
                  )}
                </span>
                <div>
                  <strong>
                    {c.name}
                    {c.deviceId &&
                      ` · ${run.devices.find((d) => d.id === c.deviceId)?.name || c.deviceId}`}
                  </strong>
                  <p>{c.detail}</p>
                </div>
                <span className="method-state">
                  {c.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </details>
        </>
      ) : (
        <div className="empty-state tall">
          <ScanLine size={42} />
          <h3>Good insights start with a closer look.</h3>
          <p>
            Select your devices, choose what to check, and run an audit. Every
            finding will be tied to real page evidence.
          </p>
          <button
            className="primary-button"
            onClick={() => {
              setRightPanel(true);
              setTab("views");
            }}
          >
            <SlidersHorizontal size={16} />
            Set up an audit
          </button>
        </div>
      )}
    </div>
  );
  const renderHistory = (reports = false) => (
    <>
      <div className="page-intro">
        <div>
          <h1>
            {reports
              ? "Your findings, beautifully documented."
              : "A record of every perspective."}
          </h1>
          <p>
            {reports
              ? "Locally saved reports, original evidence, and actionable next steps."
              : "Compare reviews and see what’s new, resolved, or recurring."}
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setPage("workspace");
            setTab("views");
          }}
        >
          <Plus size={16} />
          New audit
        </button>
      </div>
      <div className="content-panel">
        <div className="list-toolbar">
          <h2>
            {reports ? "Saved reports" : "Audit history"}
            <span>
              {runs.filter((r) => !reports || r.status === "completed").length}
            </span>
          </h2>
          <label className="search-input">
            <Search size={15} />
            <input
              placeholder="Search by URL or profile…"
              aria-label="Search audits"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {runs
          .filter(
            (r) =>
              (!reports || r.status === "completed") &&
              (!search ||
                `${r.url} ${r.profile.name}`
                  .toLowerCase()
                  .includes(search.toLowerCase())),
          )
          .map((r) => (
            <div className="history-row" key={r.id}>
              <div className="report-icon">
                <FileText size={23} />
              </div>
              <button className="history-main" onClick={() => openRun(r)}>
                <strong>{r.title || r.profile.name}</strong>
                <span>{r.url}</span>
                <small>
                  {new Date(r.createdAt).toLocaleString()} · {r.profile.name} ·{" "}
                  {r.devices.length} devices
                </small>
              </button>
              <span className={`run-status ${r.status}`}>{r.status}</span>
              <span className="history-count">
                {r.findings.length} findings
              </span>
              <IconButton label="View report" onClick={() => openRun(r)}>
                <ArrowUpRight size={18} />
              </IconButton>
            </div>
          ))}
        {!runs.length && (
          <div className="empty-state tall">
            <History size={40} />
            <h3>Your first perspective starts here.</h3>
            <p>
              Complete an audit to save a report and begin tracking improvements
              over time.
            </p>
            <button className="button" onClick={() => selectPage("workspace")}>
              Open workspace
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    </>
  );
  const renderTemplates = () => (
    <>
      <div className="page-intro">
        <div>
          <h1>A different lens for every review.</h1>
          <p>
            Make your audits yours. Start with a profile, then fine-tune the
            details.
          </p>
        </div>
        <div className="intro-actions">
          <label className="button file-label">
            <Upload size={15} />
            Import
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => importProfiles(e.target.files?.[0])}
            />
          </label>
          <button className="primary-button" onClick={newProfile}>
            <Plus size={16} />
            Create profile
          </button>
        </div>
      </div>
      <div className="profiles-grid">
        {profiles.map((p, i) => (
          <article className="profile-card" key={p.id}>
            <div className="profile-card-top">
              <span className={`profile-illustration illustration-${i % 6}`}>
                {(() => {
                  const Icon = [
                    Layers,
                    MousePointer2,
                    Accessibility,
                    Monitor,
                    Globe,
                    Gauge,
                  ][i % 6];
                  return <Icon size={25} />;
                })()}
              </span>
              <div className="profile-card-actions">
                <IconButton
                  label={`Duplicate ${p.name}`}
                  onClick={() => {
                    setProfiles((ps) => [
                      ...ps,
                      {
                        ...p,
                        id: crypto.randomUUID(),
                        name: `${p.name} (copy)`,
                      },
                    ]);
                    notify("Profile duplicated.");
                  }}
                >
                  <Copy size={15} />
                </IconButton>
                <IconButton
                  label={`Export ${p.name}`}
                  onClick={() => downloadJson(`${p.name}.json`, p)}
                >
                  <Download size={15} />
                </IconButton>
                <IconButton
                  label={`Delete ${p.name}`}
                  disabled={profiles.length === 1}
                  onClick={() => {
                    setProfiles((ps) => ps.filter((x) => x.id !== p.id));
                    if (profile.id === p.id)
                      setProfileId(
                        profiles.find((x) => x.id !== p.id)?.id ||
                          PROFILES[0].id,
                      );
                  }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </div>
            </div>
            <h2>{p.name}</h2>
            <p>{p.description}</p>
            <div className="profile-tags">
              {p.categories.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="profile-card-footer">
              <button
                className="text-button"
                onClick={() => {
                  setTemplateEditor({ ...p });
                  setModal("profile");
                }}
              >
                Edit profile
                <ArrowUpRight size={13} />
              </button>
              <button
                className="button small"
                onClick={() => {
                  setProfileId(p.id);
                  selectPage("workspace");
                }}
              >
                Use profile
                <ArrowRight size={13} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
  const renderSettings = () => (
    <>
      <div className="page-intro">
        <div>
          <h1>A workspace that feels like yours.</h1>
          <p>Your connections, evidence, and local preferences.</p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="content-panel settings-section">
          <h2>
            <Unplug size={19} />
            Local companion
          </h2>
          <p>
            The companion renders pages in Chromium, runs checks, and saves your
            evidence on this computer.
          </p>
          <div className="connection-check">
            <span className={`status-dot ${status ? "online" : ""}`} />
            <strong>{status ? "Connected" : "Disconnected"}</strong>
            <span>
              {status?.platform || "Start the companion with npm run dev"}
            </span>
            <button className="button small" onClick={() => refreshHealth()}>
              Check connection
              <RotateCw size={13} />
            </button>
          </div>
          <div className="connection-check">
            <Terminal size={17} />
            <strong>Codex CLI</strong>
            <span>
              {status?.codex.installed
                ? status.codex.authenticated
                  ? "Installed and authenticated"
                  : "Installed · run codex login"
                : "Not detected · install Codex CLI"}
            </span>
            {status?.codex.version && <code>{status.codex.version}</code>}
          </div>
          <p className="notice">
            <Info size={16} />
            Local orchestration does not mean offline AI. Enabling Codex sends
            masked screenshots and structured page evidence to your configured
            model provider.
          </p>
        </section>
        <section className="content-panel settings-section">
          <h2>
            <FolderOpen size={19} />
            Local output
          </h2>
          <p>
            Every audit gets its own folder. Original captures, editable
            findings, annotations, and reports stay together.
          </p>
          <label className="field-label" htmlFor="output-folder">
            Destination folder
          </label>
          <div className="folder-input">
            <FolderOpen size={16} />
            <input
              id="output-folder"
              value={profile.outputFolder || status?.outputFolder || ""}
              onChange={(e) => updateProfile({ outputFolder: e.target.value })}
            />
            <button
              className="button small"
              onClick={async () => {
                try {
                  const r = await api<{ path: string }>("/folder", "POST", {});
                  updateProfile({ outputFolder: r.path });
                  notify("Output folder selected.");
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              Choose folder
            </button>
          </div>
          <p className="field-description">
            Native folder picker on macOS. Other platforms accept an absolute
            folder path.
          </p>
        </section>
        <section className="content-panel settings-section">
          <h2>
            <Layers size={19} />
            Miro connection
          </h2>
          <p>
            Export screenshots alongside individually editable sticky notes,
            device frames, titles, shapes, and evidence references.
          </p>
          <div className="connection-check">
            <span className={`status-dot ${status?.miro ? "online" : ""}`} />
            <strong>
              {status?.miro ? "Miro is configured" : "Miro is not connected"}
            </strong>
          </div>
          <p>
            Set <code>MIRO_ACCESS_TOKEN</code> in the companion’s environment,
            then restart. Tokens stay in the companion and never enter your
            reports.
          </p>
          <p className="notice">
            <Info size={16} />
            Confluence’s documented Whiteboard API does not expose editable
            canvas objects. Use the local PDF and evidence package as a
            fallback.
          </p>
        </section>
      </div>
    </>
  );
  const renderGuide = () => (
    <>
      <div className="page-intro">
        <div>
          <h1>One workspace. A wider perspective.</h1>
          <p>
            Get connected, explore a page, and turn evidence into a useful
            review.
          </p>
        </div>
      </div>
      <div className="guide-layout">
        <section className="content-panel guide-main">
          <img
            className="guide-logo"
            src="/viewport-atlas-logo.svg"
            alt="Viewport Atlas"
          />
          <h2>Let’s take a closer look.</h2>
          <p>
            Viewport Atlas brings responsive browsing and evidence-based
            auditing into one local workspace.
          </p>
          <div className="guide-step">
            <span>1</span>
            <div>
              <h3>Connect your companion</h3>
              <p>
                Run <code>npm install</code>,{" "}
                <code>npm run install:browser</code>, then{" "}
                <code>npm run dev</code>. For Chrome, build and load{" "}
                <code>dist/extension</code> as an unpacked extension, then
                register its ID with{" "}
                <code>npm run install:native -- EXTENSION_ID</code>.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>2</span>
            <div>
              <h3>Bring your website into focus</h3>
              <p>
                Enter a URL and choose your devices. Standalone mode uses a
                shared, isolated Chromium session. The Chrome extension uses
                real browser tabs with your Chrome cookies, so authenticated and
                embedding-restricted pages can work.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>3</span>
            <div>
              <h3>Explore together, safely</h3>
              <p>
                Click and scroll inside any preview to make it the source. Each
                synchronization control is independent. Followers use semantic
                matching; ambiguous and hidden targets are marked out of sync.
                Purchases, deletions, submissions, and sensitive input are never
                mirrored. Shared server state can still change in every view.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>4</span>
            <div>
              <h3>Capture, audit, and review</h3>
              <p>
                Choose a profile and devices. axe-core evaluates accessibility;
                browser checks inspect metadata and navigation timings. Codex is
                optional. Performance timings are diagnostic observations, not
                Lighthouse scores. No automated review proves complete
                accessibility compliance.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>5</span>
            <div>
              <h3>Keep the evidence</h3>
              <p>
                Review findings, verify or dismiss them, and export your report.
                Original screenshots remain separate from annotations and crops.
                Full-page capture stops at a bounded height; truncation is
                disclosed. Miro export preserves editable text and geometry
                alongside raster screenshots.
              </p>
            </div>
          </div>
        </section>
        <aside className="content-panel guide-note">
          <ShieldCheck size={28} />
          <h3>Your evidence. Your control.</h3>
          <p>
            Use advanced settings to add CSS selectors for sensitive regions.
            Masking happens before files are saved or sent to AI or Miro.
          </p>
          <p>
            Cross-origin child frames, canvas content, infinitely scrolling
            pages, browser-internal pages, closed shadow roots, and custom
            interaction widgets may need manual review.
          </p>
          <p>
            These are emulated Chromium viewports. They do not represent real
            devices or other browser engines.
          </p>
          <button
            className="primary-button"
            onClick={() => selectPage("workspace")}
          >
            Open workspace
            <ArrowRight size={15} />
          </button>
        </aside>
      </div>
    </>
  );
  return (
    <div className="app">
      {renderSidebar()}
      <div className="app-content" id="workspace">
        {renderHeader()}
        <main className={`page-content page-${page}`}>
          {page === "workspace"
            ? renderWorkspace()
            : page === "reports"
              ? renderHistory(true)
              : page === "history"
                ? renderHistory()
                : page === "templates"
                  ? renderTemplates()
                  : page === "settings"
                    ? renderSettings()
                    : renderGuide()}
        </main>
        <footer className="app-footer">
          <span>Made for a better view of the web.</span>
          <span>
            <span className="status-dot online" />
            All files stay local<span className="bottom-dot">·</span>
            <button onClick={() => selectPage("guide")}>
              Help & documentation
              <ArrowUpRight size={11} />
            </button>
          </span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={17} />
          <span>{toast}</span>
          <IconButton label="Dismiss notification" onClick={() => setToast("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal modal-${modal}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
            }}
          >
            <div className="modal-header">
              <div>
                <h2 id="modal-title">
                  {modal === "devices"
                    ? "A new perspective."
                    : modal === "capture"
                      ? "Capture with confidence."
                      : modal === "export"
                        ? "Take your insights with you."
                        : modal === "manual"
                          ? "Add your perspective."
                          : "Make this profile yours."}
                </h2>
                <p>
                  {modal === "devices"
                    ? "Choose a preset or create a custom viewport."
                    : modal === "capture"
                      ? "Original evidence, safely saved on your computer."
                      : modal === "export"
                        ? "A clear report, and the evidence behind every finding."
                        : modal === "manual"
                          ? "Record something the automated checks may have missed."
                          : "Your settings are saved locally and can be reused."}
                </p>
              </div>
              <IconButton label="Close dialog" onClick={() => setModal(null)}>
                <X size={20} />
              </IconButton>
            </div>
            <div className="modal-body">
              {modal === "devices" && (
                <>
                  <div className="device-preset-list">
                    {DEVICES.map((d) => (
                      <button
                        key={d.id}
                        className={`preset-option ${devices.some((x) => x.id === d.id) ? "added" : ""}`}
                        onClick={() => {
                          if (!devices.some((x) => x.id === d.id)) {
                            setDevices((ds) => [...ds, d]);
                            updateProfile({
                              devices: [...profile.devices, d.id],
                            });
                            setModal(null);
                          }
                        }}
                        disabled={
                          devices.some((x) => x.id === d.id) ||
                          devices.length >= 8
                        }
                      >
                        {deviceIcon(d, 24)}
                        <span>
                          <strong>{d.name}</strong>
                          <small>
                            {d.width} × {d.height}
                          </small>
                        </span>
                        {devices.some((x) => x.id === d.id) ? (
                          <Check size={17} />
                        ) : (
                          <Plus size={17} />
                        )}
                      </button>
                    ))}
                  </div>
                  <h3>Custom viewport</h3>
                  <div className="custom-device-fields">
                    <label>
                      Name
                      <input
                        value={customDevice.name}
                        onChange={(e) =>
                          setCustomDevice((d) => ({
                            ...d,
                            name: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Width
                      <input
                        type="number"
                        min="280"
                        max="3840"
                        value={customDevice.width}
                        onChange={(e) =>
                          setCustomDevice((d) => ({
                            ...d,
                            width: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <span>×</span>
                    <label>
                      Height
                      <input
                        type="number"
                        min="320"
                        max="2160"
                        value={customDevice.height}
                        onChange={(e) =>
                          setCustomDevice((d) => ({
                            ...d,
                            height: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="primary-button"
                    disabled={
                      devices.length >= 8 ||
                      customDevice.width < 280 ||
                      customDevice.width > 3840 ||
                      customDevice.height < 320 ||
                      customDevice.height > 2160 ||
                      !customDevice.name.trim()
                    }
                    onClick={() => {
                      const d = {
                        ...customDevice,
                        id: crypto.randomUUID(),
                        mobile: customDevice.width < 600,
                      };
                      setDevices((ds) => [...ds, d]);
                      updateProfile({ devices: [...profile.devices, d.id] });
                      setModal(null);
                    }}
                  >
                    <Plus size={15} />
                    Add custom view
                  </button>
                  {deviceSets.length > 0 && (
                    <>
                      <h3>Saved device sets</h3>
                      {deviceSets.map((s, i) => (
                        <div className="saved-set" key={i}>
                          <button
                            className="button"
                            onClick={() => {
                              setDevices(s.devices);
                              updateProfile({
                                devices: s.devices.map((d) => d.id),
                              });
                              setModal(null);
                            }}
                          >
                            <Layers size={15} />
                            {s.name}
                            <span>{s.devices.length} views</span>
                          </button>
                          <IconButton
                            label={`Delete ${s.name}`}
                            onClick={() =>
                              setDeviceSets((ss) =>
                                ss.filter((_, x) => x !== i),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
              {modal === "capture" && (
                <>
                  {busy ? (
                    <div className="empty-state">
                      <Loader2 size={32} className="spin" />
                      <h3>Bringing every screen into focus…</h3>
                      <p>
                        Waiting for fonts and images, masking sensitive regions,
                        and capturing full-page evidence.
                      </p>
                    </div>
                  ) : captureResult ? (
                    <div className="capture-results">
                      {captureResult.map((s) => (
                        <a
                          key={s.deviceId}
                          className="capture-result"
                          href={assetUrl(s.path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <CheckCircle2 size={21} />
                          <span>
                            <strong>
                              {devices.find((d) => d.id === s.deviceId)?.name}
                            </strong>
                            <small>
                              {s.width} × {s.height} ·{" "}
                              {s.truncated
                                ? "Capture truncated at limit"
                                : "Original screenshot"}
                            </small>
                          </span>
                          <ExternalLink size={15} />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="notice">
                        <Sparkles size={20} />
                        <div>
                          <strong>Here’s what Codex will receive.</strong>
                          <p>
                            Masked screenshots for {selectedCount} selected
                            devices, page headings and link labels, metadata,
                            automated findings, and your review instructions.
                            Passwords, payment details, and configured selectors
                            are masked. Page evidence is treated as untrusted
                            content.
                          </p>
                        </div>
                      </div>
                      <p>
                        AI analysis uses your Codex authentication and
                        configured model provider. Processing may take place
                        online.
                      </p>
                      <label className="consent-check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        I understand which evidence is sent for analysis.
                      </label>
                      <button
                        className="primary-button"
                        disabled={!consent || !status?.codex.authenticated}
                        onClick={startAudit}
                      >
                        <ScanLine size={16} />
                        Capture & run audit
                      </button>
                      {!status?.codex.authenticated && (
                        <p className="field-description">
                          Install Codex and run <code>codex login</code> before
                          enabling AI analysis.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              {modal === "export" && run && (
                <>
                  <a
                    className="export-option"
                    href={assetUrl(`/api/runs/${run.id}/report.pdf`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="export-option-icon">
                      <FileText size={25} />
                    </span>
                    <div>
                      <strong>PDF report</strong>
                      <p>
                        Prioritized findings, evidence crops, methods, and
                        limitations.
                      </p>
                    </div>
                    <Download size={19} />
                  </a>
                  <button
                    className="export-option"
                    onClick={() =>
                      downloadJson(`viewport-atlas-${run.id}.json`, run)
                    }
                  >
                    <span className="export-option-icon">
                      <Layers size={25} />
                    </span>
                    <div>
                      <strong>Structured evidence package</strong>
                      <p>
                        Editable findings, annotation geometry, and original
                        asset references.
                      </p>
                    </div>
                    <Download size={19} />
                  </button>
                  <button
                    className="export-option"
                    onClick={async () => {
                      try {
                        await api(`/runs/${run.id}/open`, "POST", {});
                        notify("Output folder opened.");
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <span className="export-option-icon">
                      <FolderOpen size={25} />
                    </span>
                    <div>
                      <strong>Open local output folder</strong>
                      <p>
                        PDF, original screenshots, annotations, crops, and run
                        metadata.
                      </p>
                    </div>
                    <ArrowUpRight size={19} />
                  </button>
                  <a
                    className="button"
                    style={{ marginTop: 18 }}
                    href={assetUrl(`/api/runs/${run.id}/report.pdf?inline=1`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Eye size={15} />
                    Preview PDF
                  </a>
                  <div className="miro-export">
                    <div className="section-heading">
                      <h3>Export to Miro</h3>
                      <span
                        className={`connection-badge ${status?.miro ? "connected" : ""}`}
                      >
                        {status?.miro ? "Connected" : "Not connected"}
                      </span>
                    </div>
                    <p>
                      Screenshots stay raster. Finding text, device frames, and
                      annotation shapes become editable board objects.
                    </p>
                    {status?.miro ? (
                      <>
                        <select
                          aria-label="Destination Miro board"
                          value={exportBoard}
                          onChange={(e) => setExportBoard(e.target.value)}
                        >
                          <option value="">Choose a destination board</option>
                          {miroBoards.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <div className="miro-preview">
                          {run.devices.length} device frames ·{" "}
                          {run.screenshots.length} screenshot images ·{" "}
                          {
                            run.findings.filter((f) => f.status !== "dismissed")
                              .length
                          }{" "}
                          editable finding cards
                        </div>
                        <button
                          className="primary-button"
                          disabled={!exportBoard || exportBusy}
                          onClick={doMiroExport}
                        >
                          {exportBusy ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <Send size={15} />
                          )}
                          Export to selected board
                        </button>
                      </>
                    ) : (
                      <button
                        className="button"
                        onClick={() => {
                          setModal(null);
                          selectPage("settings");
                        }}
                      >
                        Set up Miro
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                </>
              )}
              {modal === "manual" && (
                <div className="form-stack">
                  <label>
                    Finding title
                    <input
                      value={manual.title}
                      onChange={(e) =>
                        setManual((m) => ({ ...m, title: e.target.value }))
                      }
                      placeholder="What did you notice?"
                      autoFocus
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Category
                      <select
                        value={manual.category}
                        onChange={(e) =>
                          setManual((m) => ({ ...m, category: e.target.value }))
                        }
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Severity
                      <select
                        value={manual.severity}
                        onChange={(e) =>
                          setManual((m) => ({ ...m, severity: e.target.value }))
                        }
                      >
                        {["critical", "high", "medium", "low", "info"].map(
                          (s) => (
                            <option key={s}>{s}</option>
                          ),
                        )}
                      </select>
                    </label>
                  </div>
                  <label>
                    User impact
                    <textarea
                      value={manual.impact}
                      onChange={(e) =>
                        setManual((m) => ({ ...m, impact: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Recommendation
                    <textarea
                      value={manual.recommendation}
                      onChange={(e) =>
                        setManual((m) => ({
                          ...m,
                          recommendation: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={!manual.title.trim()}
                    onClick={addManual}
                  >
                    <Plus size={16} />
                    Add observation
                  </button>
                </div>
              )}
              {modal === "profile" && templateEditor && (
                <div className="form-stack">
                  <label>
                    Profile name
                    <input
                      value={templateEditor.name}
                      onChange={(e) =>
                        setTemplateEditor(
                          (p) => p && { ...p, name: e.target.value },
                        )
                      }
                    />
                  </label>
                  <label>
                    Description
                    <input
                      value={templateEditor.description}
                      onChange={(e) =>
                        setTemplateEditor(
                          (p) => p && { ...p, description: e.target.value },
                        )
                      }
                    />
                  </label>
                  <label>
                    Review instructions
                    <textarea
                      rows={5}
                      value={templateEditor.prompt}
                      onChange={(e) =>
                        setTemplateEditor(
                          (p) => p && { ...p, prompt: e.target.value },
                        )
                      }
                    />
                  </label>
                  <label>
                    Mask sensitive regions{" "}
                    <span className="subtle">
                      CSS selectors, comma-separated
                    </span>
                    <textarea
                      rows={2}
                      value={templateEditor.masks}
                      onChange={(e) =>
                        setTemplateEditor(
                          (p) => p && { ...p, masks: e.target.value },
                        )
                      }
                    />
                  </label>
                  <label>
                    Output folder{" "}
                    <span className="subtle">
                      Empty uses the companion default
                    </span>
                    <input
                      value={templateEditor.outputFolder}
                      onChange={(e) =>
                        setTemplateEditor(
                          (p) => p && { ...p, outputFolder: e.target.value },
                        )
                      }
                    />
                  </label>
                  <div className="capture-row">
                    <span>Generate PDF report</span>
                    <Toggle
                      label="Generate PDF report"
                      checked={templateEditor.exportPdf}
                      onChange={() =>
                        setTemplateEditor(
                          (p) => p && { ...p, exportPdf: !p.exportPdf },
                        )
                      }
                    />
                  </div>
                  <div className="modal-actions">
                    <button
                      className="button"
                      onClick={() =>
                        downloadJson(
                          `${templateEditor.name}.json`,
                          templateEditor,
                        )
                      }
                    >
                      <Download size={15} />
                      Export profile
                    </button>
                    <button
                      className="primary-button"
                      disabled={!templateEditor.name.trim()}
                      onClick={() => {
                        setProfiles((ps) =>
                          ps.some((p) => p.id === templateEditor.id)
                            ? ps.map((p) =>
                                p.id === templateEditor.id ? templateEditor : p,
                              )
                            : [...ps, templateEditor],
                        );
                        setModal(null);
                        notify("Profile saved locally.");
                      }}
                    >
                      <Check size={15} />
                      Save profile
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
      {selectedFinding && (
        <div className="modal-overlay">
          <section
            className="modal finding-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finding-title"
          >
            <div className="modal-header">
              <h2 id="finding-title">Review finding</h2>
              <IconButton
                label="Close finding"
                onClick={() => setSelectedFinding(null)}
              >
                <X size={20} />
              </IconButton>
            </div>
            <div className="modal-body form-stack">
              <label>
                Title
                <input
                  value={selectedFinding.title}
                  onChange={(e) =>
                    setSelectedFinding(
                      (f) => f && { ...f, title: e.target.value },
                    )
                  }
                />
              </label>
              <div className="finding-meta">
                <span>{selectedFinding.category}</span>
                <span>
                  {selectedFinding.source === "codex"
                    ? "AI judgment"
                    : selectedFinding.source}
                </span>
                <span>
                  {Math.round(selectedFinding.confidence * 100)}% confidence
                </span>
              </div>
              <div className="form-row">
                <label>
                  Severity
                  <select
                    value={selectedFinding.severity}
                    onChange={(e) =>
                      setSelectedFinding(
                        (f) =>
                          f && {
                            ...f,
                            severity: e.target.value as Finding["severity"],
                          },
                      )
                    }
                  >
                    {["critical", "high", "medium", "low", "info"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Verification
                  <select
                    value={selectedFinding.status}
                    onChange={(e) =>
                      setSelectedFinding(
                        (f) =>
                          f && {
                            ...f,
                            status: e.target.value as Finding["status"],
                          },
                      )
                    }
                  >
                    {["unverified", "verified", "dismissed"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedFinding.evidence.map((ev, i) => (
                <div className="evidence-preview" key={i}>
                  <span>
                    {run?.devices.find((d) => d.id === ev.deviceId)?.name} ·{" "}
                    {ev.locator || "Page-level evidence"}
                  </span>
                  {(ev.crop || ev.screenshot) && (
                    <a
                      href={assetUrl(ev.annotation || ev.screenshot)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={assetUrl(ev.crop || ev.screenshot)}
                        alt={`Captured evidence for ${selectedFinding.title}`}
                      />
                    </a>
                  )}
                  {ev.bounds && (
                    <small>
                      Capture bounds: {Math.round(ev.bounds.x)},{" "}
                      {Math.round(ev.bounds.y)} · {Math.round(ev.bounds.width)}{" "}
                      × {Math.round(ev.bounds.height)} CSS px
                    </small>
                  )}
                </div>
              ))}
              <label>
                User impact
                <textarea
                  rows={3}
                  value={selectedFinding.impact}
                  onChange={(e) =>
                    setSelectedFinding(
                      (f) => f && { ...f, impact: e.target.value },
                    )
                  }
                />
              </label>
              <label>
                Recommendation
                <textarea
                  rows={3}
                  value={selectedFinding.recommendation}
                  onChange={(e) =>
                    setSelectedFinding(
                      (f) => f && { ...f, recommendation: e.target.value },
                    )
                  }
                />
              </label>
              {run && run.findings.length > 1 && (
                <label>
                  Merge with another finding
                  <select
                    defaultValue=""
                    onChange={async (e) => {
                      if (!e.target.value) return;
                      try {
                        const r = await api<Run>(
                          `/runs/${run.id}/merge`,
                          "POST",
                          {
                            sourceId: selectedFinding.id,
                            targetId: e.target.value,
                          },
                        );
                        setRun(r);
                        setSelectedFinding(null);
                        notify(
                          "Findings merged with device evidence preserved.",
                        );
                      } catch (err) {
                        notify((err as Error).message);
                      }
                    }}
                  >
                    <option value="">Choose a related finding…</option>
                    {run.findings
                      .filter((f) => f.id !== selectedFinding.id)
                      .map((f) => (
                        <option value={f.id} key={f.id}>
                          {f.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="modal-actions">
                <button
                  className="button danger"
                  onClick={() =>
                    saveFinding({ ...selectedFinding, status: "dismissed" })
                  }
                >
                  <EyeOff size={15} />
                  Dismiss finding
                </button>
                <button
                  className="primary-button"
                  onClick={() => saveFinding(selectedFinding)}
                >
                  <Check size={15} />
                  Save changes
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function DevicePreview({
  device: d,
  view,
  active,
  imageVersion,
  busy,
  basis,
  index,
  onSelect,
  onAction,
  onMenu,
  menu,
  onRotate,
  onHide,
  onRemove,
  onMove,
  onDrag,
  onDrop,
}: {
  device: Device;
  view?: View;
  active: boolean;
  imageVersion: number;
  busy: boolean;
  basis: number;
  index: number;
  onSelect: () => void;
  onAction: (a: Record<string, unknown>) => void;
  onMenu: () => void;
  menu: boolean;
  onRotate: () => void;
  onHide: () => void;
  onRemove: () => void;
  onMove: () => void;
  onDrag: () => void;
  onDrop: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const lastWheel = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(250);
  useEffect(() => {
    setImageError(false);
    setImgLoading(true);
  }, [imageVersion]);
  useEffect(() => {
    if (!panel.current) return;
    const ro = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    ro.observe(panel.current);
    return () => ro.disconnect();
  }, []);
  const previewHeight = Math.min(650, d.height * (width / d.width));
  const click = (e: React.MouseEvent<HTMLImageElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onAction({
      type: "click",
      x: ((e.clientX - r.left) / r.width) * d.width,
      y: ((e.clientY - r.top) / r.height) * d.height,
    });
  };
  const image = view?.image || `/api/views/${d.id}/image?v=${imageVersion}`;
  return (
    <article
      className={`device-column device-${d.mobile ? "mobile" : d.width < 1000 ? "tablet" : "desktop"} ${active ? "active" : ""}`}
      style={
        {
          "--device-index": index,
          flex: `0 0 ${basis}px`,
          minWidth: basis,
          maxWidth: "none",
        } as React.CSSProperties
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="device-heading">
        <button className="device-name" onClick={onSelect}>
          {deviceIcon(d, 17)}
          <span>
            {d.name}
            <small>
              {d.width} × {d.height}
            </small>
          </span>
        </button>
        <div className="device-heading-actions">
          <IconButton label={`Rotate ${d.name}`} onClick={onRotate}>
            <RotateCw size={13} />
          </IconButton>
          <IconButton label={`${d.name} options`} onClick={onMenu}>
            <MoreHorizontal size={16} />
          </IconButton>
        </div>
        {menu && (
          <div className="dropdown device-dropdown">
            <button
              onClick={() => {
                onMove();
                onMenu();
              }}
            >
              <ArrowLeft size={14} />
              Move left
            </button>
            <button
              onClick={() => {
                onHide();
                onMenu();
              }}
            >
              <EyeOff size={14} />
              Hide view
            </button>
            <button
              onClick={() => {
                onRemove();
                onMenu();
              }}
            >
              <Trash2 size={14} />
              Remove view
            </button>
          </div>
        )}
      </div>
      <div
        className={`device-frame ${d.mobile ? "phone-frame" : ""}`}
        ref={panel}
        style={{ height: previewHeight }}
        onWheel={(e) => {
          if (Date.now() - lastWheel.current > 120) {
            lastWheel.current = Date.now();
            onAction({ type: "scroll", deltaY: e.deltaY });
          }
        }}
      >
        {busy || !view ? (
          <div className="preview-loading">
            <Loader2 className="spin" size={23} />
            <span>Loading website…</span>
          </div>
        ) : view.error || imageError ? (
          <div className="preview-error">
            <AlertTriangle size={24} />
            <strong>Preview unavailable</strong>
            <p>{view.error || "The browser capture disconnected."}</p>
            <button
              className="button small"
              onClick={() => onAction({ type: "reload" })}
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <img
              draggable={false}
              src={assetUrl(image)}
              alt={`${d.name} interactive Chromium capture at ${d.width} by ${d.height}`}
              className="page-capture"
              onClick={click}
              onLoad={() => setImgLoading(false)}
              onError={() => {
                setImageError(true);
                setImgLoading(false);
              }}
              tabIndex={0}
              role="button"
              aria-label={`Interact with ${d.name} preview. Click to interact, use arrow keys to scroll, or Enter to edit a focused text field.`}
              onKeyDown={(e) => {
                if (
                  ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(e.key)
                ) {
                  e.preventDefault();
                  onAction({
                    type: "scroll",
                    deltaY:
                      e.key === "ArrowUp" || e.key === "PageUp" ? -400 : 400,
                  });
                }
                if (e.key === "Enter") {
                  const value = window.prompt(
                    "Enter text for the focused field. Password, payment, and file inputs are blocked.",
                  );
                  if (value !== null) onAction({ type: "input", value });
                }
              }}
              style={{ width: "100%", height: "auto", minHeight: "100%" }}
            />
            {imgLoading && <span className="image-loading-dot" />}
          </>
        )}
        {d.mobile && (
          <div className="phone-home">
            <span />
          </div>
        )}
        {view?.outOfSync && (
          <div className="out-of-sync">
            <AlertTriangle size={14} />
            <span>{view.outOfSync}</span>
            <button onClick={() => onAction({ type: "resync", url: view.url })}>
              Resync
            </button>
          </div>
        )}
      </div>
      <div className="device-foot">
        <button
          draggable
          onDragStart={onDrag}
          aria-label={`Drag to reorder ${d.name}`}
          title="Drag to reorder"
        >
          <GripVertical size={12} />
        </button>
        <span className={`status-dot ${view && !view.error ? "online" : ""}`} />
        <span>
          {busy
            ? "Loading"
            : view?.outOfSync
              ? "Out of sync"
              : active
                ? "Interaction source"
                : "Synced"}
        </span>
        <span className="device-scale">
          {Math.round((width / d.width) * 100)}%
        </span>
      </div>
    </article>
  );
}
export default App;
