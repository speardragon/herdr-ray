import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, openOverlay, props } from "herdr";
import { LOCALES, locale, tr } from "./i18n/i18n.js";

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? tr("{key}  commands", { key }) : tr("commands");
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(13.5).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? tr("This computer")))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(tr("{n} agents", { n: list.length }))
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(tr("· {n} needs you", { n: needs })))))
      .child(h_flex().id("locale").gap(6).items_center().cursor_pointer().hover(s => s.text_color(t.foreground))
        .tooltip(tr("Language"))
        .on_click(() => openOverlay({ mod: "ray-locale", kind: "popup", width: 180, height: 78 + 31 * LOCALES.length }))
        .child(svg("mods/ray-locale/globe.svg").size(13)).child(locale().name))
      .child(div().flex_1())
      // The commands shortcut hint; a layout leaves it out with props { palette: false }.
      .when(props()?.palette !== false, el => el.child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t))));
  }
}
