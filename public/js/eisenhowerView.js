// Eisenhower matrix: priority (Y) vs time urgency (X). Each note is a dot.

import { state, leavesOf, noteHeading, notePriority, daysUntil, updateNote } from "./state.js";
import { askConfirm } from "./promptDialog.js";

const PAD = 56;
const DOT_R = 6;
const HIT_R = 11;
const MIN_SEP = 14; // 2× dot radius — tight pack, no overlap
const DRAG_THRESHOLD_PX = 36;
const CLICK_MAX_PX = 6;

/** Fixed for this page load; new cluster shapes on each app start. */
const SESSION_SEED = (Math.random() * 0xffffffff) >>> 0;

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clusterRng(bucket) {
  let h = SESSION_SEED;
  for (let i = 0; i < bucket.length; i++) h = (Math.imul(h, 31) + bucket.charCodeAt(i)) | 0;
  return mulberry32(h >>> 0);
}

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
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

function collectItems() {
  const items = [];
  for (const project of leavesOf(state.root)) {
    for (const note of project.notes || []) {
      if (note.bucket === "done") continue;
      items.push({
        note,
        projectId: project.id,
        projectName: project.name,
        task: noteHeading(note.text) || "(empty)",
        due: note.due || "",
        priority: notePriority(note),
        color: note.color || "#ffe066",
      });
    }
  }
  return items;
}

/** Priority: P1 at top, P5 in bottom quarter (y → 1). */
function priorityY(priority) {
  const p = Math.min(5, Math.max(1, priority));
  const top = 0.06;
  const p5Center = 0.88;
  return top + ((p - 1) * (p5Center - top)) / 4;
}

/** Map normalized Y back to priority 1–5. */
function priorityFromY(py) {
  const top = 0.06;
  const p5Center = 0.88;
  const raw = 1 + ((py - top) / (p5Center - top)) * 4;
  return Math.min(5, Math.max(1, Math.round(raw)));
}

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const out = pt.matrixTransform(ctm.inverse());
  return { x: out.x, y: out.y };
}

/** Time: no date in left quarter; due today at right edge. */
function stableOffset(id, span) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * span;
}

function timeX(due, noteId) {
  if (!due) return 0.05 + stableOffset(noteId, 0.18);

  const days = daysUntil({ due });
  if (days === null) return 0.12;
  if (days < 0) return 0.97;
  if (days === 0) return 0.99;
  const cap = 45;
  const t = Math.min(days, cap) / cap;
  return 0.26 + 0.68 * (1 - t);
}

function bucketKey(x, y) {
  const cell = 0.055;
  return `${Math.round(x / cell)},${Math.round(y / cell)}`;
}

/** Spread dots that share a bucket so they do not overlap. */
function layoutClusters(items) {
  const w = 900;
  const h = 620;
  const plotW = w - PAD * 2;
  const plotH = h - PAD * 2;
  const toPx = (nx, ny) => ({ x: PAD + nx * plotW, y: PAD + ny * plotH });
  const toNorm = (px, py) => ({ x: (px - PAD) / plotW, y: (py - PAD) / plotH });

  const groups = new Map();
  for (const item of items) {
    item.nx = timeX(item.due, item.note.id);
    item.ny = priorityY(item.priority);
    const key = bucketKey(item.nx, item.ny);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      group[0].px = group[0].nx;
      group[0].py = group[0].ny;
      continue;
    }
    const rng = clusterRng(key);
    const cx = group.reduce((s, i) => s + i.nx, 0) / group.length;
    const cy = group.reduce((s, i) => s + i.ny, 0) / group.length;
    const center = toPx(cx, cy);
    const n = group.length;
    const rotation = rng() * Math.PI * 2;
    const ringScale = 0.94 + rng() * 0.12;
    const ring = (MIN_SEP / (2 * Math.sin(Math.PI / n))) * ringScale;

    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }

    group.forEach((item, idx) => {
      const angle = rotation + (2 * Math.PI * idx) / n;
      const pos = toNorm(
        center.x + ring * Math.cos(angle),
        center.y + ring * Math.sin(angle)
      );
      item.px = pos.x;
      item.py = pos.y;
    });
  }

  const overlapRng = mulberry32(SESSION_SEED ^ 0x9e3779b9);
  // Resolve any remaining overlaps in pixel space
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        let ap = toPx(a.px, a.py);
        let bp = toPx(b.px, b.py);
        let dx = bp.x - ap.x;
        let dy = bp.y - ap.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= MIN_SEP) continue;
        if (dist < 0.001) {
          const angle = overlapRng() * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const shift = (MIN_SEP - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        ap.x -= shift * ux;
        ap.y -= shift * uy;
        bp.x += shift * ux;
        bp.y += shift * uy;
        const an = toNorm(ap.x, ap.y);
        const bn = toNorm(bp.x, bp.y);
        a.px = an.x;
        a.py = an.y;
        b.px = bn.x;
        b.py = bn.y;
      }
    }
  }

  for (const item of items) {
    item.px = Math.min(0.98, Math.max(0.02, item.px));
    item.py = Math.min(0.98, Math.max(0.02, item.py));
  }
}

