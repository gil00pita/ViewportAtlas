import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { atomicJson } from "./audit.mjs";
const base = "https://api.miro.com/v2";
export const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function request(
  path,
  { method = "GET", body, token = process.env.MIRO_ACCESS_TOKEN } = {},
) {
  if (!token)
    throw new Error(
      "Set MIRO_ACCESS_TOKEN in the local companion environment.",
    );
  const form = body instanceof FormData;
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(!form && body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (form ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const error = new Error(
      `Miro returned ${response.status}. Check board access and token scopes; no success was recorded.`,
    );
    error.httpStatus = response.status;
    throw error;
  }
  return response.json();
}
export async function listBoards() {
  const boards = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const data = await request(
      `/boards?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    boards.push(...data.data.map((b) => ({ id: b.id, name: b.name })));
    cursor = data.cursor;
    if (!cursor) break;
  }
  return boards;
}
export async function exportToMiro(
  root,
  run,
  boardId,
  { transport = request } = {},
) {
  if (!/^[a-zA-Z0-9_=-]{4,120}$/.test(boardId))
    throw new Error("Invalid Miro board ID.");
  let ledger = { schemaVersion: 1, boards: {} };
  const path = join(root, "miro-export.json");
  try {
    ledger = JSON.parse(await readFile(path, "utf8"));
  } catch {}
  const board = ledger.boards[boardId] || { items: {} };
  ledger.boards[boardId] = board;
  let created = 0;
  const create = async (key, endpoint, body) => {
    const op = board.items[key];
    if (op?.status === "completed") return op.id;
    if (op?.status === "pending")
      throw new Error(
        `Miro operation ${key} has an uncertain result from an interrupted export. Inspect the board and reconcile miro-export.json before retrying; automatic retries are stopped to avoid duplicates.`,
      );
    board.items[key] = {
      status: "pending",
      startedAt: new Date().toISOString(),
    };
    await atomicJson(path, ledger);
    try {
      const item = await transport(
        `/boards/${encodeURIComponent(boardId)}/${endpoint}`,
        { method: "POST", body },
      );
      board.items[key] = { status: "completed", id: item.id };
      await atomicJson(path, ledger);
      created++;
      return item.id;
    } catch (e) {
      if (e.httpStatus) {
        board.items[key] = { status: "failed", httpStatus: e.httpStatus };
        await atomicJson(path, ledger);
      }
      throw e;
    }
  };
  for (let index = 0; index < run.devices.length; index++) {
    const d = run.devices[index];
    const shot = run.screenshots.find((s) => s.deviceId === d.id);
    const findings = run.findings.filter(
      (f) => f.status !== "dismissed" && f.devices.includes(d.id),
    );
    const width = Math.max(1100, d.width + 440);
    const height = Math.max(
      1100,
      (shot?.height || d.height) + 160,
      findings.length * 250 + 180,
    );
    const frame = await create(`frame:${d.id}`, "frames", {
      data: {
        title: `${d.name} · ${d.width} × ${d.height} · ${run.id.slice(0, 10)}`,
        type: "freeform",
      },
      position: { x: index * (width + 140), y: 0 },
      geometry: { width, height },
      style: { fillColor: "#F5F8F4" },
    });
    if (shot) {
      let image = await sharp(join(root, "screenshots", `${d.id}.png`))
        .jpeg({ quality: 85 })
        .toBuffer();
      if (image.length > 6_000_000)
        image = await sharp(image).jpeg({ quality: 55 }).toBuffer();
      if (image.length > 6_000_000)
        throw new Error(
          "Screenshot exceeds Miro’s 6 MB upload limit. Export the local evidence instead.",
        );
      const form = new FormData();
      form.append(
        "resource",
        new Blob([image], { type: "image/jpeg" }),
        `${d.id}.jpg`,
      );
      form.append(
        "data",
        new Blob(
          [
            JSON.stringify({
              title: `${d.name} original masked evidence`,
              position: {
                x: 40 + d.width / 2,
                y: 90 + shot.height / 2,
                origin: "center",
                relativeTo: "parent_top_left",
              },
              geometry: { width: d.width },
              parent: { id: frame },
            }),
          ],
          { type: "application/json" },
        ),
      );
      await create(`image:${d.id}`, "images", form);
    }
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const ev = f.evidence.find((e) => e.deviceId === d.id);
      const sticky = await create(`finding:${d.id}:${f.id}`, "sticky_notes", {
        data: {
          content: `<p><strong>${escapeHtml(f.title)}</strong></p><p>${escapeHtml(f.severity.toUpperCase())} · ${escapeHtml(f.source)} · ${escapeHtml(f.status)}</p><p>${escapeHtml(f.impact)}</p><p>${escapeHtml(f.recommendation)}</p><p>Evidence: ${escapeHtml(ev?.locator || "Page-level observation")} · ${escapeHtml(f.id)}</p>`,
          shape: "square",
        },
        style: {
          fillColor: ["critical", "high"].includes(f.severity)
            ? "light_pink"
            : "light_yellow",
          textAlign: "left",
        },
        geometry: { width: 320 },
        position: {
          x: d.width + 240,
          y: 200 + i * 250,
          origin: "center",
          relativeTo: "parent_top_left",
        },
        parent: { id: frame },
      });
      if (ev?.bounds) {
        const b = ev.bounds;
        const shape = await create(`annotation:${d.id}:${f.id}`, "shapes", {
          data: { shape: "rectangle", content: "" },
          style: {
            fillOpacity: "0",
            borderColor: "#FF704B",
            borderWidth: "3.0",
          },
          geometry: {
            width: Math.max(8, b.width),
            height: Math.max(8, b.height),
          },
          position: {
            x: 40 + b.x + b.width / 2,
            y: 90 + b.y + b.height / 2,
            origin: "center",
            relativeTo: "parent_top_left",
          },
          parent: { id: frame },
        });
        await create(`connector:${d.id}:${f.id}`, "connectors", {
          startItem: { id: sticky },
          endItem: { id: shape },
          style: { endStrokeCap: "arrow", strokeColor: "#008B7E" },
          shape: "elbowed",
        });
      }
    }
  }
  return {
    url: `https://miro.com/app/board/${encodeURIComponent(boardId)}/`,
    created,
    ledger,
  };
}
