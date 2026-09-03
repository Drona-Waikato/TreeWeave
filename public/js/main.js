// App bootstrap: wire the hierarchy view, the project pane, header actions,
// branch editing, and the theme toggle.

import {
  state,
  save,
  initState,
  exportData,
  importData,
  addArea,
  addChild,
  renameNode,
  removeNode,
  findNode,
  isProject,
  trashCount,
} from "./state.js";
import { renderHierarchy } from "./hierarchy.js";
import { openProject, closeProject, refreshUrgency, dismissPoppedNote } from "./pane.js";
import { renderListView, setMainView } from "./globalView.js";
import { renderEisenhowerView } from "./eisenhowerView.js";
import { renderRecycleView } from "./recycleView.js";
import { askText } from "./promptDialog.js";

const svg = document.getElementById("hierarchy-svg");
const nodeActions = document.getElementById("node-actions");
const storageStat = document.getElementById("storage-stat");
const hierarchyPanel = document.getElementById("hierarchy-panel");
const globalPanel = document.getElementById("global-panel");
const globalViewRoot = document.getElementById("global-view-root");
const globalViewBtn = document.getElementById("global-view-btn");
const dueTodayBtn = document.getElementById("due-today-btn");
const eisenhowerBtn = document.getElementById("eisenhower-btn");
const recycleBtn = document.getElementById("recycle-btn");
const recycleCount = document.getElementById("recycle-count");

function setStorageStatus(text, ok = true) {
  if (!storageStat) return;
  storageStat.textContent = text;
  storageStat.classList.toggle("bad", !ok);
}

function updateRecycleBadge() {
  const n = trashCount();
  if (recycleCount) {
    recycleCount.textContent = String(n);
    recycleCount.classList.toggle("hidden", n === 0);
  }
  if (recycleBtn) recycleBtn.classList.toggle("has-items", n > 0);
}

function updateViewButtons() {
  const view = state.ui.mainView || "tree";
  if (globalViewBtn) {
    globalViewBtn.classList.toggle("active", view === "global");
  }
  if (dueTodayBtn) {
    dueTodayBtn.classList.toggle("active", view === "dueToday");
  }
  if (eisenhowerBtn) {
    eisenhowerBtn.classList.toggle("active", view === "eisenhower");
  }
  if (recycleBtn) {
    recycleBtn.classList.toggle("active", view === "recycle");
  }
  updateRecycleBadge();
}

function draw() {
  const view = state.ui.mainView || "tree";
  const listOn =
    view === "global" ||
    view === "dueToday" ||
    view === "recycle" ||
    view === "eisenhower";
  updateViewButtons();

  if (hierarchyPanel) hierarchyPanel.classList.toggle("hidden", listOn);
  if (globalPanel) globalPanel.classList.toggle("hidden", !listOn);

  if (view === "recycle") {
    renderRecycleView(globalViewRoot, {
      onChange: draw,
      onRestore: (projectId) => {
        if (projectId) onOpenProject(projectId);
      },
    });
  } else if (view === "global" || view === "dueToday") {
    renderListView(globalViewRoot, { mode: view, onOpenProject });
  } else if (view === "eisenhower") {
    renderEisenhowerView(globalViewRoot, {
      onOpenNote: (projectId, noteId) => {
        openProject(projectId, { onClose: draw, noteId });
      },
      onUpdate: draw,
    });
  } else {
    renderHierarchy(svg, { onOpenProject, rerender: draw });
    renderNodeActions();
  }
}

function onOpenProject(projectId, noteId) {
  openProject(projectId, { onClose: draw, noteId });
}

// ---- expand/collapse helpers -------------------------------------------
function getExpanded() {
  return new Set(Array.isArray(state.ui.expanded) ? state.ui.expanded : []);
}
function setExpanded(set) {
  state.ui.expanded = [...set];
  save();
}
function expand(id) {
  const set = getExpanded();
  set.add(id);
  setExpanded(set);
}

