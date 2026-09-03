/**
 * In-app confirm dialog (works in browser and Electron; no window.confirm).
 *
 * @param {string} message
 * @param {{ confirmLabel?: string, cancelLabel?: string }} [options]
 * @returns {Promise<boolean>}
 */
export function askConfirm(message, { confirmLabel = "OK", cancelLabel = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const existing = document.querySelector(".tw-prompt-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.className = "tw-prompt-root";
    root.innerHTML = `
      <div class="tw-prompt-backdrop" data-act="backdrop"></div>
      <div class="tw-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-prompt-title">
        <p id="tw-prompt-title" class="tw-prompt-message"></p>
        <div class="tw-prompt-actions">
          <button type="button" class="btn ghost sm" data-act="cancel"></button>
          <button type="button" class="btn primary sm" data-act="confirm"></button>
        </div>
      </div>
    `;
    const msg = root.querySelector(".tw-prompt-message");
    msg.textContent = message;
    root.querySelector('button[data-act="cancel"]').textContent = cancelLabel;
    root.querySelector('button[data-act="confirm"]').textContent = confirmLabel;

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      root.remove();
      document.removeEventListener("keydown", onDocKey, true);
      resolve(value);
    }

    function onDocKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    }

    root.querySelectorAll('[data-act="cancel"], [data-act="backdrop"]').forEach((el) => {
      el.addEventListener("click", () => finish(false));
    });
    root.querySelector('[data-act="confirm"]').addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onDocKey, true);

    document.body.appendChild(root);
    requestAnimationFrame(() => root.querySelector('[data-act="confirm"]').focus());
  });
}

/**
 * In-app text prompt. Electron does not implement window.prompt(), so tree
 * rename / add flows use this instead (works in browser and the Mac app).
 *
 * @param {string} message
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>} trimmed value, or null if cancelled
 */
export function askText(message, defaultValue = "") {
  return new Promise((resolve) => {
    const existing = document.querySelector(".tw-prompt-root");
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.className = "tw-prompt-root";
    root.innerHTML = `
      <div class="tw-prompt-backdrop" data-act="cancel"></div>
      <div class="tw-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="tw-prompt-title">
        <p id="tw-prompt-title" class="tw-prompt-message"></p>
        <input type="text" class="tw-prompt-input" autocomplete="off" spellcheck="false" />
        <div class="tw-prompt-actions">
          <button type="button" class="btn ghost sm" data-act="cancel">Cancel</button>
          <button type="button" class="btn primary sm" data-act="ok">OK</button>
        </div>
      </div>
    `;
    const msg = root.querySelector(".tw-prompt-message");
    const input = root.querySelector(".tw-prompt-input");
    msg.textContent = message;
    input.value = defaultValue == null ? "" : String(defaultValue);

    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      root.remove();
      document.removeEventListener("keydown", onDocKey, true);
      resolve(value);
    }

    function submit() {
      const v = input.value.trim();
      finish(v ? v : null);
    }

    function onDocKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    }

    root.querySelectorAll('[data-act="cancel"]').forEach((el) => {
      el.addEventListener("click", () => finish(null));
    });
    root.querySelector('[data-act="ok"]').addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    document.addEventListener("keydown", onDocKey, true);

    document.body.appendChild(root);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}
