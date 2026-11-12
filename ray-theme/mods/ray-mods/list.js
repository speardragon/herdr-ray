// The list of installed mods: yours first, then the ones that are off, the
// ones used but missing, and Herdr's own (folded).

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { tr } from "./i18n/i18n.js";

export const KIND = { mine: "Mine", clone: "Clone", shipped: "Herdr", missing: "Missing" };

export function badge(t, text, color) {
  return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(`${color}26`).text_size(11).font_medium().text_color(color).child(text);
}

// Badges for a row: what needs a look first.
export function badges(t, item, check) {
  const out = [];
  if (check?.state === "update") out.push(badge(t, tr("Update"), t.accent));
  if (check?.changed) out.push(badge(t, tr("Changed here"), t.working));
  if (item.disabled) out.push(badge(t, tr("Off"), t.dim));
  if (item.kind === "missing") out.push(badge(t, tr("Missing"), t.blocked));
  if (item.kind === "clone") out.push(badge(t, tr("Clone"), t.muted));
  if (item.source) out.push(badge(t, "GitHub", t.muted));
  return out;
}

const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${n} KB`);

function row(t, item, view) {
  const used = item.nodes.some((n) => !n.hidden) || item.keys.length > 0;
  return h_flex().id(`mod-${item.name}`).mx(6).px(9).py(7).gap(9).items_center().rounded(8).cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => view.choose(item.name, cx))
    .child(div().size(7).flex_none().rounded(4).when(used && !item.disabled, (el) => el.bg(t.done)).when(!used || item.disabled, (el) => el.border(1.5).border_color(t.dim)))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(h_flex().gap(6).items_center()
        .child(div().flex_shrink(1).min_w(0).truncate().text_size(13.5).font_medium().text_color(item.disabled ? t.muted : t.foreground).child(item.name))
        .children(badges(t, item, view.checks[item.name])))
      .when(Boolean(item.title) && item.title !== item.name, (el) => el.child(div().truncate().text_size(12).text_color(t.dim).child(item.title))))
    .child(div().flex_none().text_size(11.5).text_color(t.dim).child(item.kind === "missing" ? "" : kb(item.size)));
}

function section(t, id, title, items, view, folded = false) {
  if (!items.length) return null;
  const open = !(view.folded[id] ?? folded);
  return v_flex().gap(1)
    .child(h_flex().id(`sec-${id}`).mx(6).mt(8).px(8).h(26).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => view.fold(id, open, cx))
      .child(div().w(10).text_size(10).text_color(t.dim).child(open ? "▾" : "▸"))
      .child(div().flex_1().text_size(12).font_semibold().text_color(t.dim).child(tr(title)))
      .child(div().text_size(11.5).text_color(t.dim).child(String(items.length))))
    .when(open, (el) => el.children(items.map((i) => row(t, i, view))));
}

// `view`: { checks: { [name]: check }, folded, choose(name, cx), fold(id, open, cx) }
export function list(t, items, view) {
  const by = (f) => items.filter(f).sort((a, b) => a.name.localeCompare(b.name));
  const parts = [
    section(t, "mine", "Your mods", by((i) => (i.kind === "mine" || i.kind === "clone") && !i.disabled), view),
    section(t, "off", "Turned off", by((i) => Boolean(i.disabled) && i.kind !== "missing"), view),
    section(t, "missing", "Used but not installed", by((i) => i.kind === "missing"), view),
    section(t, "shipped", "Herdr's own", by((i) => i.kind === "shipped" && !i.disabled), view, true),
  ].filter(Boolean);
  return v_flex().id("mods-list").flex_1().min_h(0).pb(10).overflow_y_scrollbar().children(parts);
}