// ---- contextual branch toolbar (expand / rename / add / delete) --------
// Operates on the selected node, or on the root when nothing is selected.
function renderNodeActions() {
  const targetId = state.ui.selectedNodeId || "root";
  const res = findNode(targetId);
  if (!res) {
    nodeActions.classList.add("hidden");
    nodeActions.innerHTML = "";
    return;
  }
  const node = res.node;
  const leaf = isProject(node);
  const isRoot = node.id === "root";
  const expandedSet = getExpanded();

  nodeActions.classList.remove("hidden");
  let primary = "";
  if (leaf) {
    primary = `<button class="btn ghost sm" data-act="open">Open ▸</button>`;
  } else if (!isRoot) {
    const isOpen = expandedSet.has(node.id);
    primary = `<button class="btn ghost sm" data-act="toggle">${
      isOpen ? "Collapse" : "Expand"
    }</button>`;
  }

  nodeActions.innerHTML = `
    <span class="na-name" title="Acting on this branch">${escapeHtml(
      node.name
    )}</span>
    ${primary}
    <button class="btn ghost sm" data-act="project">+ Node</button>
    <button class="btn ghost sm" data-act="branch">+ Level</button>
    <button class="btn ghost sm" data-act="rename">Rename</button>
    <button class="btn ghost sm danger" data-act="delete" ${
      isRoot ? "disabled" : ""
    }>Delete</button>`;

  const open = nodeActions.querySelector('[data-act="open"]');
  if (open) open.onclick = () => onOpenProject(node.id);

  const toggle = nodeActions.querySelector('[data-act="toggle"]');
  if (toggle)
    toggle.onclick = () => {
      const set = getExpanded();
      if (set.has(node.id)) set.delete(node.id);
      else set.add(node.id);
      setExpanded(set);
      draw();
    };

  // "+ Node": add a project (a leaf) inside this branch.
  nodeActions.querySelector('[data-act="project"]').onclick = async () => {
    const name = await askText("Name of the new node (project):", "New project");
    if (name) addAndReveal(node, true, name);
  };

  // "+ Level": add a sub-branch (a new level) inside this branch.
  nodeActions.querySelector('[data-act="branch"]').onclick = async () => {
    const name = await askText("Name of the new level (sub-branch):", "New level");
    if (name) {
      const child = addChild(node.id, name, false);
      if (child) addChild(child.id, "New project", true); // starter line
      expand(node.id); // reveal the new level beneath this branch
      if (child) expand(child.id);
      state.ui.selectedNodeId = child ? child.id : node.id;
      save();
      draw();
    }
  };

  nodeActions.querySelector('[data-act="rename"]').onclick = async () => {
    const name = await askText("Rename branch:", node.name);
    if (name && name !== node.name) {
      renameNode(node.id, name);
      draw();
    }
  };

  nodeActions.querySelector('[data-act="delete"]').onclick = () => {
    if (node.id === "root") return;
    if (confirm(`Delete "${node.name}" and everything inside it?`)) {
      removeNode(node.id);
      const set = getExpanded();
      set.delete(node.id);
      setExpanded(set);
      state.ui.selectedNodeId = null;
      save();
      draw();
    }
  };
}

// Add a child to `parent`, expand the parent so the new node appears beneath
// it, and select the new node.
function addAndReveal(parent, asProject, name) {
  const child = addChild(parent.id, name, asProject);
  expand(parent.id);
  state.ui.selectedNodeId = child ? child.id : null;
  save();
  draw();
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

// ---- theme -------------------------------------------------------------
const THEME_KEY = "treeweave.theme";
const THEMES = ["dark", "light", "material", "cyberpunk", "metallic", "win98"];
const THEME_ICONS = {
  dark: "☾",
  light: "☀",
  material: "◆",
  cyberpunk: "⚡",
  metallic: "◈",
  win98: "▣",
};

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = "dark";
  document.documentElement.setAttribute("data-theme", theme);
  const icon = document.getElementById("theme-icon");
  if (icon) icon.textContent = THEME_ICONS[theme] || "☾";
  const select = document.getElementById("theme-select");
  if (select) select.value = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {}
}

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
document.getElementById("theme-select").addEventListener("change", (e) => {
  applyTheme(e.target.value);
});

// ---- bootstrap ---------------------------------------------------------
async function boot() {
  setStorageStatus("Loading…");
  try {
    await initState();
    setStorageStatus("Server");
  } catch (e) {
    setStorageStatus("Offline", false);
    console.error(e);
  }

  draw();

  if (state.ui.openProjectId) {
    onOpenProject(state.ui.openProjectId);
  }
}

boot();

window.addEventListener("treeweave:trash", updateRecycleBadge);

let rt;
window.addEventListener("resize", () => {
  clearTimeout(rt);
  rt = setTimeout(draw, 150);
});

document.getElementById("export-btn").addEventListener("click", async () => {
  try {
    await exportData();
  } catch (e) {
    alert("Export failed: " + e.message);
  }
});

const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = "";
  if (!file) return;
  if (
    !confirm(
      `Import "${file.name}"? This replaces the current tree on the server.`
    )
  )
    return;
  try {
    closeProject();
    await importData(file);
    setStorageStatus("Server");
    draw();
  } catch (e) {
    alert("Import failed: " + e.message);
    setStorageStatus("Error", false);
  }
});

document.getElementById("add-area-btn").addEventListener("click", async () => {
  const name = await askText("Name of the new top-level area:");
  if (name) {
    const area = addArea(name);
    if (area) {
      addChild(area.id, "New project", true);
      state.ui.selectedNodeId = area.id;
      save();
    }
    draw();
  }
});

document.getElementById("global-view-btn").addEventListener("click", () => {
  const view = state.ui.mainView || "tree";
  setMainView(view === "global" ? "tree" : "global");
  draw();
});

document.getElementById("due-today-btn").addEventListener("click", () => {
  const view = state.ui.mainView || "tree";
  setMainView(view === "dueToday" ? "tree" : "dueToday");
  draw();
});

document.getElementById("eisenhower-btn").addEventListener("click", () => {
  const view = state.ui.mainView || "tree";
  setMainView(view === "eisenhower" ? "tree" : "eisenhower");
  draw();
});

document.getElementById("recycle-btn").addEventListener("click", () => {
  const view = state.ui.mainView || "tree";
  setMainView(view === "recycle" ? "tree" : "recycle");
  draw();
});

setInterval(() => {
  refreshUrgency();
  updateRecycleBadge();
  draw();
}, 60 * 1000);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (dismissPoppedNote()) return;
    closeProject();
  }
});
