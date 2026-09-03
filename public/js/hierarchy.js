// Expandable tree view (vertical, anchored to the left).
//
// Each edge is ONE solid line whose thickness == the number of projects in
// that branch, so branches merge into a thick solid trunk toward the root and
// taper to thin lines at the leaves. Children diverge from a node as straight,
// angled lines (not right angles). Clicking a branch expands it in place: its
// children appear directly beneath it.
//
// Reorder by dragging a node's label text (not the circle). Drop above/below
// another row to insert as a sibling, or on a branch disc to nest under it.

import {
  state,
  save,
  isProject,
  leafCount,
  activeNoteCount,
  findNode,
  areaIndexOf,
  colorForArea,
  renameNode,
  projectDueAlert,
  moveNode,
} from "./state.js";
import { askText } from "./promptDialog.js";

const NS = "http://www.w3.org/2000/svg";

const CFG = {
  leftPad: 24,
  topPad: 40,
  indentX: 30,
  rowH: 30,
  leafR: 7,
  groupR: 5,
  labelGap: 190,
  minHeight: 300,
  dragThreshold: 5,
};

let drag = null;
let lastClick = { id: null, t: 0, target: null };
const DBLCLICK_MS = 450;

function isSecondClick(nodeId, target) {
  const now = performance.now();
  const dbl =
    lastClick.id === nodeId &&
    lastClick.target === target &&
    now - lastClick.t < DBLCLICK_MS;
  lastClick = { id: nodeId, t: now, target };
  return dbl;
}

function el(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    n.setAttribute(k, String(v));
  }
  return n;
}

async function promptRename(node, rerender) {
  const name = await askText("Rename branch:", node.name);
  if (name && name !== node.name) {
    renameNode(node.id, name);
    rerender();
  }
}

function getExpanded() {
  return new Set(Array.isArray(state.ui.expanded) ? state.ui.expanded : []);
}
function commitExpanded(set) {
  state.ui.expanded = [...set];
  save();
}

function edgeWidth(count) {
  return Math.max(2, Math.min(11, 1.2 + count * 1.1));
}

function collectGroupIds(node, out) {
  if (!isProject(node)) {
    if (node.id !== "root") out.push(node.id);
    (node.children || []).forEach((c) => collectGroupIds(c, out));
  }
  return out;
}

function descendantsAndSelf(node, out) {
  out.add(node.id);
  (node.children || []).forEach((c) => descendantsAndSelf(c, out));
  return out;
}

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  return pt.matrixTransform(ctm.inverse());
}

function resolveDrop(visible, draggedId, blocked, svgX, svgY) {
  const { topPad, rowH } = CFG;
  if (!visible.length) return null;

  // Nest into a group when pointer is near its disc
  for (const v of visible) {
    if (v.node.id === draggedId) continue;
    if (isProject(v.node)) continue;
    if (blocked.has(v.node.id)) continue;
    if (Math.abs(svgY - v.y) <= rowH * 0.4 && Math.abs(svgX - v.x) <= 18) {
      return {
        parentId: v.node.id,
        index: (v.node.children || []).length,
        indicatorY: v.y + rowH * 0.45,
        nestId: v.node.id,
      };
    }
  }

  let best = null;
  let bestDist = Infinity;
  for (const v of visible) {
    if (v.node.id === "root" || v.node.id === draggedId) continue;
    const d = Math.abs(svgY - v.y);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }

  const nonRoot = visible.filter((v) => v.node.id !== "root");
  if (!nonRoot.length) {
    return { parentId: "root", index: 0, indicatorY: topPad + rowH / 2 };
  }
  if (svgY < nonRoot[0].y - rowH * 0.25) {
    const first = nonRoot[0];
    if (!first.parent || blocked.has(first.parent.id)) return null;
    return {
      parentId: first.parent.id,
      index: 0,
      indicatorY: first.y - rowH / 2,
    };
  }

  if (!best || !best.parent || blocked.has(best.parent.id)) return null;
  const sibIndex = (best.parent.children || []).findIndex(
    (c) => c.id === best.node.id
  );
  if (sibIndex < 0) return null;
  const before = svgY < best.y;
  return {
    parentId: best.parent.id,
    index: before ? sibIndex : sibIndex + 1,
    indicatorY: before ? best.y - rowH / 2 : best.y + rowH / 2,
  };
}

