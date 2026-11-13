// VS Code's explorer look (Dark Modern colors, Material Icon Theme icons: look.js) on
// a lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, settings, window } from "herdr";
import { markdownSource, parseMarkdown } from "./mdview.js";
import { C, GIT, SYNTAX, fileIcon, folderIcon } from "./look.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PICTURE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "tif", "avif", "svg"]);
const MARKDOWN = new Set(["md", "mdx", "markdown"]);
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.last = null; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            const mark = xy === "??" ? "U" : xy.includes("U") || xy === "AA" || xy === "DD" ? "!" : xy.includes("A") ? "A" : xy.includes("D") ? "D" : "M";
            const file = `${top.stdout.trim()}/${entry.slice(3)}`;
            marks[file] = mark;
            // Folders holding a change are tinted, as in VS Code.
            for (let cut = file.lastIndexOf("/"); cut > top.stdout.trim().length; cut = file.lastIndexOf("/", cut - 1)) marks[file.slice(0, cut)] ??= "in";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.markdown = null; this.picture = null; if (path) this.last = path; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    // A picture is shown as a picture. The app only draws images from its own
    // folder, so the file is copied into data/ray-files/ (one at a time).
    const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
    if (PICTURE.has(ext)) {
      if (on) { this.fileError = "Pictures on another machine can't be shown here"; return; }
      const copy = `data/ray-files/preview-${Date.now()}.${ext}`;
      cx.spawn(async cx => {
        try {
          const r = await exec("sh", ["-c", 'd="$HOME/.config/herdr-app"; mkdir -p "$d/data/ray-files" && rm -f "$d"/data/ray-files/preview-* && cp "$1" "$d/$2"', "files", `${root}/${path}`, copy]);
          if (this.file !== path || !this.current(context)) return;
          if (r.code === 0) this.picture = copy; else this.fileError = "Cannot show this picture";
        } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot show this picture"; }
        finally { cx.notify(); }
      });
      return;
    }
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        // The editor has no colors for Markdown: mdview.js draws it.
        if (MARKDOWN.has(ext)) { this.markdown = parseMarkdown(text.slice(0, 400000)); return; }
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: SYNTAX });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      const tint = mark ? GIT[mark] ?? GIT.M : null;
      out.push(h_flex().id(`file-${path}`).h(22).flex_none().pl(4 + depth * 10).pr(12).gap(5).items_center().cursor_pointer()
        .when(path === this.last, el => el.bg(C.selected)).hover(s => s.bg(path === this.last ? C.selected : C.hover))
        .on_click((_e, cx) => { if (entry.dir) this.toggle(path, cx); else { this.show(path, cx); cx.notify(); } })
        .child(entry.dir ? svg(`mods/ray-files/chevron-${open ? "down" : "right"}.svg`).size(14).flex_none().text_color(C.text) : div().w(14).flex_none())
        .child(image(entry.dir ? folderIcon(entry.name, open) : fileIcon(entry.name)).size(16).flex_none())
        .child(div().flex_1().min_w(0).truncate().when(Boolean(tint), el => el.text_color(tint)).child(entry.name))
        .when(Boolean(mark), el => el.child(div().flex_none().text_size(11.5).text_color(tint).child(mark === "in" ? "•" : mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out);
    }
    return out;
  }

  // The open file as VS Code's tab (close: back to the tree) over its path.
  tab() {
    const parts = this.file.split("/"), name = parts.at(-1);
    return v_flex().flex_none()
      .child(h_flex().h(35).bg(C.side).border_b(1).border_color(C.border)
        .child(h_flex().h_full().max_w_full().min_w(0).pl(10).pr(6).gap(6).items_center().bg(C.editor).border_t(1).border_color(C.accent)
          .child(image(fileIcon(name)).size(16).flex_none())
          .child(div().flex_shrink_1().min_w(0).truncate().text_color(C.bright).child(name))
          .child(div().id("files-back").size(20).flex_none().flex().items_center().justify_center().rounded(4).cursor_pointer().text_size(12).text_color(C.text)
            .hover(s => s.bg("#5A5D5E50")).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("✕"))))
      .when(parts.length > 1, el => el.child(div().h(22).px(12).flex().items_center().bg(C.editor).text_size(12).text_color(C.dim)
        .child(div().min_w(0).truncate().child(parts.join(" › ")))));
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const note = (text) => div().px(20).py(8).text_size(12).text_color(C.dim).child(text);
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(C.side).border_1().border_color(C.border).text_color(C.text).text_size(13)
      .when(!this.file, el => el
        .child(h_flex().h(35).flex_none().pl(20).pr(12).items_center().text_size(11).text_color(C.text).child("EXPLORER"))
        .child(h_flex().h(22).flex_none().pl(4).pr(12).gap(5).items_center().border_t(1).border_color(C.border)
          .child(svg("mods/ray-files/chevron-down.svg").size(14).flex_none().text_color(C.text))
          .child(div().flex_1().min_w(0).truncate().text_size(11).font_bold().child((this.root?.split(/[\\/]/).pop() ?? "").toUpperCase())))
        .child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().children(this.rows("", 0, []))
          .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(note(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
          .when(this.limited, el => el.child(note("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.tab())
        .child(this.picture ? div().flex_1().min_h(0).min_w(0).p(16).flex().items_center().justify_center().bg(C.editor).overflow_hidden().child(image(this.picture).max_w_full().max_h_full())
          : this.markdown ? markdownSource(this.markdown, settings().font_family, 12)
          : this.code ? div().flex_1().min_h(0).bg(C.editor).child(Editor.new(this.code).size_full()) : div().flex_1().bg(C.editor).p(12).text_color(C.dim).child(this.fileError || "Loading file…")));
  }
}
