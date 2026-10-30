export type Device = {
  id: string;
  name: string;
  width: number;
  height: number;
  mobile: boolean;
  hidden?: boolean;
};
export type Category =
  "Accessibility" | "Performance" | "UX / UI" | "SEO" | "Best practices";
export type Profile = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  categories: Category[];
  devices: string[];
  ai: boolean;
  fullPage: boolean;
  masks: string;
  outputFolder: string;
  exportPdf: boolean;
};
export type Finding = {
  id: string;
  category: Category;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  url: string;
  devices: string[];
  evidence: {
    deviceId: string;
    screenshot: string;
    locator: string;
    bounds: { x: number; y: number; width: number; height: number } | null;
    crop?: string;
    annotation?: string;
  }[];
  impact: string;
  recommendation: string;
  source: "axe-core" | "browser" | "codex" | "manual";
  confidence: number;
  status: "unverified" | "verified" | "dismissed";
  rule?: string;
};
export type View = {
  id: string;
  url: string;
  title?: string;
  image?: string;
  error?: string;
  outOfSync?: string;
  device: Device;
};
export type Run = {
  schemaVersion: 1;
  id: string;
  url: string;
  title: string;
  createdAt: string;
  status: "running" | "completed" | "cancelled" | "failed";
  progress: string;
  devices: Device[];
  profile: Profile;
  findings: Finding[];
  checks: { name: string; status: string; detail: string; deviceId?: string }[];
  screenshots: {
    deviceId: string;
    path: string;
    width: number;
    height: number;
    pixelWidth?: number;
    pixelHeight?: number;
    deviceScaleFactor?: number;
    truncated: boolean;
  }[];
  outputFolder?: string;
  error?: string;
  summary?: string;
  comparison?: { new: string[]; resolved: string[]; recurring: string[] };
};
export type Health = {
  connected: boolean;
  codex: { installed: boolean; authenticated: boolean; version?: string };
  browser: boolean;
  platform: string;
  outputFolder: string;
  miro: boolean;
  extension: boolean;
};
export const DEVICES: Device[] = [
  { id: "iphone-15", name: "iPhone 15", width: 393, height: 852, mobile: true },
  { id: "ipad-air", name: "iPad Air", width: 820, height: 1180, mobile: false },
  { id: "desktop", name: "Desktop", width: 1440, height: 900, mobile: false },
  { id: "iphone-se", name: "iPhone SE", width: 375, height: 667, mobile: true },
  { id: "pixel-8", name: "Pixel 8", width: 412, height: 915, mobile: true },
  { id: "laptop", name: "Laptop", width: 1280, height: 800, mobile: false },
];
export const CATEGORIES: Category[] = [
  "Accessibility",
  "Performance",
  "UX / UI",
  "SEO",
  "Best practices",
];
const base = {
  categories: CATEGORIES,
  devices: ["iphone-15", "ipad-air", "desktop"],
  ai: false,
  fullPage: true,
  masks: 'input[type="password"], input[autocomplete*="cc-"], [data-sensitive]',
  outputFolder: "",
  exportPdf: true,
};
export const PROFILES: Profile[] = [
  {
    id: "general",
    name: "General website review",
    description: "A well-rounded look at every screen.",
    prompt:
      "Review the current page for usability, responsive layout, accessibility, SEO, and best practices. Tie each finding to supplied evidence. Separate judgments from technical checks.",
    ...base,
  },
  {
    id: "ux",
    name: "UX heuristics",
    description: "Clarity, consistency, and user control.",
    prompt:
      "Evaluate usability heuristics: system status, familiar language, consistency, error prevention, user control, and clear next steps. Describe observable impact.",
    ...base,
    categories: ["UX / UI", "Accessibility"],
  },
  {
    id: "accessibility",
    name: "Accessibility review",
    description: "Find barriers. Make room for everyone.",
    prompt:
      "Review accessibility barriers visible in supplied evidence. Do not claim compliance. Identify checks requiring manual assistive-technology testing.",
    ...base,
    categories: ["Accessibility"],
  },
  {
    id: "responsive",
    name: "Responsive layout",
    description: "One experience, across every viewport.",
    prompt:
      "Compare layouts across devices. Inspect overflow, hierarchy, navigation transformations, content ordering, touch targets, and readable type.",
    ...base,
    categories: ["Accessibility", "UX / UI"],
  },
  {
    id: "commerce",
    name: "E-commerce journey",
    description: "A clearer path from browse to buy.",
    prompt:
      "Evaluate product discovery, pricing clarity, trust signals, and purchase-path clarity visible on this page. Do not submit forms or make purchases.",
    ...base,
    categories: ["UX / UI", "Accessibility", "Best practices"],
  },
  {
    id: "landing",
    name: "Landing-page conversion",
    description: "Help the right visitors take the next step.",
    prompt:
      "Evaluate the value proposition, information hierarchy, call-to-action clarity, trust, and mobile readability. Treat conversion recommendations as AI judgments.",
    ...base,
    categories: ["UX / UI", "Performance", "SEO"],
  },
];
