// Project pane: a board for one project.
// Add post-it notes (colour, due date, urgency), connect them to the
// To-Do / Doing / Done buckets. Notes connected to Done collapse into thin
// stacked lines.

import {
  state,
  save,
  PALETTE,
  findProject,
  findNode,
  addNote,
  updateNote,
  softDeleteNote,
  urgencyLevel,
  daysUntil,
  noteHeading,
  withNoteHeading,
  noteBody,
  composeNoteText,
  notePriority,
  createMacReminder,
} from "./state.js";

let current = { projectId: null, onClose: null };
let overlay = null;
let poppedNoteEl = null;
let listSortCol = "status";
let listSortDir = 1;

const BUCKETS = [
  { id: "todo", label: "To-Do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

function pathTo(id) {
  const names = [];
  function walk(node, trail) {
    if (node.id === id) {
      names.push(...trail, node.name);
      return true;
    }
    for (const c of node.children || []) {
      if (walk(c, [...trail, node.name])) return true;
    }
    return false;
  }
  walk(state.root, []);
  return names;
}

export function openProject(projectId, { onClose, noteId } = {}) {
  current = { projectId, onClose, noteId: noteId || null };
  state.ui.openProjectId = projectId;
  if (noteId) {
    state.ui.paneView = "board";
  }
  save();
  overlay = document.getElementById("pane-overlay");
  overlay.classList.remove("hidden");
  if (!overlay._backdropWired) {
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeProject();
    });
    overlay._backdropWired = true;
  }
  renderPane();
  if (noteId) focusNote(noteId);
}

function focusNote(noteId) {
  if (!overlay || !noteId) return;
  requestAnimationFrame(() => {
    const wrap = overlay.querySelector(`[data-note="${noteId}"]`);
    if (!wrap) return;
    wrap.scrollIntoView({ block: "center", behavior: "smooth" });
    wrap.classList.add("postit-focus-flash");
    setTimeout(() => wrap.classList.remove("postit-focus-flash"), 1800);
    if (wrap.classList.contains("postit")) {
      const canvas = wrap.closest(".note-canvas");
      const body = wrap.querySelector(".postit-body");
      const heading = wrap.querySelector(".postit-heading");
      if (canvas && (body || heading)) {
        popNote(wrap, canvas, body || heading);
      }
    } else {
      const input = wrap.querySelector(".list-task");
      if (input) input.focus();
    }
  });
}

export function closeProject() {
  collapsePoppedNote();
  if (overlay) overlay.classList.add("hidden");
  state.ui.openProjectId = null;
  save();
  const cb = current.onClose;
  current = { projectId: null, onClose: null };
  if (cb) cb();
}

function urgencyText(note) {
  const d = daysUntil(note);
  if (d === null) return "no date";
  if (d < 0) return `overdue by ${Math.abs(d)}d`;
  if (d === 0) return "due today";
  if (d === 1) return "due tomorrow";
  return `due in ${d}d`;
}

function todayISO() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const BELL_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 1.2A2.3 2.3 0 0 0 5.7 3.5v.35C4.1 4.5 3 6.1 3 8v2.15L1.7 12.3V13h12.6v-.7L13 10.15V8c0-1.9-1.1-3.5-2.7-4.15V3.5A2.3 2.3 0 0 0 8 1.2zm0 13.1c.9 0 1.6-.5 1.9-1.2H6.1c.3.7 1 1.2 1.9 1.2z"/></svg>';

function makeReminderButton(note, project, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = extraClass || "postit-remind";
  btn.title = "Add to Mac Reminders";
  btn.setAttribute("aria-label", "Add to Mac Reminders");
  btn.innerHTML = BELL_SVG;
  if (note.macReminderAt) btn.classList.add("has-reminder");
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openReminderDialog(note, project, btn);
  });
  return btn;
}

