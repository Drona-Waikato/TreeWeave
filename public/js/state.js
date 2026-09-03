// State: data model, seed data, server-backed persistence, and tree helpers.

const LEGACY_STORAGE_KEY = "treeweave.v1";

export const PALETTE = [
  "#ffe066", // yellow
  "#ff9f7a", // peach
  "#ff8fb1", // pink
  "#b693ff", // lavender
  "#8fd3ff", // sky
  "#9be7c4", // mint
  "#c9d36b", // lime
  "#ffd6a5", // sand
];

// Curated, harmonious palette used to tint each bundle of lines.
export const AREA_COLORS = [
  "#4f8dfb", // blue
  "#34c4a0", // teal
  "#f5b544", // amber
  "#ec6a93", // rose
  "#9a6de0", // violet
  "#3fc0d6", // cyan
  "#f0884b", // orange
  "#7bc24a", // green
  "#6c7be0", // indigo
  "#e0605e", // coral
];

let uid = 0;
export function newId(prefix = "n") {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

// ---- Seed data ---------------------------------------------------------

function leaf(name, notes = []) {
  return { id: newId("p"), name, children: [], notes };
}
function group(name, children) {
  return { id: newId("g"), name, children, notes: [] };
}

function seed() {
  const today = new Date();
  const inDays = (d) => {
    const t = new Date(today);
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };

  return {
    root: {
      id: "root",
      name: "Me",
      children: [
        group("Work", [
          group("Platform Team", [
            leaf("Billing rewrite", [
              {
                id: newId("note"),
                text: "Draft new pricing schema",
                color: PALETTE[3],
                x: 90,
                y: 80,
                due: inDays(2),
                urgency: 3,
                bucket: "doing",
                assignee: "Alex",
                priority: 5,
              },
              {
                id: newId("note"),
                text: "Migrate legacy invoices",
                color: PALETTE[0],
                x: 360,
                y: 140,
                due: inDays(0),
                urgency: 1,
                bucket: "todo",
                assignee: "Sam",
                priority: 5,
              },
              {
                id: newId("note"),
                text: "Spec out webhooks",
                color: PALETTE[4],
                x: 150,
                y: 300,
                due: "",
                urgency: 1,
                bucket: "done",
                assignee: "Alex",
                priority: 5,
              },
            ]),
            leaf("API v2"),
            leaf("Observability"),
          ]),
          group("Hiring", [leaf("Backend role"), leaf("Design role")]),
        ]),
        group("Personal", [
          group("Health", [leaf("Marathon training"), leaf("Meal prep")]),
          leaf("Read 24 books"),
          group("Home", [
            leaf("Kitchen remodel", [
              {
                id: newId("note"),
                text: "Choose worktop",
                color: PALETTE[2],
                x: 110,
                y: 120,
                due: inDays(5),
                urgency: 2,
                bucket: null,
                assignee: "Jordan",
                priority: 5,
              },
            ]),
            leaf("Garden"),
          ]),
        ]),
        group("Side Projects", [
          leaf("TreeWeave"),
          leaf("Synth pedal"),
          group("Writing", [leaf("Sci-fi novel"), leaf("Blog")]),
        ]),
      ],
      notes: [],
    },
    ui: {
      selectedNodeId: null,
      openProjectId: null,
      expanded: [],
      paneView: "board",
      mainView: "tree",
    },
    trash: [],
  };
}

// ---- Persistence (server-side via /api) ---------------------------------

export let state = seed(); // replaced once initState() resolves
let saveTimer = null;
let ready = false;

function normalizeState(data) {
  if (!data || !data.root) return seed();
  if (!data.ui) data.ui = {};
  data.ui.selectedNodeId = data.ui.selectedNodeId ?? null;
  data.ui.openProjectId = data.ui.openProjectId ?? null;
  data.ui.expanded = Array.isArray(data.ui.expanded) ? data.ui.expanded : [];
  data.ui.paneView = data.ui.paneView === "list" ? "list" : "board";
  if (!data.ui.mainView) {
    data.ui.mainView = data.ui.globalView ? "global" : "tree";
  }
  if (!["tree", "global", "dueToday", "recycle", "eisenhower"].includes(data.ui.mainView)) {
    data.ui.mainView = "tree";
  }
  if (!Array.isArray(data.trash)) data.trash = [];
  walkNotes(data.root, (note) => {
    note.priority = clampPriority(note.priority);
  });
  for (const item of data.trash) {
    if (item && item.note) item.note.priority = clampPriority(item.note.priority);
  }
  // Expired trash is archived separately after load (see flushExpiredTrashToArchive)
  return data;
}

function walkNotes(node, fn) {
  if (!node) return;
  for (const note of node.notes || []) fn(note);
  for (const child of node.children || []) walkNotes(child, fn);
}

/** Clamp priority to 1–5; default P5. */
export function clampPriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function notePriority(note) {
  return clampPriority(note?.priority);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const err = await res.json();
      if (err && err.error) msg = err.error;
    } catch (_) {}
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json();
}

