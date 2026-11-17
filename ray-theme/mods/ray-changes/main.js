// VS Code's Source Control look for the focused pane's repository: the commit box and
// changed files on top, the commit graph below. A commit opens to its files; a file
// (changed or in a commit) shows its diff in a large dialog, which is this same mod
// opened with props { view: "diff", … }.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list, v_resizable, resizable_panel } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, settings, openOverlay, closeOverlay, props } from "herdr";
import { C, GIT, fileIcon } from "./look.js";
import { ringColor, ringOut, ringProbe } from "./focus-ring.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
const COMMITS = 80, DIFF_LINES = 5000;
const RAIL = "#3794FF", INPUT = "#313131", INPUT_BORDER = "#3C3C3C", BADGE = "#4D4D4D";
const ADDED = "#2EA04326", REMOVED = "#F8514926", HUNK = "#2B2B2B";
const chevron = (open) => svg(`mods/ray-files/chevron-${open ? "down" : "right"}.svg`).size(14).flex_none().text_color(C.text);

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, old: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, next: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") return { kind, old: old++, next: next++, text: untab(line.slice(1)) || " " };
    return { kind: "", text: line };
  });
}

// "M\0path\0A\0path\0" -> [{ status, path }]
function nameStatus(out) {
  const fields = out.split("\0"), files = [];
  for (let i = 0; i + 1 < fields.length; i += 2) files.push({ status: fields[i][0], path: fields[i + 1] });
  return files;
}

// A file's row, as VS Code lists it: icon, name, its folder dimmed, the status letter.
function fileRow(id, file, depth, onClick) {
  const parts = file.path.split("/"), name = parts.pop(), tint = GIT[file.status] ?? GIT.M;
  return h_flex().id(id).h(22).flex_none().pl(depth).pr(12).gap(6).items_center().cursor_pointer().hover((s) => s.bg(C.hover)).on_click(onClick)
    .child(image(fileIcon(name)).size(16).flex_none())
    .child(div().flex_shrink_1().min_w(0).truncate().text_color(tint).when(file.status === "D", (el) => el.line_through()).child(name))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(C.dim).child(parts.join("/")))
    .child(div().flex_none().w(12).text_right().text_size(11.5).text_color(tint).child(file.status));
}