function openReminderDialog(note, project, anchorBtn) {
  if (!overlay) return;
  overlay.querySelector(".reminder-dialog")?.remove();

  const dlg = document.createElement("div");
  dlg.className = "reminder-dialog";
  dlg.innerHTML = `
    <h3>Mac Reminder</h3>
    <p class="hint">Adds this note to the Reminders app in a list named TreeWeave.</p>
    <label class="reminder-field">Date
      <input type="date" class="reminder-date" />
    </label>
    <label class="reminder-field">Time
      <input type="time" class="reminder-time" />
    </label>
    <div class="reminder-actions">
      <button type="button" class="btn ghost sm reminder-cancel">Cancel</button>
      <button type="button" class="btn primary sm reminder-ok">Add to Reminders</button>
    </div>
    <p class="reminder-status hint" hidden></p>
  `;
  const dateInput = dlg.querySelector(".reminder-date");
  const timeInput = dlg.querySelector(".reminder-time");
  const status = dlg.querySelector(".reminder-status");
  const okBtn = dlg.querySelector(".reminder-ok");
  dateInput.value = note.due || todayISO();
  timeInput.value = "09:00";

  dlg.querySelector(".reminder-cancel").addEventListener("click", () => dlg.remove());
  okBtn.addEventListener("click", async () => {
    const title = noteHeading(note.text) || "Untitled note";
    const parts = [];
    if (project?.name) parts.push(`Project: ${project.name}`);
    if (note.assignee) parts.push(`Assigned to: ${note.assignee}`);
    const details = noteBody(note.text);
    if (details) parts.push(details);
    okBtn.disabled = true;
    status.hidden = false;
    status.textContent = "Adding…";
    try {
      await createMacReminder({
        title,
        body: parts.join("\n"),
        due: dateInput.value,
        time: timeInput.value,
        priority: notePriority(note),
      });
      if (!note.due && dateInput.value) {
        updateNote(project.id, note.id, { due: dateInput.value });
        note.due = dateInput.value;
      }
      const stamp = new Date().toISOString();
      updateNote(project.id, note.id, { macReminderAt: stamp });
      note.macReminderAt = stamp;
      if (anchorBtn) anchorBtn.classList.add("has-reminder");
      status.textContent = "Added to Reminders.";
      setTimeout(() => dlg.remove(), 900);
    } catch (err) {
      okBtn.disabled = false;
      status.textContent = err.message || "Could not add reminder";
    }
  });
  overlay.appendChild(dlg);
}