function clearDropVisuals(svg) {
  svg
    .querySelectorAll(".drop-indicator, .drop-nest-ring")
    .forEach((n) => n.remove());
}

function showDropVisuals(svg, drop, width) {
  clearDropVisuals(svg);
  if (!drop) return;
  if (drop.nestId && drag && drag.byId) {
    const v = drag.byId.get(drop.nestId);
    if (v) {
      svg.appendChild(
        el("circle", {
          cx: v.x,
          cy: v.y,
          r: 14,
          class: "drop-nest-ring",
          fill: "none",
          stroke: "var(--accent)",
          "stroke-width": 2,
          "stroke-dasharray": "4 3",
          opacity: 0.95,
          "pointer-events": "none",
        })
      );
    }
  }
  svg.appendChild(
    el("line", {
      x1: CFG.leftPad - 6,
      y1: drop.indicatorY,
      x2: width - 12,
      y2: drop.indicatorY,
      class: "drop-indicator",
      stroke: "var(--accent)",
      "stroke-width": 2.5,
      "stroke-linecap": "round",
      opacity: 0.95,
      "pointer-events": "none",
    })
  );
}

function endDrag(svg, rerender, commit) {
  if (!drag) return;
  const session = drag;
  drag = null;
  window.removeEventListener("mousemove", session.onMove);
  window.removeEventListener("mouseup", session.onUp);
  clearDropVisuals(svg);
  svg.classList.remove("tree-dragging");
  if (session.ghost) session.ghost.remove();
  if (session.labelEl) session.labelEl.classList.remove("tlabel-dragging");

  if (commit && session.active && session.drop) {
    const ok = moveNode(
      session.nodeId,
      session.drop.parentId,
      session.drop.index
    );
    if (ok) {
      if (session.drop.parentId !== "root") {
        const set = getExpanded();
        set.add(session.drop.parentId);
        commitExpanded(set);
      }
      state.ui.selectedNodeId = session.nodeId;
      save();
      rerender();
      return;
    }
  }
  if (session.active) rerender();
}

/** Start a drag from the node label text only. */
function beginLabelDrag(svg, opts, v, visible, byId, labelEl, e) {
  if (v.node.id === "root") return;
  e.stopPropagation();

  const blocked = descendantsAndSelf(v.node, new Set());
  const width = Number(svg.getAttribute("width")) || 420;
  const rerender = opts.rerender || (() => renderHierarchy(svg, opts));

  const session = {
    nodeId: v.node.id,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    drop: null,
    byId,
    visible,
    ghost: null,
    labelEl,
    onMove: null,
    onUp: null,
  };

  session.onMove = (ev) => {
    const dx = ev.clientX - session.startX;
    const dy = ev.clientY - session.startY;
    if (!session.active && Math.hypot(dx, dy) >= CFG.dragThreshold) {
      session.active = true;
      ev.preventDefault();
      svg.classList.add("tree-dragging");
      labelEl.classList.add("tlabel-dragging");
      const ghost = el("text", {
        class: "drag-ghost-label",
        "pointer-events": "none",
        fill: "var(--accent)",
        "font-size": "13",
        "font-weight": "700",
        opacity: 0.9,
      });
      ghost.textContent = v.node.name;
      svg.appendChild(ghost);
      session.ghost = ghost;
    }
    if (!session.active) return;

    const p = svgPoint(svg, ev.clientX, ev.clientY);
    session.drop = resolveDrop(visible, session.nodeId, blocked, p.x, p.y);
    showDropVisuals(svg, session.drop, width);
    if (session.ghost) {
      session.ghost.setAttribute("x", String(p.x + 12));
      session.ghost.setAttribute("y", String(p.y + 4));
    }
  };

  session.onUp = (ev) => {
    const wasDragging = session.active;
    endDrag(svg, rerender, true);

    // Short press on the label: select (and toggle expand for branches).
    // Skip the second click of a double-click so the name can still open/rename.
    if (!wasDragging && ev.detail !== 2) {
      const node = v.node;
      const leaf = isProject(node);
      state.ui.selectedNodeId = node.id;
      if (!leaf) {
        const set = getExpanded();
        if (set.has(node.id)) set.delete(node.id);
        else set.add(node.id);
        commitExpanded(set);
      } else {
        save();
      }
      rerender();
    }
  };

  drag = session;
  window.addEventListener("mousemove", session.onMove);
  window.addEventListener("mouseup", session.onUp);
}

