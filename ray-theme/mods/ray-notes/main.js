// A notepad per space, for the ray-theme side panel. Each space's note is a
// Markdown file in ~/.config/herdr-app/ray-notes/, named after the space's
// folder, so it outlives restarts and renames and can be opened elsewhere.
// Typing saves after a second's pause; switching spaces saves first.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, theme, settings, appHome, readTextFile, writeTextFile, props, closeOverlay } from "herdr";
import * as fs from "fs/promises";
import { tr } from "./i18n/i18n.js";

const SAVE_MS = 1000;
const RELOAD_MS = 3000;
const folder = () => `${appHome()}/ray-notes`;

// "/Users/me/dev/app" -> "Users_me_dev_app.md"; a space on another machine is
// prefixed with it; a space without a folder falls back to its id.
function fileFor(space) {
  const where = (space.folder || space.id).replace(/^\/+/, "");
  const name = `${space.machine ? `${space.machine}_` : ""}${where}`.replace(/[\/\\:*?"<>|]+/g, "_");
  return `${folder()}/${name || "home"}.md`;
}

export default class Notes extends View {
  init(_props, cx) {
    this.file = null;     // the shown space's note
    this.disk = null;     // what that file holds as far as we know (null: no file yet)
    this.loading = false;
    this.dirty = false;
    this.error = null;
    const t = theme();
    this.editor = EditorState.new({
      language: "markdown",
      value: "",
      line_numbers: false,
      folding: false,
      soft_wrap: true,
      font_family: settings().font_family,
      font_size: 13,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, punctuation: t.dim },
    });
    this.editor.on("change", (_e, cx) => {
      if (this.loading) return;
      this.dirty = true;
      cx.notify();
    });
    cx.timer.every(SAVE_MS, (cx) => {
      if (this.dirty) cx.spawn(async (cx) => { await this.save(); cx.notify(); });
    });
    // The panel and the window can both be open on the same note: one that
    // isn't being typed in picks up what the other saved.
    cx.timer.every(RELOAD_MS, (cx) => {
      if (this.dirty || this.loading || this.pending !== undefined || !this.file) return;
      cx.spawn(async (cx) => { if (await this.reload()) cx.notify(); });
    });
  }

  // Shows the file again if it changed on disk and nothing is typed here. -> changed
  async reload() {
    const file = this.file;
    const disk = await readTextFile(file).catch(() => null);
    if (file !== this.file || this.dirty || disk === this.disk || this.editor.value() !== (this.disk ?? "")) return false;
    this.loading = true;
    this.disk = disk;
    this.editor.set_value(disk ?? "");
    this.loading = false;
    return true;
  }

  async save() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const text = this.editor.value();
    if (text === (this.disk ?? "")) return;
    try {
      await fs.mkdir(folder(), { recursive: true });
      try {
        await writeTextFile(this.file, text, this.disk);
      } catch {
        // Changed outside since we read it: what's typed here wins.
        await writeTextFile(this.file, text, await readTextFile(this.file));
      }
      this.disk = text;
      this.error = null;
    } catch (error) {
      this.dirty = true;
      this.error = String(error);
    }
  }

  // Called from render when the shown space differs from the loaded note.
  // Renders come often: `pending` keeps one switch in flight per space.
  switchTo(space, cx) {
    const file = space ? fileFor(space) : null;
    if (file === this.file || file === this.pending) return;
    this.pending = file;
    cx.spawn(async (cx) => {
      await this.save();
      const disk = file ? await readTextFile(file).catch(() => null) : null;
      if (this.pending !== file) return; // another switch started meanwhile
      this.loading = true;
      this.file = file;
      this.disk = disk;
      this.editor.set_value(disk ?? "");
      this.loading = false;
      this.dirty = false;
      this.pending = undefined;
      cx.notify();
    });
  }

  async close() {
    await this.save();
  }

  render(cx) {
    const t = theme();
    const space = spaces().find((s) => s.active);
    if ((space ? fileFor(space) : null) !== this.file) this.switchTo(space, cx);
    const state = this.error ? tr("Not saved") : this.dirty ? tr("Editing…") : "";
    return v_flex()
      .id("ray-notes")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(tr("Notes")))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(space?.name ?? ""))
        .child(div().flex_none().text_size(12).text_color(this.error ? t.blocked : t.dim).when(Boolean(this.error), (el) => el.id("note-error").tooltip(this.error)).child(state))
        // Opened on its own (mod.open), it is a window and gets a ✕.
        .when(Boolean(props()?.overlay), (el) => el.child(div().id("close").flex_none().size(24).flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(tr("Close"))
          .on_click(() => closeOverlay(props().overlay))
          .child("✕"))))
      .when(Boolean(space) && !this.dirty && !this.editor.value(), (el) => el.child(
        div().flex_none().px(14).pt(10).text_size(12.5).text_color(t.dim).child(tr("Click below and write anything for this space. It's saved as Markdown."))))
      .child(space
        ? div().flex_1().min_h(0).px(6).py(4).child(Editor.new(this.editor))
        : div().p(14).text_color(t.dim).child(tr("Open a space to take notes for it.")));
  }
}