function renderPane() {
  collapsePoppedNote();
  const project = findProject(current.projectId);
  if (!project) {
    closeProject();
    return;
  }
  project.notes = project.notes || [];
  const trail = pathTo(project.id);
  const view = state.ui.paneView === "list" ? "list" : "board";

  overlay.innerHTML = "";

  const pane = document.createElement("div");
  pane.className = "pane";

  // ---- header ----
  const header = document.createElement("div");
  header.className = "pane-header";
  header.innerHTML = `
    <div class="pane-title">
      <nav class="breadcrumb">${trail
        .slice(0, -1)
        .map((n) => `<span>${escapeHtml(n)}</span>`)
        .join('<span class="crumb-sep">›</span>')}</nav>
      <h2>${escapeHtml(project.name)}</h2>
    </div>
    <div class="pane-header-actions">
      <div class="view-toggle" role="group" aria-label="Pane view">
        <button type="button" class="btn ghost sm ${
          view === "board" ? "active" : ""
        }" id="pane-view-board" title="Board view">Board</button>
        <button type="button" class="btn ghost sm ${
          view === "list" ? "active" : ""
        }" id="pane-view-list" title="List view">List</button>
      </div>
      <button class="btn primary" id="pane-add-note">+ ${
        view === "list" ? "Task" : "Post-it"
      }</button>
      <button class="btn ghost" id="pane-close">Close ✕</button>
    </div>`;
  pane.appendChild(header);

  const board = document.createElement("div");
  board.className = "pane-board";

  if (view === "list") {
    board.appendChild(buildListView(project));
  } else {
    // ---- canvas (floating notes + connector svg) ----
    const canvas = document.createElement("div");
    canvas.className = "note-canvas";
    canvas.innerHTML = `<div class="canvas-hint">Click empty space to add a post-it · drag a note's bottom bubble onto a bucket</div>`;

    const svgNS = "http://www.w3.org/2000/svg";
    const connSvg = document.createElementNS(svgNS, "svg");
    connSvg.classList.add("conn-svg");
    canvas.appendChild(connSvg);

    for (const note of project.notes) {
      if (note.bucket === "done") continue;
      canvas.appendChild(buildNote(project, note, canvas, connSvg));
    }

    canvas.addEventListener("mousedown", (e) => {
      if (e.target !== canvas && !e.target.classList.contains("canvas-hint"))
        return;
      const rect = canvas.getBoundingClientRect();
      const n = addNote(project.id, {
        x: e.clientX - rect.left - 90,
        y: e.clientY - rect.top - 30,
      });
      renderPane();
      requestAnimationFrame(() => {
        const ta = overlay.querySelector(`[data-note="${n.id}"] .postit-heading`);
        if (ta) ta.focus();
      });
    });

    board.appendChild(canvas);

    // ---- buckets ----
    const buckets = document.createElement("div");
    buckets.className = "buckets";
    for (const b of BUCKETS) {
      const inBucket = project.notes.filter((n) => n.bucket === b.id);
      const zone = document.createElement("div");
      zone.className = `bucket bucket-${b.id}`;
      zone.dataset.bucket = b.id;
      zone.innerHTML = `<div class="bucket-head"><span class="bucket-name">${b.label}</span><span class="bucket-count">${inBucket.length}</span></div>`;

      if (b.id === "done") {
        const stack = document.createElement("div");
        stack.className = "done-stack";
        for (const note of inBucket) {
          stack.appendChild(buildDoneBar(project, note));
        }
        zone.appendChild(stack);
      }
      buckets.appendChild(zone);
    }
    board.appendChild(buckets);

    requestAnimationFrame(() => drawConnectors(project, canvas, connSvg));
  }

  pane.appendChild(board);
  overlay.appendChild(pane);

  overlay.querySelector("#pane-close").addEventListener("click", closeProject);
  overlay.querySelector("#pane-view-board").addEventListener("click", () => {
    state.ui.paneView = "board";
    save();
    renderPane();
  });
  overlay.querySelector("#pane-view-list").addEventListener("click", () => {
    state.ui.paneView = "list";
    save();
    renderPane();
  });
  overlay.querySelector("#pane-add-note").addEventListener("click", () => {
    const n = addNote(project.id, {
      x: 60 + Math.random() * 80,
      y: 60,
      bucket: view === "list" ? "todo" : null,
    });
    renderPane();
    requestAnimationFrame(() => {
      if (view === "list") {
        const input = overlay.querySelector(`[data-note="${n.id}"] .list-task`);
        if (input) input.focus();
      } else {
        const ta = overlay.querySelector(`[data-note="${n.id}"] .postit-heading`);
        if (ta) ta.focus();
      }
    });
  });
}