// The dialog: one file's diff (a commit's, or the working tree's).
const diff = {
  init(p, cx) {
    this.p = p; this.rows = []; this.width = 0; this.note = "Loading diff…";
    this.handle = cx.focus_handle(); this.handle.focus();
    cx.spawn(async (cx) => {
      try { this.setLines(await this.load()); this.note = null; }
      catch (e) { this.note = `Cannot show this diff: ${e}`; }
      cx.notify();
    });
  },

  async load() {
    const { root, on, path, commit, parent, fresh, hasHead } = this.p;
    if (!commit && fresh) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) return ["Cannot preview this file (binary, too large, or unreadable)"];
      if (text.includes("\0")) return ["Binary file · no text diff"];
      const lines = text.replace(/\n$/, "").split("\n");
      return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)];
    }
    // A commit against its first parent (the first commit: against nothing); the working tree against HEAD.
    const args = commit ? (parent ? ["diff", ...DIFF, parent, commit] : ["show", "--format=", ...DIFF, commit])
      : ["diff", ...DIFF, ...(hasHead ? ["HEAD"] : [])];
    const r = await exec("git", [...READ, ...args, "--", path], { cwd: root, on });
    if (r.code !== 0) throw new Error(r.stderr.trim());
    const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
    return first < 0 ? [all.some((l) => l.startsWith("Binary files")) ? "Binary file changed · no text diff" : "No text diff available"] : all.slice(first);
  },

  setLines(lines) {
    this.more = Math.max(0, lines.length - DIFF_LINES);
    this.rows = diffRows(lines.slice(0, DIFF_LINES).map((line) => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
    this.add = this.rows.filter((r) => r.kind === "+").length; this.del = this.rows.filter((r) => r.kind === "-").length;
    this.width = Math.max(300, ...this.rows.map((row) => (row.text.length + 1) * 7.3 + 110));
  },

  row({ kind, old, next, text }) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(HUNK).text_color(C.dim).child(text);
    const number = (n) => div().w(44).flex_none().text_right().text_color("#6E7681").child(n === undefined ? "" : String(n));
    return h_flex().w_full().h(20).flex_none().when(kind === "+", (e) => e.bg(ADDED)).when(kind === "-", (e) => e.bg(REMOVED))
      .child(number(old)).child(number(next))
      .child(div().w(22).flex_none().text_center().text_color(kind === "+" ? GIT.U : kind === "-" ? GIT.D : C.dim).child(kind === "+" || kind === "-" ? kind : ""))
      .child(div().flex_1().min_w(0).truncate().child(text));
  },

  render() {
    const { path, commit, title, status, overlay } = this.p, parts = path.split("/"), name = parts.pop();
    const close = () => closeOverlay(overlay);
    return v_flex().id("ray-changes-diff").size_full().min_h(0).overflow_hidden().bg(C.editor).text_color(C.text).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); close(); } })
      .child(h_flex().h(40).flex_none().pl(14).pr(8).gap(8).items_center().bg(C.side).border_b(1).border_color(C.border)
        .child(image(fileIcon(name)).size(16).flex_none())
        .child(div().flex_none().text_color(C.bright).child(name))
        .child(div().flex_shrink_1().min_w(0).truncate().text_size(12).text_color(C.dim).child(parts.join("/")))
        .when(Boolean(status), (el) => el.child(div().flex_none().text_size(12).text_color(GIT[status] ?? GIT.M).child(status)))
        .when(this.add > 0, (el) => el.child(div().flex_none().text_size(12).text_color(GIT.U).child(`+${this.add}`)))
        .when(this.del > 0, (el) => el.child(div().flex_none().text_size(12).text_color(GIT.D).child(`−${this.del}`)))
        .child(div().flex_1())
        .child(div().flex_shrink_1().min_w(0).max_w(520).truncate().text_size(12).text_color(C.dim).child(commit ? `${commit.slice(0, 7)} · ${title ?? ""}` : "Working Tree"))
        .child(div().id("diff-close").size(24).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer().text_color(C.text)
          .hover((s) => s.bg("#5A5D5E50")).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(close).child("✕")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(12)
        .child(div().id("diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.width).h_full().child(v_virtual_list("diff-rows", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.row(row))).size_full())))
        .child(Scrollbar.vertical("diff-rows").viewport_from_layout().absolute().inset_0())
        .when(Boolean(this.note), (e) => e.child(div().absolute().top(10).px(14).text_color(C.dim).child(this.note))))
      .when(this.more > 0, (el) => el.child(div().flex_none().px(14).py(4).text_size(11).text_color(C.dim).border_t(1).border_color(C.border).child(`Showing the first ${DIFF_LINES} lines (${this.more} more)`)));
  },
};

// The side panel.
const panel = {
  init(_props, cx) {
    this.files = []; this.commits = []; this.message = ""; this.handle = cx.focus_handle();
    this.fold = { changes: false, list: false, graph: false };
    // Opened commits per repository, and each commit's files (a commit never changes).
    this.opened = new Map(); this.commitFiles = new Map();
    this.input = InputState.new({ placeholder: "Message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  },

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  },

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.commits = []; this.branch = "";
      this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.commits = []; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const entries = status.stdout.split("\0").filter(Boolean);
        const files = entries.slice(0, 1000).map((entry) => {
          const xy = entry.slice(0, 2), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          return { path: entry.slice(3), fresh, status: fresh ? "U" : conflict ? "!" : xy.includes("A") ? "A" : xy.includes("D") ? "D" : "M" };
        });
        const branch = await git(["branch", "--show-current"]);
        // Fields end with \x1f, commits with \x1e. No commits yet: log fails, the graph is empty.
        const log = await git(["log", "-n", String(COMMITS), "--format=%H%x1f%s%x1f%an%x1f%D%x1f%P%x1e"]);
        const commits = log.code !== 0 ? [] : log.stdout.split("\x1e").map((c) => c.replace(/^\n/, "").split("\x1f")).filter((c) => c.length >= 5)
          .map(([hash, subject, author, refs, parents]) => ({ hash, subject, author, refs: refs ? refs.split(", ") : [], parent: parents.split(" ")[0] || null }));
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = log.code === 0; this.files = files; this.limited = entries.length > 1000;
        this.commits = commits; this.branch = branch.code === 0 ? branch.stdout.trim() : ""; this.error = null;
        this.watch(root, cx);
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  },

  openedHere() {
    if (!this.opened.has(this.root)) this.opened.set(this.root, new Set());
    return this.opened.get(this.root);
  },

  toggleCommit(commit, cx) {
    const opened = this.openedHere();
    if (opened.has(commit.hash)) opened.delete(commit.hash);
    else {
      opened.add(commit.hash);
      if (!this.commitFiles.has(commit.hash)) {
        const root = this.root, on = this.on;
        // Against the first parent, so a merge lists what it brought in; the first commit lists everything.
        const args = commit.parent ? ["diff", "--name-status", "-z", "--no-renames", commit.parent, commit.hash]
          : ["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "--no-renames", commit.hash];
        cx.spawn(async (cx) => {
          try {
            const r = await exec("git", [...READ, ...args], { cwd: root, on });
            this.commitFiles.set(commit.hash, r.code === 0 ? nameStatus(r.stdout).slice(0, 500) : { error: r.stderr.trim() });
          } catch (e) { this.commitFiles.set(commit.hash, { error: String(e) }); }
          cx.notify();
        });
      }
    }
    cx.notify();
  },

  // A file's diff, in a dialog the size of the agent dashboard. `commit`: null for the working tree.
  showDiff(file, commit) {
    openOverlay({ mod: "ray-changes", kind: "dialog", width: 0.86, height: 0.86, props: { view: "diff", root: this.root, on: this.on, path: file.path, status: file.status,
      fresh: Boolean(file.fresh), hasHead: this.hasHead, commit: commit?.hash ?? null, parent: commit?.parent ?? null, title: commit?.subject ?? null } });
  },

  commit(cx) {
    if (!this.message.trim() || !this.root || this.busy || this.loading || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context, message = this.message.trim();
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of [["add", "-A"], ["commit", "-m", message]]) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.message = ""; this.input.set_value(""); }
      } catch (e) { if (key() === context) this.note = `Commit failed: ${e}`; }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  },

  // A section's title bar: click to fold.
  section(id, title, right) {
    return h_flex().id(`section-${id}`).h(22).flex_none().pl(4).pr(12).gap(4).items_center().cursor_pointer().border_t(1).border_color(C.border)
      .on_click((_e, cx) => { this.fold[id] = !this.fold[id]; cx.notify(); })
      .child(chevron(!this.fold[id])).child(div().flex_1().min_w(0).truncate().text_size(11).font_bold().child(title))
      .when(Boolean(right), (el) => el.child(right));
  },

  // The graph's left edge: the line, and a commit's dot (a ring for HEAD).
  rail(dot, head) {
    return div().w(18).h_full().flex_none().relative()
      .child(div().absolute().left(8).top(0).bottom(0).w(2).bg(RAIL))
      .when(dot, (el) => el.child(div().absolute().left(4).top(6).size(10).rounded(5).bg(head ? C.side : RAIL).when(head, (d) => d.border(2).border_color(RAIL))));
  },

  graphRows() {
    const opened = this.openedHere(), out = [];
    for (const commit of this.commits) {
      const open = opened.has(commit.hash), head = commit.refs.some((r) => r.startsWith("HEAD"));
      const refs = commit.refs.map((r) => r.replace(/^HEAD -> /, "").replace(/^tag: /, "")).filter((r) => r !== "HEAD").slice(0, 2);
      out.push(h_flex().id(`commit-${commit.hash}`).h(22).flex_none().pl(4).pr(10).gap(5).items_center().cursor_pointer()
        .when(open, (el) => el.bg(C.selected)).hover((s) => s.bg(open ? C.selected : C.hover)).on_click((_e, cx) => this.toggleCommit(commit, cx))
        .child(this.rail(true, head))
        .child(div().flex_shrink_1().min_w(0).truncate().when(head, (el) => el.font_bold()).child(commit.subject))
        .child(div().flex_1().min_w(30).truncate().text_size(11.5).text_color(C.dim).child(commit.author))
        .children(refs.map((r, i) => div().flex_none().max_w(110).truncate().px(6).h(16).flex().items_center().rounded(8).text_size(11)
          .bg(i === 0 && head ? RAIL : BADGE).text_color(i === 0 && head ? "#111111" : C.text).child(r))));
      if (!open) continue;
      const files = this.commitFiles.get(commit.hash);
      const note = (text) => h_flex().h(22).flex_none().pl(4).child(this.rail(false)).child(div().pl(8).text_size(12).text_color(C.dim).child(text));
      if (!files) out.push(note("Loading files…"));
      else if (files.error) out.push(note(`Cannot list this commit's files: ${files.error}`));
      else if (!files.length) out.push(note("No changed files"));
      else for (const file of files) out.push(h_flex().h(22).flex_none().pl(4)
        .child(this.rail(false))
        .child(fileRow(`commit-file-${commit.hash}-${file.path}`, file, 8, () => this.showDiff(file, commit)).flex_1().min_w(0)));
    }
    return out;
  },

  // A list that scrolls inside the room its section gets (overflow_y_scrollbar() alone
  // wraps the list, and its flex sizing never reaches the panel's layout).
  list(id, rows, min, max) {
    return div().flex_1().min_h(min).when(max !== undefined, (el) => el.max_h(max)).relative()
      .child(v_flex().id(id).absolute().inset_0().overflow_y_scroll().children(rows))
      .child(Scrollbar.vertical(id).absolute().inset_0());
  },

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const enabled = Boolean(this.message.trim() && this.root && !this.busy && !this.loading);
    const note = (text) => div().px(20).py(6).text_size(12).text_color(C.dim).child(text);
    const count = div().flex_none().px(6).h(16).min_w(16).flex().items_center().justify_center().rounded(8).bg(BADGE).text_size(11).text_color(C.bright).child(String(this.files.length));
    const empty = this.error || (this.loading && !this.root ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder");
    const both = !this.fold.changes && !this.fold.graph;
    const changes = [this.section("changes", "CHANGES"), ...(this.fold.changes ? [] : [
      v_flex().flex_none().px(12).pt(4).pb(8).gap(6)
        .child(div().id("commit-message").h(28).px(8).flex().items_center().rounded(4).bg(INPUT).border_1().border_color(this.typing ? C.accent : INPUT_BORDER).cursor_text()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(13).text_color(C.text)))
        .child(div().id("commit").h(28).flex().items_center().justify_center().rounded(4).bg(enabled ? C.accent : "#0078D466").text_color(enabled ? C.bright : "#FFFFFF80")
          .when(enabled, (e) => e.cursor_pointer().hover((s) => s.bg("#026EC1"))).on_click((_e, cx) => this.commit(cx))
          .child(this.busy ? "Committing…" : this.branch ? `✓ Commit on "${this.branch}"` : "✓ Commit"))
        .when(Boolean(this.note), (e) => e.child(div().text_size(11.5).text_color(GIT.D).child(this.note))),
      h_flex().id("section-list").h(22).flex_none().pl(12).pr(12).gap(4).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.fold.list = !this.fold.list; cx.notify(); })
        .child(chevron(!this.fold.list)).child(div().flex_1().child("Changes")).child(count),
      ...(this.fold.list ? [] : [this.list("changes-list", this.files.length
        ? this.files.map((f) => fileRow(`change-${f.path}`, f, 30, () => this.showDiff(f, null)))
        : [note(empty)], 30, both ? undefined : Math.max(1, this.files.length) * 22 + 8)]),
      ...(this.limited ? [note("Showing the first 1,000 changed files")] : []),
    ])];
    // The graph folded: the room under it stays empty.
    const graph = [this.section("graph", "GRAPH", this.branch ? div().flex_none().text_size(11).text_color(C.dim).child(this.branch) : null),
      this.fold.graph ? div().flex_1() : this.list("changes-graph", this.commits.length ? this.graphRows() : [note(this.root ? "No commits yet" : empty)], 80)];
    const header = h_flex().h(35).flex_none().pl(20).pr(12).items_center().text_size(11).text_color(C.text).child("SOURCE CONTROL");
    return v_flex().id("ray-changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(C.side).border_1().border_color(ringColor(this, C.border)).on_mouse_down_out(ringOut(this)).child(ringProbe(this)).text_color(C.text).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(header)
      .child(both
        // Both open: the boundary between them drags.
        ? v_resizable("changes-split").flex_1().min_h(0)
          .child(resizable_panel().size(Math.min(360, 160 + Math.max(1, this.files.length) * 22)).size_range(110, 2000).child(v_flex().size_full().min_h(0).overflow_hidden().children(changes)))
          .child(resizable_panel().child(v_flex().size_full().min_h(0).overflow_hidden().children(graph)))
        : v_flex().flex_1().min_h(0).children([...changes, ...graph]));
  },
};

// One mod, two shapes: the side panel, and (props.view "diff") the dialog showing one file's diff.
export default class Changes extends View {
  init(given, cx) {
    const p = props() ?? given ?? {};
    Object.assign(this, p.view === "diff" ? diff : panel);
    this.init(p, cx);
  }
}
