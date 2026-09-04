# TreeWeave User Guide

TreeWeave is a completely vibe-coded visual personal project-management tool. Your time is organised as a **tree of nodes** on the left. Each node could be a project or an area of work. Each leaf-level node is a project. Opening a leaf-level node/project shows its **post-it notes** in a pane on the right. Post-it notes are where work that needs to be done for a project is documented.

You can run TreeWeave in a browser (`npm start` → http://localhost:4173) or as a standalone Mac app. Your data is saved automatically on the local server (or in the Mac app’s data folder).

---

## Table of contents

1. [Getting started](#1-getting-started)
2. [The tree](#2-the-tree)
3. [Projects and the right pane](#3-projects-and-the-right-pane)
4. [Post-it notes](#4-post-it-notes)
5. [Board view](#5-board-view)
6. [List views](#6-list-views)
7. [Global View, Due Today, and Matrix](#7-global-view-due-today-and-matrix)
8. [Eisenhower Matrix](#8-eisenhower-matrix)
9. [Recycle bin](#9-recycle-bin)
10. [Themes](#10-themes)
11. [Import and export](#11-import-and-export)
12. [Keyboard shortcuts](#12-keyboard-shortcuts)
13. [Tips](#13-tips)
14. [Mac app notes](#14-mac-app-notes)

---

## 1. Getting started

### Browser

```bash
npm start
```

Open **http://localhost:4173** in your browser.

### Mac app

```bash
npm run app          # development
# or after building:
npm run dist
```

Data is stored locally and updates as you work. The header shows a **Server** status when the app can reach storage.

---

## 2. The tree
![tree](/screenshots/dendogram.png)

The left panel is a **dendrogram**: branches thicken toward the root based on how many projects they contain.

| Action | How |
|--------|-----|
| Expand / collapse a branch | Click the branch **circle** |
| Select a node | Click the circle or the name |
| Open a project | Double-click the project (leaf) circle or name |
| Rename | Double-click the **name** |
| Reorder | **Drag the name text** (not the circle) |
| Nest under another branch | Drag a name onto another branch’s **circle** |
| Expand / collapse everything | Use **Expand all** / **Collapse all** in the panel header |

### Building the hierarchy

With a node selected, use the toolbar:

- **+ Node** — add a project (leaf) under the selection  
- **+ Level** — add a branch (group) under the selection  
- **+ Area** (top bar) — add a new top-level area  
- **Rename** / **Delete** — rename or remove the selection  

Line **thickness** reflects how many projects sit under that branch. Numbers on leaf circles and “N notes” labels count **active** notes only (Done items are excluded).

### Overdue projects

Leaves with overdue active notes are highlighted (red ring / label) so risk is visible without opening the project.

---

## 3. Projects and the right pane
![projects](/screenshots/rightpane.png)

Double-click a leaf project to open the **project pane** on the right.

- **Board** — freeform post-its and To-Do / Doing / Done buckets  
- **List** — sortable table of the same notes  
- **+ Post-it** / **+ Task** — add a note  
- **Close** — close the pane (`Esc` also works, after dismissing any popped-up note)

---

## 4. Post-it notes

Each note can have:

| Field | Description |
|-------|-------------|
| **Heading** | First line of the note; shown in list views |
| **Body** | Text after the first line break; stays on the post-it |
| **Colour** | Swatches on the note |
| **Assignee** | Who owns the work |
| **Due date** | Calendar date |
| **Urgency window** | Days before due when the note starts glowing |
| **Priority** | **P1–P5** (bottom-right of the post-it). New notes default to **P5**. Lower number = higher priority |
| **Mac Reminder** | Bell button adds the note to the macOS **Reminders** app |

### Mac Reminders

On macOS, each note has a **🔔** button (board and list). Click it to choose a date and time, then **Add to Reminders**.

- Reminders are created in a list named **TreeWeave**
- The title is the note heading; the body includes project name, assignee, and details
- Priority maps roughly as P1 high, P2 medium, P3 low, P4–P5 none
- The first time, macOS may ask you to allow TreeWeave (or Terminal/Node) to control Reminders — allow it under **System Settings → Privacy & Security → Automation**

### Writing on a note

1. **Double-click** a post-it to enlarge it (pop-up) for editing.   
2. Dismiss with **Esc** or by clicking the dimmed backdrop.

### Bullet lists (in the popped-up note)

- Use the **•** button on the left of the enlarged note to start a list.  
- While a list is active, the icon uses the accent colour.  
- **Enter** continues the next bullet.  
- **Enter** on an empty bullet exits the list.  
- Toggle the icon again to stop list mode and return to normal paragraphs.

### Moving and organising

- Drag the **grip** (top of the post-it) to move it on the board.  
- Drag the **connector** under the note onto a bucket (To-Do / Doing / Done).  
- Done items collapse into thin stacked bars in the Done bucket; restore with **↩**.

### Deleting

Click **✕** on a note. It goes to the **recycle bin** (not permanent delete). See [Recycle bin](#8-recycle-bin).

---

## 5. Board view

The board is a dotted canvas with floating post-its and three buckets at the bottom:

1. **To-Do**  
2. **Doing**  
3. **Done**

Connect a note to a bucket by dragging from the small circle under the note onto the bucket. Urgency styling (soon / urgent / overdue) appears based on due date and the urgency window.

Click empty canvas space to create a new post-it at that spot (or use **+ Post-it**).

---

## 6. List views

### Project list (right pane → List)

Columns include **Task** (heading only), **Priority**, **Assigned to**, **Date**, and **Status**.  

- Click column headers to **sort** (including Priority).  
- Edit cells inline. Changing the task field updates the **heading** only; the body on the post-it is preserved.  
- Priority shows as **P** plus an editable number **1–5**.

### What lists show

Lists always show the **first line** of a note as the task title. Detail lines after a line break are not shown in Global View, Due Today, project List, or the recycle bin table.

---

## 7. Global View, Due Today, and Matrix

Header buttons:

| Button | What it shows |
|--------|----------------|
| **Global View** | All notes across every project |
| **Due Today** | Notes whose due date is today |
| **Matrix** | Eisenhower Matrix — priority vs time urgency (see below) |

Both use a sortable table: Task, Node, Priority, Due date, Status, Assigned to.  

- Click a **node name** (or double-click a row) to open that project.  
- Click the active button again to return to the tree.  
- Done items sort toward the bottom by default in Global View.

---

## 8. Eisenhower Matrix
![matrix](/screenshots/matrix.png)

Click **Matrix** in the header to open the Eisenhower view. Every **active** (non-done) task appears as a coloured dot.

### Axes and quadrants

```
Priority ↑
    P1 ─────────────────────────
         │ Schedule    │ Do first │
         │             │  (red)   │
    ─────┼─────────────┼──────────┼──→ Time urgency
         │ Eliminate   │ Delegate │
    P5   │  (green)    │          │
         No date                  Due today
```

- **Y-axis (priority):** P1 at the top; P5 in the bottom quarter.
- **X-axis (time):** No due date on the left; due today on the right; overdue near the right edge.
- **Quadrants** are tinted to show urgency × importance. The top-right (do first) has a red tint; the bottom-left (eliminate) has a green tint.

Dot colour matches the post-it colour. When several tasks share the same position, they form a **tight cluster** so each dot stays clickable. Cluster layout is randomised each time you start the app.

### Interactions

| Action | Result |
|--------|--------|
| **Click** a dot | Opens the project pane and pops that post-it |
| **Drag up or down** | Moves the dot vertically; release after dragging far enough to change priority band |
| **Confirm Yes** | Saves the new priority (P1–P5) |
| **Confirm No** | Dot returns to its original position |

You need to drag vertically by roughly one-third of a priority band before the confirmation appears. Horizontal position (time urgency) is not changed by dragging — only priority.

Click **Matrix** again to return to the tree.

---

## 9. Recycle bin

Deleted notes are kept for **7 days**.

1. Click **🗑** in the header (a badge shows how many items are in the bin).  
2. Review Task, Priority, original node, deleted time, and days left.  
3. **Restore** — put the note back on its original project and open that project.  
4. **Delete** — remove one item forever.  
5. **Empty bin** — clear everything permanently.

If the original project node no longer exists, Restore is disabled for that item.

Permanently deleted items (manual delete, empty bin, or after 7 days) are appended to a lifelong archive file on disk. There is no in-app UI for this archive; open the JSON file if you need a historical record. See the README for file locations.

---

## 10. Themes

Use the theme picker in the header:

| Theme | Look |
|-------|------|
| **Dark** | Default dark UI |
| **Light** | Bright, high-contrast tree text |
| **Material** | Material Design–inspired colours and Roboto |
| **Cyberpunk** | Neon magenta / cyan on near-black |
| **Metallic** | Brushed gunmetal and chrome |
| **Windows 98** | Teal desktop, gray 3D chrome, navy title bars |

Your choice is remembered in the browser / app.

---

## 11. Import and export

| Action | Purpose |
|--------|---------|
| **Export** | Download a JSON backup of the whole tree and notes |
| **Import** | Replace current data from a JSON file (confirmation required) |

Use Export regularly if you want offline backups or to move data between machines.

---

## 12. Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Esc** | Close a popped-up post-it first; otherwise close the project pane |

---

## 13. Tips

- Put a short **title on the first line** of every note; use following lines for details and bullets.  
- Use **P1–P2** for critical work and leave routine items at **P5**.  
- Drag **names** to reorder the tree; use the **circle** when you only want to expand or select.  
- Check **Due Today** at the start of the day; use **Global View** when you need a cross-project sweep.  
- Overdue highlighting on the tree means at least one active (non-done) note is past its due date.  
- Deleted by mistake? Open the recycle bin within seven days and **Restore**.

---

## 14. Mac app notes

- **Single instance** — launching again focuses the existing window.
- **Help → Open Data Folder** — opens the folder containing `treeweave.json`.
- **Edit menu** — standard Cut, Copy, Paste, Undo, Redo in text fields.
- **View menu** — Reload, zoom, full screen.
- Tree **rename** and **add node** dialogs use in-app prompts (not system `prompt()`), so they work reliably in the Mac app.

Data path: `~/Library/Application Support/TreeWeave/data/`

---

## Concepts at a glance

```
Me (root)
└── Area / Level (branch)
    └── Project (leaf)  ← double-click to open
            ├── Post-it notes (board or list)
            ├── Priority P1–P5
            └── Buckets: To-Do · Doing · Done
```

**Tree** = structure of your commitments.  
**Project pane** = day-to-day tasks.  
**Global / Due Today** = cross-cutting lists.  
**Recycle bin** = safety net for deletes.

---