function buildListView(project) {
  const wrap = document.createElement("div");
  wrap.className = "note-list";

  const table = document.createElement("table");
  table.className = "todo-table";

  function sortMark(col) {
    if (listSortCol !== col) return "";
    return listSortDir > 0 ? " ▲" : " ▼";
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-task sortable" data-sort="task">Task${sortMark("task")}</th>
        <th class="col-priority sortable" data-sort="priority">Priority${sortMark(
          "priority"
        )}</th>
        <th class="col-assignee sortable" data-sort="assignee">Assigned to${sortMark(
          "assignee"
        )}</th>
        <th class="col-date sortable" data-sort="due">Date${sortMark("due")}</th>
        <th class="col-status sortable" data-sort="status">Status${sortMark(
          "status"
        )}</th>
        <th class="col-actions"></th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  const notes = [...project.notes].sort((a, b) => {
    let va, vb;
    switch (listSortCol) {
      case "task":
        va = noteHeading(a.text).toLowerCase();
        vb = noteHeading(b.text).toLowerCase();
        break;
      case "priority":
        va = notePriority(a);
        vb = notePriority(b);
        break;
      case "assignee":
        va = (a.assignee || "").toLowerCase();
        vb = (b.assignee || "").toLowerCase();
        break;
      case "due":
        va = a.due || "9999-99-99";
        vb = b.due || "9999-99-99";
        break;
      case "status":
      default: {
        const order = { todo: 0, doing: 1, null: 2, undefined: 2, done: 3 };
        va = order[a.bucket] ?? 2;
        vb = order[b.bucket] ?? 2;
        break;
      }
    }
    if (va < vb) return -1 * listSortDir;
    if (va > vb) return 1 * listSortDir;
    return notePriority(a) - notePriority(b);
  });

  if (!notes.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = `<td colspan="6" class="list-empty">No tasks yet — click + Task to add one</td>`;
    tbody.appendChild(empty);
  }

  for (const note of notes) {
    const tr = document.createElement("tr");
    tr.dataset.note = note.id;
    tr.className = "list-row status-" + (note.bucket || "open");
    if (urgencyLevel(note) === "overdue") tr.classList.add("list-overdue");
    else if (urgencyLevel(note) === "urgent") tr.classList.add("list-urgent");

    const swatch = document.createElement("span");
    swatch.className = "list-swatch";
    swatch.style.background = note.color || PALETTE[0];

    const taskCell = document.createElement("td");
    taskCell.className = "col-task";
    const taskWrap = document.createElement("div");
    taskWrap.className = "list-task-wrap";
    taskWrap.appendChild(swatch);
    const taskInput = document.createElement("input");
    taskInput.type = "text";
    taskInput.className = "list-task";
    taskInput.value = noteHeading(note.text);
    taskInput.placeholder = "Write a task…";
    taskInput.title = note.text || "";
    taskInput.addEventListener("input", () => {
      updateNote(project.id, note.id, {
        text: withNoteHeading(note.text, taskInput.value),
      });
    });
    taskWrap.appendChild(taskInput);
    taskCell.appendChild(taskWrap);

    const priorityCell = document.createElement("td");
    priorityCell.className = "col-priority";
    const priorityWrap = document.createElement("label");
    priorityWrap.className = "list-priority";
    const prefix = document.createElement("span");
    prefix.className = "priority-prefix";
    prefix.textContent = "P";
    const priorityInput = document.createElement("input");
    priorityInput.type = "number";
    priorityInput.min = "1";
    priorityInput.max = "5";
    priorityInput.className = "list-priority-input";
    priorityInput.value = String(notePriority(note));
    priorityInput.title = "Priority 1–5 (1 highest)";
    priorityInput.addEventListener("change", () => {
      const p = notePriority({ priority: priorityInput.value });
      priorityInput.value = String(p);
      updateNote(project.id, note.id, { priority: p });
    });
    priorityWrap.append(prefix, priorityInput);
    priorityCell.appendChild(priorityWrap);

    const assigneeCell = document.createElement("td");
    assigneeCell.className = "col-assignee";
    const assigneeInput = document.createElement("input");
    assigneeInput.type = "text";
    assigneeInput.className = "list-assignee";
    assigneeInput.value = note.assignee || "";
    assigneeInput.placeholder = "Unassigned";
    assigneeInput.addEventListener("input", () => {
      updateNote(project.id, note.id, { assignee: assigneeInput.value });
    });
    assigneeCell.appendChild(assigneeInput);

    const dateCell = document.createElement("td");
    dateCell.className = "col-date";
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "list-date";
    dateInput.value = note.due || "";
    dateInput.addEventListener("change", () => {
      updateNote(project.id, note.id, { due: dateInput.value });
      tr.classList.remove("list-overdue", "list-urgent");
      note.due = dateInput.value;
      const lvl = urgencyLevel(note);
      if (lvl === "overdue") tr.classList.add("list-overdue");
      else if (lvl === "urgent") tr.classList.add("list-urgent");
    });
    dateCell.appendChild(dateInput);

    const statusCell = document.createElement("td");
    statusCell.className = "col-status";
    const select = document.createElement("select");
    select.className = "list-status";
    const opts = [
      { value: "", label: "Open" },
      { value: "todo", label: "To-Do" },
      { value: "doing", label: "Doing" },
      { value: "done", label: "Done" },
    ];
    for (const o of opts) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if ((note.bucket || "") === o.value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      const bucket = select.value || null;
      updateNote(project.id, note.id, { bucket });
      note.bucket = bucket;
      tr.className =
        "list-row status-" +
        (bucket || "open") +
        (urgencyLevel(note) === "overdue" ? " list-overdue" : "") +
        (urgencyLevel(note) === "urgent" ? " list-urgent" : "");
    });
    statusCell.appendChild(select);

    const actCell = document.createElement("td");
    actCell.className = "col-actions";
    const del = document.createElement("button");
    del.className = "btn ghost sm list-del";
    del.title = "Delete";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      softDeleteNote(project.id, note.id);
      renderPane();
    });
    actCell.appendChild(makeReminderButton(note, project, "btn ghost sm list-remind"));
    actCell.appendChild(del);

    tr.append(
      taskCell,
      priorityCell,
      assigneeCell,
      dateCell,
      statusCell,
      actCell
    );
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);

  table.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (listSortCol === col) listSortDir *= -1;
      else {
        listSortCol = col;
        listSortDir = 1;
      }
      renderPane();
    });
  });

  return wrap;
}