function renderControls(expanded, rerender) {
  const host = document.getElementById("tree-crumbs");
  if (!host) return;
  host.innerHTML = "";

  const title = document.createElement("span");
  title.className = "tree-title";
  title.textContent = state.root.name;
  host.appendChild(title);

  const expandAll = document.createElement("button");
  expandAll.className = "crumb";
  expandAll.textContent = "Expand all";
  expandAll.addEventListener("click", () => {
    commitExpanded(new Set(collectGroupIds(state.root, [])));
    rerender();
  });
  host.appendChild(expandAll);

  const collapse = document.createElement("button");
  collapse.className = "crumb";
  collapse.textContent = "Collapse all";
  collapse.addEventListener("click", () => {
    commitExpanded(new Set());
    rerender();
  });
  host.appendChild(collapse);
}

export function renderHierarchy(svg, opts) {
  const { onOpenProject } = opts;
  const rerender = opts.rerender || (() => renderHierarchy(svg, opts));

  if (drag) endDrag(svg, rerender, false);

  const root = state.root;
  const expanded = getExpanded();
  renderControls(expanded, rerender);

  const visible = [];
  (function walk(node, depth, parent) {
    visible.push({ node, depth, parent, x: 0, y: 0 });
    if (depth === 0 || expanded.has(node.id)) {
      for (const c of node.children || []) walk(c, depth + 1, node);
    }
  })(root, 0, null);

  const { leftPad, topPad, indentX, rowH } = CFG;
  let maxDepth = 0;
  visible.forEach((v, i) => {
    v.x = leftPad + v.depth * indentX;
    v.y = topPad + i * rowH + rowH / 2;
    if (v.depth > maxDepth) maxDepth = v.depth;
  });

  const container = svg.parentElement;
  const availW = Math.max(420, container.clientWidth - 4);
  const height = Math.max(CFG.minHeight, topPad + visible.length * rowH + 30);
  const width = Math.max(availW, leftPad + maxDepth * indentX + CFG.labelGap);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.style.width = width + "px";
  svg.style.height = height + "px";
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const selId = state.ui.selectedNodeId;
  let selSet = null;
  if (selId) {
    const r = findNode(selId);
    if (r) selSet = descendantsAndSelf(r.node, new Set());
  }

  const byId = new Map(visible.map((v) => [v.node.id, v]));

  const bg = el("rect", { x: 0, y: 0, width, height, fill: "transparent" });
  bg.addEventListener("click", () => {
    if (state.ui.selectedNodeId) {
      state.ui.selectedNodeId = null;
      save();
      rerender();
    }
  });
  svg.appendChild(bg);

  const childrenByParent = new Map();
  for (const v of visible) {
    if (!v.parent) continue;
    const arr = childrenByParent.get(v.parent.id) || [];
    arr.push(v);
    childrenByParent.set(v.parent.id, arr);
  }

  const edgesG = el("g");
  svg.appendChild(edgesG);

  for (const [pid, kids] of childrenByParent) {
    const p = byId.get(pid);
    if (!p) continue;
    const isRootParent = pid === "root";
    const spineColor = isRootParent
      ? "var(--muted)"
      : colorForArea(areaIndexOf(pid));
    const spineW = edgeWidth(leafCount(p.node));
    const lastY = kids[kids.length - 1].y;
    const spineDim = selSet && !selSet.has(pid);

    const spine = el("line", {
      x1: p.x,
      y1: p.y,
      x2: p.x,
      y2: lastY,
      stroke: spineColor,
      "stroke-width": spineW,
      "stroke-linecap": "round",
      opacity: spineDim ? 0.16 : 0.85,
    });
    spine.style.transition = "opacity .18s";
    edgesG.appendChild(spine);

    for (const k of kids) {
      const color = colorForArea(areaIndexOf(k.node.id));
      const w = edgeWidth(leafCount(k.node));
      const dim = selSet && !selSet.has(k.node.id);
      const link = el("line", {
        x1: p.x,
        y1: k.y,
        x2: k.x,
        y2: k.y,
        stroke: color,
        "stroke-width": w,
        "stroke-linecap": "round",
        opacity: dim ? 0.16 : 0.9,
      });
      link.style.transition = "opacity .18s";
      edgesG.appendChild(link);
    }
  }

  const nodesG = el("g");
  svg.appendChild(nodesG);

  for (const v of visible) {
    const node = v.node;
    const leaf = isProject(node);
    const isRoot = node.id === "root";
    const color = isRoot ? "var(--muted)" : colorForArea(areaIndexOf(node.id));
    const isSel = node.id === selId;
    const dim = selSet && !selSet.has(node.id);

    const g = el("g", { class: "tnode", cursor: "pointer" });
    g.dataset.nodeId = node.id;

    if (leaf) {
      const alert = projectDueAlert(node);
      if (alert) {
        const ring = el("circle", {
          cx: v.x,
          cy: v.y,
          r: CFG.leafR + 3,
          fill: "none",
          stroke: "var(--danger)",
          "stroke-width": alert === "overdue" ? 1.75 : 1,
          opacity: dim ? 0.55 : 1,
        });
        if (alert === "overdue") {
          ring.setAttribute("class", "leaf-overdue-ring");
        }
        g.appendChild(ring);
      }
      const circle = el("circle", {
        cx: v.x,
        cy: v.y,
        r: CFG.leafR,
        class: "bubble-core",
        stroke: color,
        "stroke-width": isSel ? 3.5 : 2.5,
        opacity: dim ? 0.55 : 1,
      });
      g.appendChild(circle);
      const nc = activeNoteCount(node);
      if (nc) {
        const b = el("text", {
          x: v.x,
          y: v.y + 3.5,
          "text-anchor": "middle",
          class: "bubble-count",
          opacity: dim ? 0.85 : 1,
        });
        b.textContent = String(nc);
        g.appendChild(b);
      }
    } else {
      const disc = el("circle", {
        cx: v.x,
        cy: v.y,
        r: isRoot ? 7 : CFG.groupR,
        fill: color,
        opacity: dim ? 0.55 : 1,
      });
      if (isSel) {
        disc.style.stroke = "var(--ring)";
        disc.style.strokeWidth = "1.5px";
      }
      g.appendChild(disc);

      const open = isRoot || expanded.has(node.id);
      const caret = el("text", {
        x: v.x + 11,
        y: v.y + 4,
        class: "tcaret",
        opacity: dim ? 0.8 : 1,
      });
      caret.textContent = open ? "▾" : "▸";
      g.appendChild(caret);
    }

    const labelX = v.x + (leaf ? 15 : isRoot ? 13 : 24);
    const alert = leaf ? projectDueAlert(node) : null;
    const name = el("text", {
      x: labelX,
      y: v.y + 4,
      class:
        "tlabel" +
        (isRoot ? " troot" : " tlabel-draggable") +
        (alert ? " tlabel-due" : ""),
      opacity: dim ? 0.88 : 1,
    });
    name.textContent = node.name;
    const meta = el("tspan", { class: "tmeta", dx: 9 });
    if (leaf) {
      const nc = activeNoteCount(node);
      meta.textContent = `${nc} note${nc === 1 ? "" : "s"}`;
    } else {
      const lc = leafCount(node);
      meta.textContent = `${lc} project${lc === 1 ? "" : "s"}`;
    }
    name.appendChild(meta);

    name.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (leaf) {
        onOpenProject(node.id);
      } else if (!isRoot) {
        promptRename(node, rerender);
      }
    });

    // Drag starts from the label text only (not the circle/disc)
    if (!isRoot) {
      name.style.cursor = "grab";
      name.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        beginLabelDrag(svg, { ...opts, rerender }, v, visible, byId, name, e);
      });
    }

    g.appendChild(name);

    // Circle / disc click: select + expand (no drag)
    g.addEventListener("click", (e) => {
      if (e.target === name || (e.target.closest && e.target.closest("text.tlabel")))
        return;
      e.stopPropagation();
      if (e.detail === 2) return;
      state.ui.selectedNodeId = node.id;
      if (!leaf && !isRoot) {
        const set = getExpanded();
        if (set.has(node.id)) set.delete(node.id);
        else set.add(node.id);
        commitExpanded(set);
      } else {
        save();
      }
      rerender();
    });

    g.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (leaf) onOpenProject(node.id);
    });

    nodesG.appendChild(g);
  }

  const hint = document.getElementById("hierarchy-hint");
  if (hint && !hint.dataset.dndHint) {
    hint.textContent =
      "Drag a name to reorder · click a branch to expand · double-click a project to open";
    hint.dataset.dndHint = "1";
  }

  const stat = document.getElementById("commitment-stat");
  if (stat) {
    stat.textContent = `${leafCount(root)} projects · ${
      root.children.length
    } areas`;
  }
}
