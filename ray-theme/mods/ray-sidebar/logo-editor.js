// The "Edit logo" dialog for one space: type one character (an emoji shows as
// it is, a letter on the space's color), choose an image
// (macOS's file dialog) or drop one on the dialog, take a website's icon, or
// go back to the letter.
// Every choice applies at once. Owned by the Sidebar copy the dialog starts
// (see main.js), which draws it.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, spaces, window } from "herdr";
import { avatar, chooseImage, glyphOf, importImage, lastGlyph, logoOf, setLogo } from "./logo.js";
import { importFavicon } from "./favicon.js";
import { tr } from "./i18n/i18n.js";

export class LogoEditor {
  constructor(id, cx) {
    this.id = id;
    this.error = null;
    this.busy = null; // "file" | "site" while one is being brought in
    this.focused = false;
    this.siteFocused = false;
    this.site = InputState.new({ placeholder: tr("Website address, e.g. github.com") });
    this.site.on("submit", (_e, cx) => this.useSite(cx));
    this.site.on("focus", (_e, cx) => { this.siteFocused = true; cx.notify(); });
    this.site.on("blur", (_e, cx) => { this.siteFocused = false; cx.notify(); });
    this.input = InputState.new({ placeholder: tr("One character or emoji") });
    this.input.set_value(glyphOf(id));
    // The last character typed is the logo. The field is cut down to it only
    // on leaving, not while typing: that would break composing (한글).
    this.input.on("change", (_e, cx) => {
      const glyph = lastGlyph(this.input.value());
      if (glyph && glyph !== glyphOf(this.id)) this.pick(glyph);
      cx.notify();
    });
    this.input.on("submit", () => this.close());
    this.input.on("focus", (_e, cx) => { this.focused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => {
      this.focused = false;
      const glyph = lastGlyph(this.input.value());
      if (glyph !== this.input.value()) this.input.set_value(glyph);
      cx.notify();
    });
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  pick(text) {
    this.error = null;
    setLogo(this.id, { text });
  }

  // Runs `work` (-> null, or what went wrong), one at a time.
  bring(cx, kind, work) {
    if (this.busy) return;
    this.busy = kind;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        this.error = await work();
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      this.busy = null;
      cx.notify();
    });
  }

  // Copies `path` (or the file picked in the dialog) in as the logo.
  useImage(cx, path) {
    this.bring(cx, "file", async () => {
      const file = path ?? await chooseImage();
      return file ? importImage(this.id, file) : null;
    });
  }

  // Takes the icon of the website typed in.
  useSite(cx) {
    this.bring(cx, "site", () => importFavicon(this.id, this.site.value()));
  }

  button(t, id, label, go) {
    return div().id(id).flex_none().px(11).h(30).flex().items_center().rounded(7).border_1().border_color(t.border)
      .text_size(13).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(go)
      .child(label);
  }

  render(t, fill) {
    const space = spaces().find((s) => s.id === this.id);
    if (!space) return div().p(16).text_color(t.dim).child(tr("This space is gone."));
    const now = logoOf(this.id);
    const mac = window()?.platform === "macos";
    const label = (text) => div().pt(14).pb(6).text_size(12).font_medium().text_color(t.dim).child(text);
    return v_flex().id("logo-editor").size_full().p(18).bg(t.popover).text_color(t.foreground).text_size(14)
      .on_drop((e, cx) => { if (e.paths?.[0]) this.useImage(cx, e.paths[0]); })
      .child(h_flex().gap(12).items_center()
        .child(avatar(space, 44, fill))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().font_semibold().child(tr("Edit logo")))
          .child(div().truncate().text_size(13).text_color(t.muted).child(space.name))))
      .child(label(tr("Character or emoji")))
      .child(Input.new(this.input).h(34).px(10).items_center().rounded(8).border_1().border_color(this.focused ? t.accent : t.input).bg(t.background).text_size(15))
      .child(div().pt(6).whitespace_normal().text_size(12.5).text_color(t.dim)
        .child(tr(mac ? "An emoji shows as it is; a letter goes on the space's color. ⌃⌘Space opens the emoji picker." : "An emoji shows as it is; a letter goes on the space's color.")))
      .child(label(tr("Image")))
      .child(h_flex().gap(10).items_center()
        .when(mac, (el) => el.child(this.button(t, "choose-image", tr(this.busy === "file" ? "Loading…" : "Choose an image…"), (_e, cx) => this.useImage(cx, null))))
        .child(div().flex_1().min_w(0).whitespace_normal().text_size(12.5).text_color(t.dim)
          .child(tr(mac ? "Or drop an image file on this window." : "Drop an image file on this window."))))
      .child(label(tr("Website icon")))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).child(Input.new(this.site).h(34).px(10).items_center().rounded(8).border_1().border_color(this.siteFocused ? t.accent : t.input).bg(t.background).text_size(14)))
        .child(this.button(t, "fetch-icon", tr(this.busy === "site" ? "Loading…" : "Fetch"), (_e, cx) => this.useSite(cx))))
      .when(Boolean(this.error), (el) => el.child(div().pt(8).whitespace_normal().text_size(12.5).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().pt(12).gap(8).items_center()
        .when(Boolean(now), (el) => el.child(this.button(t, "reset-logo", tr("Back to the letter"), (_e, cx) => {
          setLogo(this.id, null);
          this.input.set_value("");
          cx.notify();
        })))
        .child(div().flex_1())
        .child(this.button(t, "close-logo", tr("Done"), () => this.close())));
  }
}
