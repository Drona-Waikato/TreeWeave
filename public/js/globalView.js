// List views: Global (all tasks) and Due Today (tasks due today).

import { state, save, leavesOf, urgencyLevel, noteHeading, notePriority } from "./state.js";

const STATUS_ORDER = { todo: 0, doing: 1, open: 2, done: 3 };
const STATUS_LABEL = {
  todo: "To-Do",
  doing: "Doing",
  done: "Done",
  open: "Open",
};

let sortCol = "status";
let sortDir = 1;
let currentMode = "global";

function todayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function statusKey(bucket) {
  if (bucket === "todo" || bucket === "doing" || bucket === "done")
    return bucket;
  return "open";
}

function collectRows() {
  const rows = [];
  for (const project of leavesOf(state.root)) {
    for (const note of project.notes || []) {
      rows.push({
        note,
        projectId: project.id,
        projectName: project.name,
        task: noteHeading(note.text),
        due: note.due || "",
        status: statusKey(note.bucket),
        assignee: note.assignee || "",
        priority: notePriority(note),
      });
    }
  }
  return rows;
}

function filterRows(rows, mode) {
  if (mode === "dueToday") {
    const today = todayISO();
    return rows.filter((r) => r.due === today);
  }
  return rows;
}

function compareRows(a, b) {
  let va, vb;
  switch (sortCol) {
    case "task":
      va = a.task.toLowerCase();
      vb = b.task.toLowerCase();
      break;
    case "node":
      va = a.projectName.toLowerCase();
      vb = b.projectName.toLowerCase();
      break;
    case "due":
      va = a.due || "9999-99-99";
      vb = b.due || "9999-99-99";
      break;
    case "status":
      va = STATUS_ORDER[a.status];
      vb = STATUS_ORDER[b.status];
      break;
    case "assignee":
      va = a.assignee.toLowerCase();
      vb = b.assignee.toLowerCase();
      break;
    case "priority":
      va = a.priority;
      vb = b.priority;
      break;
    default:
      va = 0;
      vb = 0;
  }
  if (va < vb) return -1 * sortDir;
  if (va > vb) return 1 * sortDir;
  const pa = a.priority - b.priority;
  if (pa !== 0) return pa;
  const sa = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (sa !== 0) return sa;
  return (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99");
}

function sortIndicator(col) {
  if (sortCol !== col) return "";
  return sortDir > 0 ? " ▲" : " ▼";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function formatDue(due) {
  if (!due) return "—";
  const d = new Date(due + "T00:00:00");
  if (Number.isNaN(d.getTime())) return due;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const VIEW_META = {
  global: {
    title: "Global View",
    empty: "No items yet — add post-its in a project",
    hint: (n) =>
      `${n} item${n === 1 ? "" : "s"} across all projects · click a column header to sort`,
  },
  dueToday: {
    title: "Due Today",
    empty: "Nothing due today",
    hint: (n) =>
      `${n} item${n === 1 ? "" : "s"} due today · click a column header to sort`,
  },
};

export function renderListView(container, { mode = "global", onOpenProject } = {}) {
  if (!container) return;
  currentMode = mode;
  const meta = VIEW_META[mode] || VIEW_META.global;

  const rows = filterRows(collectRows(), mode).sort(compareRows);

  container.innerHTML = `
    <div class="global-view">
      <div class="global-head">
        <h2>${meta.title}</h2>
        <p class="hint">${meta.hint(rows.length)}</p>
      </div>
      <div class="global-scroll">
        <table class="global-table">
          <thead>
            <tr>
              <th data-sort="task" class="sortable">Task${sortIndicator("task")}</th>
              <th data-sort="node" class="sortable">Node${sortIndicator("node")}</th>
              <th data-sort="priority" class="sortable">Priority${sortIndicator("priority")}</th>
              <th data-sort="due" class="sortable">Due date${sortIndicator("due")}</th>
              <th data-sort="status" class="sortable">Status${sortIndicator("status")}</th>
              <th data-sort="assignee" class="sortable">Assigned to${sortIndicator("assignee")}</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map((r) => {
                      const lvl = urgencyLevel(r.note);
                      const cls = [
                        "global-row",
                        `status-${r.status}`,
                        lvl === "overdue" ? "list-overdue" : "",
                        lvl === "urgent" ? "list-urgent" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return `<tr class="${cls}" data-project="${escapeHtml(
                        r.projectId
                      )}">
                        <td class="col-task">${escapeHtml(r.task || "(empty)")}</td>
                        <td class="col-node"><button type="button" class="node-link" data-project="${escapeHtml(
                          r.projectId
                        )}">${escapeHtml(r.projectName)}</button></td>
                        <td class="col-priority"><span class="priority-pill">P${r.priority}</span></td>
                        <td class="col-due">${escapeHtml(formatDue(r.due))}</td>
                        <td class="col-status"><span class="status-pill status-pill-${r.status}">${STATUS_LABEL[r.status]}</span></td>
                        <td class="col-assignee">${escapeHtml(r.assignee || "—")}</td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="6" class="list-empty">${meta.empty}</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  container.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (sortCol === col) sortDir *= -1;
      else {
        sortCol = col;
        sortDir = 1;
      }
      renderListView(container, { mode: currentMode, onOpenProject });
    });
  });

  container.querySelectorAll(".node-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.project;
      if (id && onOpenProject) onOpenProject(id);
    });
  });

  container.querySelectorAll(".global-row").forEach((tr) => {
    tr.addEventListener("dblclick", () => {
      const id = tr.dataset.project;
      if (id && onOpenProject) onOpenProject(id);
    });
  });
}

/** @param {'tree'|'global'|'dueToday'} view */
export function setMainView(view) {
  state.ui.mainView = view;
  save();
}

export function isListView() {
  const v = state.ui.mainView;
  return v === "global" || v === "dueToday" || v === "recycle" || v === "eisenhower";
}

// backwards compat
export function renderGlobalView(container, opts) {
  return renderListView(container, { ...opts, mode: "global" });
}

export function setGlobalView(on) {
  setMainView(on ? "global" : "tree");
}
