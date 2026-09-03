#!/usr/bin/env node
// TreeWeave local web server: static files + JSON API backed by disk storage.
// Usage: node server.js [port]
// Also exportable for the Electron desktop shell.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { execFile } = require("child_process");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function defaultState() {
  const today = new Date();
  const inDays = (d) => {
    const t = new Date(today);
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };
  let uid = 0;
  const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${++uid}`;
  const leaf = (name, notes = []) => ({
    id: id("p"),
    name,
    children: [],
    notes,
  });
  const group = (name, children) => ({
    id: id("g"),
    name,
    children,
    notes: [],
  });

  return {
    root: {
      id: "root",
      name: "Me",
      children: [
        group("Work", [
          group("Platform Team", [
            leaf("Billing rewrite", [
              {
                id: id("note"),
                text: "Draft new pricing schema",
                color: "#b693ff",
                x: 90,
                y: 80,
                due: inDays(2),
                urgency: 3,
                bucket: "doing",
                assignee: "Alex",
              },
              {
                id: id("note"),
                text: "Migrate legacy invoices",
                color: "#ffe066",
                x: 360,
                y: 140,
                due: inDays(0),
                urgency: 1,
                bucket: "todo",
                assignee: "Sam",
              },
              {
                id: id("note"),
                text: "Spec out webhooks",
                color: "#8fd3ff",
                x: 150,
                y: 300,
                due: "",
                urgency: 1,
                bucket: "done",
                assignee: "Alex",
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
                id: id("note"),
                text: "Choose worktop",
                color: "#ff8fb1",
                x: 110,
                y: 120,
                due: inDays(5),
                urgency: 2,
                bucket: null,
                assignee: "Jordan",
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

function isValidState(data) {
  return (
    data &&
    typeof data === "object" &&
    data.root &&
    typeof data.root === "object" &&
    data.root.id === "root" &&
    Array.isArray(data.root.children)
  );
}

function escapeAppleScript(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, '" & return & "');
}

function remindersPriority(p) {
  const n = Number(p);
  if (n <= 1) return 1;
  if (n === 2) return 5;
  if (n === 3) return 9;
  return 0;
}

function createMacReminder(payload) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(new Error("Mac Reminders is only available on macOS"));
      return;
    }
    const title = String(payload.title || "").trim();
    if (!title) {
      reject(new Error("A reminder needs a title"));
      return;
    }
    const dueMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      String(payload.due || "").trim()
    );
    if (!dueMatch) {
      reject(new Error("Pick a date for the reminder"));
      return;
    }
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(
      String(payload.time || "09:00").trim()
    );
    if (!timeMatch) {
      reject(new Error("Time must look like 09:00"));
      return;
    }
    const year = Number(dueMatch[1]);
    const month = Number(dueMatch[2]);
    const day = Number(dueMatch[3]);
    const hours = Math.min(23, Math.max(0, Number(timeMatch[1])));
    const minutes = Math.min(59, Math.max(0, Number(timeMatch[2])));
    const priority = remindersPriority(payload.priority);
    const name = escapeAppleScript(title);
    const notes = escapeAppleScript(payload.body || "");
    const script = `
tell application "Reminders"
  if not (exists list "TreeWeave") then
    make new list with properties {name:"TreeWeave"}
  end if
  set dueDate to (current date)
  set monthNames to {January, February, March, April, May, June, July, August, September, October, November, December}
  set year of dueDate to ${year}
  set month of dueDate to item ${month} of monthNames
  set day of dueDate to ${day}
  set hours of dueDate to ${hours}
  set minutes of dueDate to ${minutes}
  set seconds of dueDate to 0
  tell list "TreeWeave"
    make new reminder with properties {name:"${name}", body:"${notes}", due date:dueDate, remind me date:dueDate, priority:${priority}}
  end tell
