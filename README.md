# TreeWeave

A vibe-coded visual personal project-management tool. Run it in a browser via a local server, or as a **standalone Mac app**. The application has **not** been tested for performance and security yet.

**End-user documentation:** see [USER_GUIDE.md](./USER_GUIDE.md) for how to use the tree, notes, lists, recycle bin, and more.

## Concept

- **Hierarchical dendrogram.** Each branch is a solid line whose thickness equals the number of projects in that subtree. Each branch splits into nodes that are projects. Click a branch to expand children beneath it.
- **Project pane** (right column) with colourable post-it notes, due dates / urgency, assignees, and To-Do / Doing / Done buckets.
- **Board / List toggle** in the project pane.
- **JSON import / export** for backups and transfers.

---

## Standalone Mac app (recommended)

### Build the `.app`

```bash
cd treeweave
npm install
npm run dist
```

Output lands in `dist/`:

- `TreeWeave-x.x.x.dmg` — drag to Applications
- `TreeWeave-x.x.x-mac.zip` — portable zip

For a quick unpacked build (faster, no dmg):

```bash
npm run dist:dir
open dist/mac/TreeWeave.app
```

### Run in development (Electron, no build)

```bash
npm install
npm run app
```

### Where Mac app data lives

| What | Where |
|------|--------|
| Tree, projects, notes | `~/Library/Application Support/TreeWeave/data/treeweave.json` |
| Lifelong delete archive | `~/Library/Application Support/TreeWeave/data/treeweave-archive.json` |
| Theme preference | app localStorage |

Use **Help → Open Data Folder** inside the app to reveal the data directory.

---

## Browser + local server

```bash
cd treeweave
node server.js          # or: npm start
```

Open http://localhost:4173

Custom port: `node server.js 8080`

Data files when running via CLI (in the project folder):

| What | Where |
|------|--------|
| Tree, projects, notes | `data/treeweave.json` |
| Lifelong delete archive | `data/treeweave-archive.json` |

Items permanently removed from the recycle bin (or expired after 7 days) are appended to the archive. There is no GUI for it.

---

## Project layout

```
treeweave/
├── server.js              HTTP server + JSON API
├── electron/main.js       Electron shell (Mac .app)
├── public/                Web UI (HTML, CSS, JS)
│   ├── index.html
│   ├── styles.css
│   └── js/
│       ├── main.js        App shell, views, import/export
│       ├── state.js       Data model and persistence
│       ├── hierarchy.js   Tree dendrogram
│       ├── pane.js        Project pane (board + list)
│       ├── globalView.js  Global View / Due Today
│       ├── eisenhowerView.js  Eisenhower Matrix
│       ├── recycleView.js Recycle bin
│       └── promptDialog.js  In-app dialogs (Mac-safe)
├── data/                  CLI-mode user data (created on first run)
├── samples/               Sample import JSON
├── dist/                  Built Mac app (after npm run dist)
├── README.md              This file
├── USER_GUIDE.md          End-user documentation
└── PROMPTS.md 			   A (hopefullly complete) list of prompts used in the development
```

---

## API (server mode)

- `GET  /api/data` — load current state
- `PUT  /api/data` — save state
- `GET  /api/export` — download a JSON export
- `POST /api/import` — replace state from JSON body
- `POST /api/reset` — restore demo data
- `GET  /api/archive` — lifelong archive of permanently deleted recycle-bin items
- `POST /api/archive` — append entries `{ entries: [...] }`
- `GET  /api/health` — server status (`reminders: true` on macOS)
- `POST /api/reminder` — create an item in the macOS Reminders app

Use **Export** / **Import** in the header to download or restore a JSON backup.

---

## File layout

```
server.js              HTTP server + JSON API (shared by CLI and Mac app)
public/                UI (HTML, CSS, JS)
data/treeweave.json    CLI-mode user data (created on first run)
```