function collapsePoppedNote() {
  if (!poppedNoteEl) return false;
  poppedNoteEl.classList.remove("postit-popped");
  const canvas = poppedNoteEl.closest(".note-canvas");
  if (canvas) canvas.classList.remove("has-popped");
  const scrim = canvas && canvas.querySelector(".postit-scrim");
  if (scrim) scrim.remove();
  poppedNoteEl = null;
  return true;
}

export function dismissPoppedNote() {
  if (overlay) {
    const dlg = overlay.querySelector(".reminder-dialog");
    if (dlg) {
      dlg.remove();
      return true;
    }
  }
  return collapsePoppedNote();
}

function popNote(wrap, canvas, focusEl) {
  if (poppedNoteEl === wrap) return;
  collapsePoppedNote();
  poppedNoteEl = wrap;
  wrap.classList.add("postit-popped");
  canvas.classList.add("has-popped");
  let scrim = canvas.querySelector(".postit-scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "postit-scrim";
    canvas.appendChild(scrim);
    scrim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      collapsePoppedNote();
    });
  }
  requestAnimationFrame(() => {
    if (focusEl) focusEl.focus();
  });
}

function lineInfo(ta) {
  const value = ta.value;
  const pos = ta.selectionStart ?? value.length;
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const nl = value.indexOf("\n", pos);
  const lineEnd = nl === -1 ? value.length : nl;
  return {
    value,
    pos,
    lineStart,
    lineEnd,
    line: value.slice(lineStart, lineEnd),
  };
}

function isBulletLine(line) {
  return /^\s*[•\-\*]\s/.test(line);
}

function stripBullet(line) {
  return line.replace(/^\s*[•\-\*]\s*/, "");
}

function emptyBulletLine(line) {
  return /^\s*[•\-\*]\s*$/.test(line);
}

function setBulletActive(btn, on) {
  btn.classList.toggle("active", !!on);
  btn.title = on ? "Stop bullet list" : "Start bullet list";
}