function quadrantRects(w, h) {
  const x0 = PAD;
  const y0 = PAD;
  const x1 = w - PAD;
  const y1 = h - PAD;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [
    { x: mx, y: y0, width: x1 - mx, height: my - y0, class: "eq-q-tr" },
    { x: x0, y: y0, width: mx - x0, height: my - y0, class: "eq-q-tl" },
    { x: x0, y: my, width: mx - x0, height: y1 - my, class: "eq-q-bl" },
    { x: mx, y: my, width: x1 - mx, height: y1 - my, class: "eq-q-br" },
  ];
}

export function renderEisenhowerView(container, { onOpenNote, onUpdate } = {}) {
  if (!container) return;

  const items = collectItems();
  layoutClusters(items);

  const w = 900;
  const h = 620;
  const x0 = PAD;
  const y0 = PAD;
  const x1 = w - PAD;
  const y1 = h - PAD;
  const plotH = y1 - y0;

  const dots = items
    .map((item) => {
      const cx = x0 + item.px * (x1 - x0);
      const cy = y0 + item.py * plotH;
      const title = `${item.task} · ${item.projectName} · P${item.priority}${item.due ? ` · ${item.due}` : ""}`;
      return `<g class="eq-dot" data-project="${escapeHtml(item.projectId)}" data-note="${escapeHtml(item.note.id)}" data-priority="${item.priority}" tabindex="0" role="button" aria-label="${escapeHtml(title)}">
        <circle class="eq-dot-hit" cx="${cx}" cy="${cy}" r="${HIT_R}" fill="transparent"/>
        <circle class="eq-dot-core" cx="${cx}" cy="${cy}" r="${DOT_R}" fill="${escapeHtml(item.color)}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
        <title>${escapeHtml(title)}</title>
      </g>`;
    })
    .join("");

  const quads = quadrantRects(w, h)
    .map(
      (q) =>
        `<rect class="eq-quad ${q.class}" x="${q.x}" y="${q.y}" width="${q.width}" height="${q.height}" rx="4"/>`
    )
    .join("");

  container.innerHTML = `
    <div class="eisenhower-view">
      <div class="global-head">
        <h2>Eisenhower Matrix</h2>
        <p class="hint">${items.length} active item${items.length === 1 ? "" : "s"} · priority ↑ · time urgency → · click to open · drag vertically to change priority</p>
      </div>
      <div class="eisenhower-scroll">
        <svg class="eisenhower-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-label="Eisenhower matrix">
          ${quads}
          <line class="eq-axis" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"/>
          <line class="eq-axis" x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}"/>
          <line class="eq-grid" x1="${(x0 + x1) / 2}" y1="${y0}" x2="${(x0 + x1) / 2}" y2="${y1}"/>
          <line class="eq-grid" x1="${x0}" y1="${(y0 + y1) / 2}" x2="${x1}" y2="${(y0 + y1) / 2}"/>
          <text class="eq-label eq-label-x" x="${(x0 + x1) / 2}" y="${y1 + 34}" text-anchor="middle">Time urgency →</text>
          <text class="eq-label eq-label-x-end" x="${x1}" y="${y1 + 18}" text-anchor="end">Due today</text>
          <text class="eq-label eq-label-x-start" x="${x0}" y="${y1 + 18}" text-anchor="start">No date</text>
          <text class="eq-label eq-label-y" x="${x0 - 12}" y="${(y0 + y1) / 2}" text-anchor="middle" transform="rotate(-90 ${x0 - 12} ${(y0 + y1) / 2})">Priority ↑</text>
          <text class="eq-label eq-label-y-top" x="${x0 - 8}" y="${y0 + 4}" text-anchor="end">P1</text>
          <text class="eq-label eq-label-y-bot" x="${x0 - 8}" y="${y1}" text-anchor="end">P5</text>
          <g class="eq-dots">${dots || ""}</g>
          ${
            items.length
              ? ""
              : `<text class="eq-empty" x="${w / 2}" y="${h / 2}" text-anchor="middle">No active tasks to plot</text>`
          }
        </svg>
      </div>
    </div>`;

  const itemByNote = new Map(items.map((item) => [item.note.id, item]));
  const svg = container.querySelector(".eisenhower-svg");

  container.querySelectorAll(".eq-dot").forEach((g) => {
    let drag = null;

    const circles = () => ({
      hit: g.querySelector(".eq-dot-hit"),
      core: g.querySelector(".eq-dot-core"),
    });

    const setCy = (cy) => {
      const { hit, core } = circles();
      hit.setAttribute("cy", String(cy));
      core.setAttribute("cy", String(cy));
    };

    const finishDrag = async (state) => {
      g.classList.remove("eq-dragging");
      const { projectId, noteId, originPriority, startCy, startPt, endPt, moved, vertDist } = state;
      const item = itemByNote.get(noteId);

      if (!moved || Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) <= CLICK_MAX_PX) {
        if (onOpenNote) onOpenNote(projectId, noteId);
        return;
      }

      if (vertDist < DRAG_THRESHOLD_PX) {
        setCy(startCy);
        return;
      }

      const cy = parseFloat(circles().core.getAttribute("cy"));
      const newPriority = priorityFromY((cy - y0) / plotH);
      if (newPriority === originPriority) {
        setCy(startCy);
        return;
      }

      const task = item?.task || "this task";
      const ok = await askConfirm(
        `Change priority of "${task}" from P${originPriority} to P${newPriority}?`,
        { confirmLabel: "Yes", cancelLabel: "No" }
      );
      if (ok) {
        updateNote(projectId, noteId, { priority: newPriority });
        onUpdate?.();
      } else {
        setCy(startCy);
      }
    };

    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      drag = {
        pointerId: e.pointerId,
        projectId: g.dataset.project,
        noteId: g.dataset.note,
        originPriority: Number(g.dataset.priority) || 5,
        startCy: parseFloat(circles().core.getAttribute("cy")),
        startPt: svgPoint(svg, e.clientX, e.clientY),
        moved: false,
        vertDist: 0,
      };
    });

    g.addEventListener("pointermove", (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const pt = svgPoint(svg, e.clientX, e.clientY);
      const dy = pt.y - drag.startPt.y;
      drag.vertDist = Math.abs(dy);
      if (drag.vertDist > 3) drag.moved = true;
      if (!drag.moved) return;
      g.classList.add("eq-dragging");
      const cy = Math.min(y1, Math.max(y0, drag.startCy + dy));
      setCy(cy);
    });

    const onPointerEnd = (e) => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (g.hasPointerCapture(e.pointerId)) g.releasePointerCapture(e.pointerId);
      const endPt = svgPoint(svg, e.clientX, e.clientY);
      const snapshot = { ...drag, endPt };
      drag = null;
      finishDrag(snapshot);
    };

    g.addEventListener("pointerup", onPointerEnd);
    g.addEventListener("pointercancel", onPointerEnd);

    g.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (onOpenNote) onOpenNote(g.dataset.project, g.dataset.note);
      }
    });
  });
}