end tell`.trim();
    execFile(
      "osascript",
      ["-e", script],
      { timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          const raw = String(stderr || err.message || "");
          if (/not authorized|not allowed|-1743/i.test(raw)) {
            reject(
              new Error(
                "macOS blocked access to Reminders. Allow TreeWeave (or Terminal/Node) under System Settings → Privacy & Security → Automation."
              )
            );
            return;
          }
          reject(new Error(raw.trim() || "Could not create reminder"));
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 10 * 1024 * 1024;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Create a TreeWeave HTTP server (used by CLI and Electron). */
function createServer(options = {}) {
  const ROOT = options.root || path.join(__dirname, "public");
  const DATA_DIR = options.dataDir || path.join(__dirname, "data");
  const DATA_FILE = path.join(DATA_DIR, "treeweave.json");
  const ARCHIVE_FILE = path.join(DATA_DIR, "treeweave-archive.json");

  function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  function emptyArchive() {
    return {
      format: "treeweave-archive",
      version: 1,
      entries: [],
    };
  }

  function readArchive() {
    ensureDataDir();
    try {
      if (fs.existsSync(ARCHIVE_FILE)) {
        const data = JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf8"));
        if (data && Array.isArray(data.entries)) {
          return {
            format: "treeweave-archive",
            version: 1,
            entries: data.entries,
          };
        }
      }
    } catch (e) {
      console.warn("Failed to read archive file:", e.message);
    }
    return emptyArchive();
  }

  function writeArchive(archive) {
    ensureDataDir();
    const tmp = ARCHIVE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(archive, null, 2), "utf8");
    fs.renameSync(tmp, ARCHIVE_FILE);
  }

  /** Append permanently-deleted recycle-bin items to the lifelong archive. */
  function appendArchiveEntries(rawEntries) {
    const list = Array.isArray(rawEntries) ? rawEntries : [];
    if (!list.length) return { ok: true, added: 0, total: readArchive().entries.length };
    const archive = readArchive();
    const stamp = new Date().toISOString();
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      archive.entries.push({
        archivedAt: stamp,
        reason: entry.reason || "permanent-delete",
        trashId: entry.id || entry.trashId || null,
        deletedAt: entry.deletedAt || null,
        projectId: entry.projectId || null,
        projectName: entry.projectName || null,
        note: entry.note || null,
      });
    }
    writeArchive(archive);
    return { ok: true, added: list.length, total: archive.entries.length };
  }

  function readState() {
    ensureDataDir();
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf8");
        const data = JSON.parse(raw);
        if (isValidState(data)) {
          if (!data.ui) data.ui = {};
          data.ui.selectedNodeId = data.ui.selectedNodeId || null;
          data.ui.openProjectId = data.ui.openProjectId || null;
          data.ui.expanded = Array.isArray(data.ui.expanded)
            ? data.ui.expanded
            : [];
          data.ui.paneView =
            data.ui.paneView === "list" ? "list" : "board";
          if (!data.ui.mainView) {
            data.ui.mainView = data.ui.globalView ? "global" : "tree";
          }
          if (!["tree", "global", "dueToday", "recycle", "eisenhower"].includes(data.ui.mainView)) {
            data.ui.mainView = "tree";
          }
          if (!Array.isArray(data.trash)) data.trash = [];
          return data;
        }
      }
    } catch (e) {
      console.warn("Failed to read data file, reseeding:", e.message);
    }
    const seeded = defaultState();
    writeState(seeded);
    return seeded;
  }

  function writeState(data) {
    ensureDataDir();
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(payload);
  }

  async function handleApi(req, res, pathname) {
    if (pathname === "/api/health" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        storage: DATA_FILE,
        archive: ARCHIVE_FILE,
        reminders: process.platform === "darwin",
      });
      return;
    }

    if (pathname === "/api/data" && req.method === "GET") {
      sendJson(res, 200, readState());
      return;
    }

    if (pathname === "/api/data" && req.method === "PUT") {
      try {
        const raw = await readBody(req);
        const data = JSON.parse(raw || "{}");
        if (!isValidState(data)) {
          sendJson(res, 400, { error: "Invalid state: missing root tree" });
          return;
        }
        if (!data.ui) data.ui = {};
        writeState(data);
        sendJson(res, 200, { ok: true });
      } catch (e) {
        sendJson(res, 400, { error: e.message || "Bad request" });
      }
      return;
    }

    if (pathname === "/api/export" && req.method === "GET") {
      const data = readState();
      const stamp = new Date().toISOString().slice(0, 10);
      const payload = JSON.stringify(
        {
          format: "treeweave",
          version: 1,
          exportedAt: new Date().toISOString(),
          data,
        },
        null,
        2
      );
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="treeweave-${stamp}.json"`,
        "Cache-Control": "no-store",
      });
      res.end(payload);
      return;
    }

    if (pathname === "/api/import" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw || "{}");
        const data =
          parsed.data && parsed.format === "treeweave" ? parsed.data : parsed;
        if (!isValidState(data)) {
          sendJson(res, 400, {
            error: "Invalid import: expected TreeWeave JSON with a root tree",
          });
          return;
        }
        if (!data.ui) {
          data.ui = {
            selectedNodeId: null,
            openProjectId: null,
            expanded: [],
          };
        }
        writeState(data);
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
        sendJson(res, 400, { error: e.message || "Bad request" });
      }
      return;
    }

    if (pathname === "/api/reset" && req.method === "POST") {
      const seeded = defaultState();
      writeState(seeded);
      sendJson(res, 200, { ok: true, data: seeded });
      return;
    }

    if (pathname === "/api/reminder" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || "{}");
        const result = await createMacReminder(payload);
        sendJson(res, 200, result);
      } catch (e) {
        const msg = e.message || "Could not create reminder";
        const status = /only available on macOS/i.test(msg) ? 501 : 400;
        sendJson(res, status, { error: msg });
      }
      return;
    }

    if (pathname === "/api/archive" && req.method === "GET") {
      sendJson(res, 200, readArchive());
      return;
    }

    if (pathname === "/api/archive" && req.method === "POST") {
      try {
        const raw = await readBody(req);
        const payload = JSON.parse(raw || "{}");
        const entries = Array.isArray(payload.entries)
          ? payload.entries
          : Array.isArray(payload)
            ? payload
            : [];
        sendJson(res, 200, appendArchiveEntries(entries));
      } catch (e) {
        sendJson(res, 400, { error: e.message || "Bad request" });
      }
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  }

  function serveStatic(req, res, pathname) {
    let rel = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url || "/",
        `http://${req.headers.host || "localhost"}`
      );
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, pathname);
        return;
      }
      serveStatic(req, res, pathname);
    } catch (e) {
      console.error(e);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server error");
    }
  });

  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    writeState(defaultState());
  }

  return {
    server,
    dataFile: DATA_FILE,
    archiveFile: ARCHIVE_FILE,
    root: ROOT,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.removeListener("error", onError);
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}

module.exports = { createServer, defaultState };

if (require.main === module) {
  const PORT = Number(process.argv[2] || process.env.PORT || 4173);
  const app = createServer();
  app
    .listen(PORT)
    .then((port) => {
      console.log(`\n  TreeWeave running at  http://localhost:${port}`);
      console.log(`  Data file: ${app.dataFile}\n`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
