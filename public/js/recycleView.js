// Recycle bin: soft-deleted notes retained for 7 days, recoverable to original node.

import {
  listTrash,
  daysLeftInTrash,
  restoreFromTrash,
  permanentlyDeleteTrash,
  emptyTrash,
  noteHeading,
  findProject,
  notePriority,
} from "./state.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c])
  );
}

function formatDeleted(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function renderRecycleView(container, { onRestore, onChange } = {}) {
  if (!container) return;
  const items = listTrash();

  container.innerHTML = `
    <div class="global-view recycle-view">
      <div class="global-head recycle-head">
        <div>
          <h2>Recycle Bin</h2>
          <p class="hint">${
            items.length
              ? `${items.length} item${items.length === 1 ? "" : "s"} · kept for 7 days`
              : "Empty — deleted notes appear here for 7 days"
          }</p>
        </div>
        ${
          items.length
            ? `<button type="button" class="btn ghost sm" id="empty-trash-btn">Empty bin</button>`
            : ""
        }
      </div>
      <div class="global-scroll">
        <table class="global-table recycle-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Priority</th>
              <th>Original node</th>
              <th>Deleted</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items
                    .map((item) => {
                      const heading = noteHeading(item.note?.text) || "(empty)";
                      const days = daysLeftInTrash(item);
                      const nodeExists = !!findProject(item.projectId);
                      const pri = notePriority(item.note);
                      return `<tr class="global-row recycle-row" data-trash="${escapeHtml(
                        item.id
                      )}">
                        <td class="col-task">
                          <span class="list-swatch" style="background:${escapeHtml(
                            item.note?.color || "#ffe066"
                          )}"></span>
                          ${escapeHtml(heading)}
                        </td>
                        <td class="col-priority"><span class="priority-pill">P${pri}</span></td>
                        <td class="col-node">${escapeHtml(
                          item.projectName || "Unknown"
                        )}${
                        nodeExists
                          ? ""
                          : ` <span class="recycle-missing">(missing)</span>`
                      }</td>
                        <td class="col-due">${escapeHtml(
                          formatDeleted(item.deletedAt)
                        )}</td>
                        <td class="col-due">${days}d left</td>
                        <td class="col-actions recycle-actions">
                          <button type="button" class="btn ghost sm restore-btn" data-trash="${escapeHtml(
                            item.id
                          )}" ${nodeExists ? "" : "disabled"} title="${
                        nodeExists
                          ? "Restore to original node"
                          : "Original node no longer exists"
                      }">Restore</button>
                          <button type="button" class="btn ghost sm danger purge-btn" data-trash="${escapeHtml(
                            item.id
                          )}" title="Delete forever">Delete</button>
                        </td>
                      </tr>`;
                    })
                    .join("")
                : `<tr><td colspan="6" class="list-empty">Recycle bin is empty</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>`;

  const emptyBtn = container.querySelector("#empty-trash-btn");
  if (emptyBtn) {
    emptyBtn.addEventListener("click", async () => {
      if (!confirm("Permanently delete all items in the recycle bin?")) return;
      try {
        await emptyTrash();
      } catch (e) {
        alert("Could not empty the recycle bin (archive failed). Try again.");
        console.warn(e);
        return;
      }
      if (onChange) onChange();
      else renderRecycleView(container, { onRestore, onChange });
    });
  }

  container.querySelectorAll(".restore-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.trash;
      const result = restoreFromTrash(id);
      if (!result.ok) {
        alert(
          result.reason === "node-missing"
            ? `Cannot restore — the original node "${result.projectName || ""}" no longer exists.`
            : "Could not restore this item."
        );
        return;
      }
      if (onChange) onChange();
      else renderRecycleView(container, { onRestore, onChange });
      if (onRestore) onRestore(result.projectId);
    });
  });

  container.querySelectorAll(".purge-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.trash;
      if (!confirm("Delete this item permanently?")) return;
      try {
        await permanentlyDeleteTrash(id);
      } catch (e) {
        alert("Could not delete permanently (archive failed). Try again.");
        console.warn(e);
        return;
      }
      if (onChange) onChange();
      else renderRecycleView(container, { onRestore, onChange });
    });
  });
}