function applyLine(ta, lineStart, lineEnd, newLine) {
  const value = ta.value;
  ta.value = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
  const caret = lineStart + newLine.length;
  ta.setSelectionRange(caret, caret);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function toggleBulletMode(ta, btn, getMode, setMode) {
  const info = lineInfo(ta);
  const on = getMode();
  if (on || isBulletLine(info.line)) {
    setMode(false);
    if (isBulletLine(info.line)) {
      applyLine(ta, info.lineStart, info.lineEnd, stripBullet(info.line));
    }
    setBulletActive(btn, false);
  } else {
    setMode(true);
    if (!isBulletLine(info.line)) {
      const next = info.line.trim() ? `• ${info.line}` : "• ";
      applyLine(ta, info.lineStart, info.lineEnd, next);
    }
    setBulletActive(btn, true);
  }
}

function refreshBulletButton(ta, btn, getMode) {
  const info = lineInfo(ta);
  setBulletActive(btn, getMode() || isBulletLine(info.line));
}

function handleBodyEnter(ta, btn, getMode, setMode, e) {
  const info = lineInfo(ta);
  const inList = getMode() || isBulletLine(info.line);
  if (!inList) return;

  e.preventDefault();
  setMode(true);
  setBulletActive(btn, true);

  // Empty bullet → exit list (paragraph mode)
  if (emptyBulletLine(info.line)) {
    setMode(false);
    applyLine(ta, info.lineStart, info.lineEnd, "");
    setBulletActive(btn, false);
    return;
  }

  const before = info.value.slice(0, info.pos);
  const after = info.value.slice(info.pos);
  ta.value = `${before}\n• ${after}`;
  const caret = before.length + 3; // \n•␠
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildNote(project, note, canvas, connSvg) {
  const wrap = document.createElement("div");
  wrap.className = "postit";
  wrap.dataset.note = note.id;
  wrap.style.left = note.x + "px";
  wrap.style.top = note.y + "px";
  wrap.style.background = note.color;
  applyUrgency(wrap, note);

  let listMode = false;

  // left tool rail (visible when popped — sits outside the note)
  const tools = document.createElement("div");
  tools.className = "postit-tools";
  const bulletBtn = document.createElement("button");
  bulletBtn.type = "button";
  bulletBtn.className = "postit-tool";
  bulletBtn.title = "Start bullet list";
  bulletBtn.setAttribute("aria-label", "Toggle bullet list");
  bulletBtn.innerHTML = `<span class="postit-tool-icon">•</span>`;
  bulletBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  tools.appendChild(bulletBtn);
  wrap.appendChild(tools);

  // drag handle / header
  const bar = document.createElement("div");
  bar.className = "postit-bar";
  bar.innerHTML = `<span class="grip">⠿</span><span class="postit-bar-actions"></span>`;
  wrap.appendChild(bar);
  const barActions = bar.querySelector(".postit-bar-actions");
  const remindBtn = makeReminderButton(note, project);
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "postit-del";
  delBtn.title = "Delete";
  delBtn.textContent = "✕";
  barActions.append(remindBtn, delBtn);

  const heading = document.createElement("input");
  heading.type = "text";
  heading.className = "postit-heading";
  heading.value = noteHeading(note.text);
  heading.placeholder = "Heading…";
  heading.addEventListener("mousedown", (e) => e.stopPropagation());

  const body = document.createElement("textarea");
  body.className = "postit-body";
  body.value = noteBody(note.text);
  body.placeholder = "Details…";
  body.rows = 3;
  body.addEventListener("mousedown", (e) => e.stopPropagation());

  function syncText() {
    updateNote(project.id, note.id, {
      text: composeNoteText(heading.value, body.value),
    });
  }
  heading.addEventListener("input", syncText);
  body.addEventListener("input", () => {
    syncText();
    refreshBulletButton(body, bulletBtn, () => listMode);
  });
  body.addEventListener("keyup", () =>
    refreshBulletButton(body, bulletBtn, () => listMode)
  );
  body.addEventListener("click", () =>
    refreshBulletButton(body, bulletBtn, () => listMode)
  );
  heading.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      body.focus();
    }
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleBodyEnter(
        body,
        bulletBtn,
        () => listMode,
        (v) => {
          listMode = v;
        },
        e
      );
    }
  });

  bulletBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBulletMode(
      body,
      bulletBtn,
      () => listMode,
      (v) => {
        listMode = v;
      }
    );
  });

  wrap.appendChild(heading);
  wrap.appendChild(body);

  wrap.addEventListener("dblclick", (e) => {
    if (
      e.target.closest(".postit-del") ||
      e.target.closest(".postit-remind") ||
      e.target.closest(".note-connector") ||
      e.target.closest(".postit-tools")
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    popNote(wrap, canvas, body);
    listMode = isBulletLine(lineInfo(body).line);
    refreshBulletButton(body, bulletBtn, () => listMode);
  });

  // assignee
  const assigneeRow = document.createElement("div");
  assigneeRow.className = "postit-assignee";
  const assigneeLabel = document.createElement("span");
  assigneeLabel.className = "postit-assignee-label";
  assigneeLabel.textContent = "👤";
  const assignee = document.createElement("input");
  assignee.type = "text";
  assignee.className = "note-assignee";
  assignee.value = note.assignee || "";
  assignee.placeholder = "Assigned to…";
  assignee.title = "Assigned to";
  assignee.addEventListener("mousedown", (e) => e.stopPropagation());
  assignee.addEventListener("input", () => {
    updateNote(project.id, note.id, { assignee: assignee.value });
  });
  assigneeRow.append(assigneeLabel, assignee);
  wrap.appendChild(assigneeRow);

  // controls: colours + date + urgency
  const ctrl = document.createElement("div");
  ctrl.className = "postit-ctrl";

  const swatches = document.createElement("div");
  swatches.className = "swatches";
  for (const c of PALETTE) {
    const s = document.createElement("button");
    s.className = "swatch" + (c === note.color ? " active" : "");
    s.style.background = c;
    s.addEventListener("mousedown", (e) => e.stopPropagation());
    s.addEventListener("click", () => {
      updateNote(project.id, note.id, { color: c });
      wrap.style.background = c;
      swatches.querySelectorAll(".swatch").forEach((x) => x.classList.remove("active"));
      s.classList.add("active");
      drawConnectors(project, canvas, connSvg);
    });
    swatches.appendChild(s);
  }
  ctrl.appendChild(swatches);

  const dateRow = document.createElement("div");
  dateRow.className = "date-row";
  const date = document.createElement("input");
  date.type = "date";
  date.className = "note-date";
  date.value = note.due || "";
  date.addEventListener("mousedown", (e) => e.stopPropagation());
  date.addEventListener("change", () => {
    updateNote(project.id, note.id, { due: date.value });
    applyUrgency(wrap, note);
    urgTag.textContent = urgencyText(note);
  });

  const urgWrap = document.createElement("label");
  urgWrap.className = "urg-wrap";
  urgWrap.title = "Urgency window: glow when this many days remain";
  const urg = document.createElement("input");
  urg.type = "number";
  urg.min = "0";
  urg.className = "note-urg";
  urg.value = note.urgency ?? 1;
  urg.addEventListener("mousedown", (e) => e.stopPropagation());
  urg.addEventListener("change", () => {
    updateNote(project.id, note.id, { urgency: Number(urg.value) || 0 });
    applyUrgency(wrap, note);
  });
  urgWrap.append(urg, document.createTextNode("d ⏰"));

  dateRow.append(date, urgWrap);
  ctrl.appendChild(dateRow);

  const urgTag = document.createElement("div");
  urgTag.className = "urg-tag";
  urgTag.textContent = urgencyText(note);
  ctrl.appendChild(urgTag);

  wrap.appendChild(ctrl);

  // priority (bottom-right)
  const priority = document.createElement("label");
  priority.className = "postit-priority";
  priority.title = "Priority 1–5 (1 highest)";
  const priorityPrefix = document.createElement("span");
  priorityPrefix.className = "priority-prefix";
  priorityPrefix.textContent = "P";
  const priorityInput = document.createElement("input");
  priorityInput.type = "number";
  priorityInput.min = "1";
  priorityInput.max = "5";
  priorityInput.className = "postit-priority-input";
  priorityInput.value = String(notePriority(note));
  priorityInput.addEventListener("mousedown", (e) => e.stopPropagation());
  priorityInput.addEventListener("click", (e) => e.stopPropagation());
  priorityInput.addEventListener("change", () => {
    const p = notePriority({ priority: priorityInput.value });
    priorityInput.value = String(p);
    updateNote(project.id, note.id, { priority: p });
  });
  priority.append(priorityPrefix, priorityInput);
  wrap.appendChild(priority);

  // connector bubble at bottom
  const conn = document.createElement("div");
  conn.className = "note-connector";
  conn.title = "Drag onto a bucket";
  wrap.appendChild(conn);

  // delete
  bar.querySelector(".postit-del").addEventListener("click", (e) => {
    e.stopPropagation();
    softDeleteNote(project.id, note.id);
    renderPane();
  });

  // drag to move (via bar)
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".postit-del") || e.target.closest(".postit-remind"))
      return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const offX = e.clientX - (rect.left + note.x);
    const offY = e.clientY - (rect.top + note.y);
    wrap.classList.add("dragging");
    function move(ev) {
      note.x = Math.max(0, ev.clientX - rect.left - offX);
      note.y = Math.max(0, ev.clientY - rect.top - offY);
      wrap.style.left = note.x + "px";
      wrap.style.top = note.y + "px";
      drawConnectors(project, canvas, connSvg);
    }
    function up() {
      wrap.classList.remove("dragging");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      updateNote(project.id, note.id, { x: note.x, y: note.y });
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  // drag connector -> bucket
  conn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svgNS = "http://www.w3.org/2000/svg";
    const temp = document.createElementNS(svgNS, "path");
    temp.setAttribute("class", "conn-temp");
    connSvg.appendChild(temp);
    const cRect = canvas.getBoundingClientRect();
    const start = centerOf(conn, cRect, "bottom");

    BUCKETS.forEach((b) => {
      const z = overlay.querySelector(`.bucket-${b.id}`);
      if (z) z.classList.add("drop-active");
    });

    function move(ev) {
      const x = ev.clientX - cRect.left;
      const y = ev.clientY - cRect.top;
      temp.setAttribute("d", curve(start.x, start.y, x, y));
      overlay
        .querySelectorAll(".bucket")
        .forEach((z) => z.classList.remove("drop-hover"));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const bucket = el && el.closest(".bucket");
      if (bucket) bucket.classList.add("drop-hover");
    }
    function up(ev) {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      temp.remove();
      overlay
        .querySelectorAll(".bucket")
        .forEach((z) => z.classList.remove("drop-active", "drop-hover"));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const bucket = el && el.closest(".bucket");
      const target = bucket ? bucket.dataset.bucket : null;
      updateNote(project.id, note.id, { bucket: target });
      renderPane();
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  return wrap;
}

function buildDoneBar(project, note) {
  const bar = document.createElement("div");
  bar.className = "done-bar";
  bar.style.background = note.color;
  bar.title =
    (note.text || "(empty note)") +
    (note.assignee ? ` · ${note.assignee}` : "");
  bar.innerHTML = `<span class="done-bar-text">${escapeHtml(
    noteHeading(note.text) || "done"
  )}</span><button class="done-restore" title="Send back to board">↩</button>`;
  bar.querySelector(".done-restore").addEventListener("click", (e) => {
    e.stopPropagation();
    updateNote(project.id, note.id, { bucket: null });
    renderPane();
  });
  return bar;
}

function applyUrgency(wrap, note) {
  wrap.classList.remove("urg-soon", "urg-urgent", "urg-overdue");
  const lvl = urgencyLevel(note);
  if (lvl === "soon") wrap.classList.add("urg-soon");
  else if (lvl === "urgent") wrap.classList.add("urg-urgent");
  else if (lvl === "overdue") wrap.classList.add("urg-overdue");
}

function centerOf(node, canvasRect, edge = "center") {
  const r = node.getBoundingClientRect();
  const x = r.left + r.width / 2 - canvasRect.left;
  let y = r.top + r.height / 2 - canvasRect.top;
  if (edge === "bottom") y = r.bottom - canvasRect.top;
  if (edge === "top") y = r.top - canvasRect.top;
  return { x, y };
}

function curve(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

function drawConnectors(project, canvas, connSvg) {
  const rect = canvas.getBoundingClientRect();
  connSvg.setAttribute("width", rect.width);
  connSvg.setAttribute("height", rect.height);
  connSvg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  // clear (keep any temp path)
  connSvg
    .querySelectorAll("path:not(.conn-temp), .conn-dot")
    .forEach((p) => p.remove());

  for (const note of project.notes) {
    if (note.bucket !== "todo" && note.bucket !== "doing") continue;
    const noteEl = canvas.querySelector(`[data-note="${note.id}"] .note-connector`);
    const bucketEl = overlay.querySelector(`.bucket-${note.bucket}`);
    if (!noteEl || !bucketEl) continue;
    const start = centerOf(noteEl, rect, "bottom");
    const br = bucketEl.getBoundingClientRect();
    const end = {
      x: br.left + br.width / 2 - rect.left,
      y: br.top - rect.top + 6,
    };
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", curve(start.x, start.y, end.x, end.y));
    path.setAttribute("class", "conn-line");
    path.setAttribute("stroke", note.color);
    connSvg.appendChild(path);
  }
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

// Re-evaluate urgency visuals periodically (dates "approach").
export function refreshUrgency() {
  if (!overlay || overlay.classList.contains("hidden")) return;
  const project = findProject(current.projectId);
  if (!project) return;
  for (const note of project.notes || []) {
    const wrap = overlay.querySelector(`[data-note="${note.id}"]`);
    if (wrap) applyUrgency(wrap, note);
  }
}