/** Load state from the local server. Migrates browser localStorage once if present. */
export async function initState() {
  try {
    const data = await fetchJson("/api/data");
    state = normalizeState(data);

    // One-time migration from the old browser-only storage
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (parsed && parsed.root && parsed.root.id === "root") {
          // Prefer server data if it already has user edits beyond a fresh seed;
          // otherwise adopt the richer legacy copy when server looks untouched.
          const serverEmpty =
            !state.root.children || state.root.children.length === 0;
          if (serverEmpty) {
            state = normalizeState(parsed);
            await persistNow();
          }
        }
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (_) {}
    await flushExpiredTrashToArchive();
  } catch (e) {
    console.warn("Failed to load from server, using seed:", e);
    state = seed();
    try {
      await persistNow();
    } catch (_) {}
  }
  ready = true;
  return state;
}

async function persistNow() {
  await fetchJson("/api/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
}

/** Debounced save to the server. */
export function save() {
  if (!ready) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistNow().catch((e) => console.warn("Failed to save state", e));
  }, 200);
}

export async function resetDemo() {
  const res = await fetchJson("/api/reset", { method: "POST" });
  state = normalizeState(res.data);
  return state;
}

export async function exportData() {
  // Prefer the live in-memory state (flush first) so export matches the UI.
  clearTimeout(saveTimer);
  await persistNow();
  const stamp = new Date().toISOString().slice(0, 10);
  const payload = {
    format: "treeweave",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `treeweave-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importData(fileOrText) {
  let text;
  if (typeof fileOrText === "string") {
    text = fileOrText;
  } else {
    text = await fileOrText.text();
  }
  const res = await fetchJson("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });
  state = normalizeState(res.data);
  return state;
}

// ---- Tree helpers ------------------------------------------------------

export function isProject(node) {
  return !node.children || node.children.length === 0;
}

// Number of leaf projects within a subtree (== bundle thickness).
export function leafCount(node) {
  if (isProject(node)) return 1;
  return node.children.reduce((s, c) => s + leafCount(c), 0);
}

/** Active (non-done) notes on a project — used for tree badges/counts. */
export function activeNoteCount(node) {
  return (node.notes || []).filter((n) => n.bucket !== "done").length;
}

// Ordered list of leaf projects under a node (DFS order).
export function leavesOf(node) {
  if (isProject(node)) return [node];
  return node.children.flatMap(leavesOf);
}

export function findNode(id, node = state.root, parent = null) {
  if (node.id === id) return { node, parent };
  for (const c of node.children || []) {
    const r = findNode(id, c, node);
    if (r) return r;
  }
  return null;
}

export function findProject(id) {
  const r = findNode(id);
  return r ? r.node : null;
}

// Top-level area index a node belongs to (for colour assignment).
export function areaIndexOf(id) {
  const areas = state.root.children;
  for (let i = 0; i < areas.length; i++) {
    if (findNode(id, areas[i])) return i;
  }
  return 0;
}

export function colorForArea(i) {
  return AREA_COLORS[i % AREA_COLORS.length];
}

// ---- Mutations ---------------------------------------------------------

export function addChild(parentId, name, asProject = true) {
  const r = findNode(parentId);
  if (!r) return null;
  const node = asProject
    ? { id: newId("p"), name, children: [], notes: [] }
    : { id: newId("g"), name, children: [], notes: [] };
  r.node.children = r.node.children || [];
  r.node.children.push(node);
  save();
  return node;
}

export function addArea(name) {
  return addChild("root", name, false);
}

export function renameNode(id, name) {
  const r = findNode(id);
  if (r) {
    r.node.name = name;
    save();
  }
}

export function removeNode(id) {
  const r = findNode(id);
  if (!r || !r.parent) return; // cannot remove root
  r.parent.children = r.parent.children.filter((c) => c.id !== id);
  if (state.ui.selectedNodeId === id) state.ui.selectedNodeId = null;
  if (state.ui.openProjectId === id) state.ui.openProjectId = null;
  save();
}

/**
 * Move a node under newParentId at the given child index.
 * Returns false if the move is invalid (root, missing, or into own subtree).
 */
export function moveNode(nodeId, newParentId, index) {
  if (!nodeId || nodeId === "root" || nodeId === newParentId) return false;
  const src = findNode(nodeId);
  const dst = findNode(newParentId);
  if (!src || !src.parent || !dst) return false;

  const blocked = new Set();
  (function collect(n) {
    blocked.add(n.id);
    (n.children || []).forEach(collect);
  })(src.node);
  if (blocked.has(newParentId)) return false;

  const fromParent = src.parent;
  const toParent = dst.node;
  toParent.children = toParent.children || [];

  const oldIndex = fromParent.children.findIndex((c) => c.id === nodeId);
  if (oldIndex < 0) return false;

  let insertAt = Number(index);
  if (!Number.isFinite(insertAt)) insertAt = toParent.children.length;
  insertAt = Math.max(0, Math.min(insertAt, toParent.children.length));
  if (fromParent === toParent && oldIndex < insertAt) insertAt -= 1;

  const [node] = fromParent.children.splice(oldIndex, 1);
  toParent.children.splice(insertAt, 0, node);
  save();
  return true;
}

// ---- Notes -------------------------------------------------------------

export function addNote(projectId, partial = {}) {
  const p = findProject(projectId);
  if (!p) return null;
  p.notes = p.notes || [];
  const note = {
    id: newId("note"),
    text: "",
    color: PALETTE[0],
    x: 60,
    y: 60,
    due: "",
    urgency: 1,
    bucket: null,
    assignee: "",
    priority: 5,
    ...partial,
  };
  note.priority = clampPriority(note.priority);
  p.notes.push(note);
  save();
  return note;
}

export function updateNote(projectId, noteId, patch) {
  const p = findProject(projectId);
  if (!p) return;
  const n = (p.notes || []).find((x) => x.id === noteId);
  if (n) {
    if (Object.prototype.hasOwnProperty.call(patch, "priority")) {
      patch = { ...patch, priority: clampPriority(patch.priority) };
    }
    Object.assign(n, patch);
    save();
  }
}

const TRASH_MS = 7 * 24 * 60 * 60 * 1000;

/** Remove expired recycle-bin items and return them (for archiving). */
function takeExpiredTrash(data = state) {
  if (!data || !Array.isArray(data.trash)) return [];
  const cutoff = Date.now() - TRASH_MS;
  const expired = [];
  const kept = [];
  for (const item of data.trash) {
    const t = Date.parse(item.deletedAt);
    if (Number.isFinite(t) && t >= cutoff) kept.push(item);
    else expired.push(item);
  }
  data.trash = kept;
  return expired;
}

function purgeExpiredTrash(data = state) {
  return takeExpiredTrash(data).length > 0;
}

async function appendToArchive(items, reason) {
  const entries = (items || [])
    .filter(Boolean)
    .map((item) => ({
      ...item,
      reason: reason || item.reason || "permanent-delete",
    }));
  if (!entries.length) return { ok: true, added: 0 };
  return fetchJson("/api/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

async function flushExpiredTrashToArchive() {
  const expired = takeExpiredTrash(state);
  if (!expired.length) return;
  try {
    await appendToArchive(expired, "expired");
    await persistNow();
    notifyTrashChanged();
  } catch (e) {
    // Put them back so we can retry next launch rather than lose history
    state.trash = [...expired, ...(state.trash || [])];
    console.warn("Failed to archive expired trash:", e);
  }
}

function notifyTrashChanged() {
  try {
    window.dispatchEvent(new CustomEvent("treeweave:trash"));
  } catch (_) {}
}

/** Soft-delete: move note into the recycle bin for 7 days. */
export function softDeleteNote(projectId, noteId) {
  const p = findProject(projectId);
  if (!p) return;
  const idx = (p.notes || []).findIndex((x) => x.id === noteId);
  if (idx < 0) return;
  const [note] = p.notes.splice(idx, 1);
  state.trash = Array.isArray(state.trash) ? state.trash : [];
  state.trash.unshift({
    id: newId("trash"),
    deletedAt: new Date().toISOString(),
    projectId: p.id,
    projectName: p.name,
    note,
  });
  purgeExpiredTrash();
  save();
  notifyTrashChanged();
}

/** @deprecated use softDeleteNote — hard remove without trash */
export function removeNote(projectId, noteId) {
  softDeleteNote(projectId, noteId);
}

export function listTrash() {
  // Do not silently drop expired items here — archiving happens in
  // flushExpiredTrashToArchive / permanent delete paths.
  return [...(state.trash || [])];
}

export function trashCount() {
  return (state.trash || []).length;
}

export function daysLeftInTrash(item) {
  const t = Date.parse(item.deletedAt);
  if (!Number.isFinite(t)) return 0;
  const left = TRASH_MS - (Date.now() - t);
  return Math.max(0, Math.ceil(left / (24 * 60 * 60 * 1000)));
}

/** Restore a trashed note to its original project node when possible. */
export function restoreFromTrash(trashId) {
  const items = state.trash || [];
  const idx = items.findIndex((x) => x.id === trashId);
  if (idx < 0) return { ok: false, reason: "missing" };
  const [item] = items.splice(idx, 1);
  let project = findProject(item.projectId);
  if (!project) {
    // Original node gone — leave in trash and report
    items.splice(idx, 0, item);
    save();
    return { ok: false, reason: "node-missing", projectName: item.projectName };
  }
  project.notes = project.notes || [];
  const note = { ...item.note };
  if (project.notes.some((n) => n.id === note.id)) {
    note.id = newId("note");
  }
  project.notes.push(note);
  save();
  notifyTrashChanged();
  return { ok: true, projectId: project.id, noteId: note.id };
}

/** Permanently delete one recycle-bin item after saving it to the archive. */
export async function permanentlyDeleteTrash(trashId) {
  const item = (state.trash || []).find((x) => x.id === trashId);
  if (!item) return;
  await appendToArchive([item], "permanent-delete");
  state.trash = (state.trash || []).filter((x) => x.id !== trashId);
  save();
  notifyTrashChanged();
}

/** Empty the recycle bin after saving every item to the archive. */
export async function emptyTrash() {
  const items = [...(state.trash || [])];
  if (items.length) await appendToArchive(items, "empty-bin");
  state.trash = [];
  save();
  notifyTrashChanged();
}

// Urgency level for a note based on its due date and urgency window.
// Returns: "none" | "soon" | "urgent" | "overdue"
export function urgencyLevel(note) {
  if (!note.due) return "none";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(note.due + "T00:00:00");
  const days = Math.round((due - now) / 86400000);
  const window = Number(note.urgency) || 1;
  if (days < 0) return "overdue";
  if (days <= window) return "urgent";
  if (days <= window * 2) return "soon";
  return "none";
}

export function daysUntil(note) {
  if (!note.due) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(note.due + "T00:00:00");
  return Math.round((due - now) / 86400000);
}

/** First line of a note is its heading (shown in list views). */
export function noteHeading(text) {
  if (!text) return "";
  return String(text).split(/\r?\n/, 1)[0];
}

/** Everything after the first line. */
export function noteBody(text) {
  const lines = String(text || "").split(/\r?\n/);
  return lines.slice(1).join("\n");
}

/** Replace the first line while preserving the body after the line break. */
export function withNoteHeading(text, heading) {
  const body = noteBody(text);
  const h = heading == null ? "" : String(heading);
  return body.length ? `${h}\n${body}` : h;
}

/** Build full note text from heading + body. */
export function composeNoteText(heading, body) {
  const h = heading == null ? "" : String(heading);
  const b = body == null ? "" : String(body);
  return b.length ? `${h}\n${b}` : h;
}

function todayISOLocal() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function createMacReminder({ title, body, due, time, priority }) {
  return fetchJson("/api/reminder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: title || "TreeWeave task",
      body: body || "",
      due: due || todayISOLocal(),
      time: time || "09:00",
      priority: clampPriority(priority),
    }),
  });
}

// True when a project has an active note due in exactly one day.
export function projectDueInOneDay(project) {
  return (project.notes || []).some((n) => {
    if (n.bucket === "done") return false;
    return daysUntil(n) === 1;
  });
}

// True when a project has an active note past its due date.
export function projectIsOverdue(project) {
  return (project.notes || []).some((n) => {
    if (n.bucket === "done") return false;
    const d = daysUntil(n);
    return d !== null && d < 0;
  });
}

// Highest due alert for a leaf: "overdue" | "tomorrow" | null
export function projectDueAlert(project) {
  if (projectIsOverdue(project)) return "overdue";
  if (projectDueInOneDay(project)) return "tomorrow";
  return null;
}
