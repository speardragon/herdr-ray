// Pieces of the request wizard (ask.js): chips, the agents grouped under their
// spaces with machine tabs, and big option rows.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { avatar, spaceAvatar, stateDot } from "./parts.js";
import { tr } from "./i18n/i18n.js";

const LOCAL = "@local"; // the tab of this computer (a space on it has no machine name)

export function chip(t, id, on, picture, label, tip, go) {
  return h_flex().id(id).flex_none().h(26).px(8).gap(6).items_center().rounded(13).border_1().text_size(12.5).cursor_pointer()
    .when(on, (el) => el.bg(`${t.accent}33`).border_color(t.accent).text_color(t.foreground))
    .when(!on, (el) => el.border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .on_click(go)
    .when(Boolean(picture), (el) => el.child(picture))
    .child(div().max_w(170).truncate().child(label));
}

// Agents grouped under their space, as the sidebar groups them: a header a space
// (its picture, name, how many; a dot when the agent in view is in it), and under
// it a row an agent. The space in view, and the one with the picked agent, are
// open; the others are folded until their header is pressed. The agent in view
// has a bar on its left and a "Viewing" tag.
// With agents on more than one machine, a tab a machine picks whose spaces are shown.
// `items`: [{ address, label, space, status, focused, who }]
export function agentPicker(t, form, items, selected, pick, prefix) {
  const all = form.spaces.map((s) => ({ s, list: items.filter((i) => i.space === s.id) })).filter((g) => g.list.length);
  // One tab a machine (the computer itself, then each connected one): only the
  // chosen machine's spaces are listed. It opens on the machine of the picked
  // agent, else of the space in view.
  const mach = (g) => g.s.machine ?? LOCAL;
  const machines = [...new Set(all.map(mach))];
  const first = all.find((g) => g.list.some(selected)) ?? all.find((g) => g.s.id === form.space) ?? all[0];
  const asked = form.machine?.[prefix];
  const now = machines.includes(asked) ? asked : first ? mach(first) : LOCAL;
  const groups = all.filter((g) => mach(g) === now);
  const tabs = machines.length > 1
    ? h_flex().id(`mt-${prefix}`).h(30).p(2).rounded(15).border_1().border_color(t.border).children(machines.map((m) => {
      const here = all.filter((g) => mach(g) === m);
      const mark = here.some((g) => g.list.some((i) => selected(i) || i.focused));
      return h_flex().id(`mt-${prefix}${m}`).flex_1().min_w(0).gap(6).items_center().justify_center().rounded(13).text_size(12.5).cursor_pointer()
        .when(m === now, (el) => el.bg(t.selected).text_color(t.foreground).font_medium())
        .when(m !== now, (el) => el.text_color(t.muted).hover((x) => x.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => form.pick("machine", { ...(form.machine ?? {}), [prefix]: m }, cx))
        .child(div().max_w(120).truncate().child(m === LOCAL ? tr("This computer") : m))
        .when(mark, (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.accent)));
    }))
    : null;
  return v_flex().gap(6).when(Boolean(tabs), (el) => el.child(tabs)).child(v_flex().gap(4).children(groups.map(({ s, list }) => {
    const key = `${prefix}${s.id}`;
    const open = form.open?.[key] ?? (s.id === form.space || list.some(selected));
    return v_flex().gap(2)
      .child(h_flex().id(`sp-${key}`).h(28).px(6).gap(7).items_center().rounded(7).cursor_pointer().hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => form.toggle(key, open, cx))
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(open ? "▾" : "▸"))
        .child(spaceAvatar(t, s, 18))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.muted).child(s.machine ? `${s.name} · ${s.machine}` : s.name))
        .when(list.some((i) => i.focused), (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.accent)))
        .child(div().flex_none().px(6).h(17).flex().items_center().rounded(9).bg(t.raised).text_size(11).text_color(t.muted).child(String(list.length))))
      .when(open, (el) => el.children(list.map((i) => {
        const on = selected(i);
        return h_flex().id(`${prefix}ag-${i.address}`).relative().h(32).ml(18).pl(10).pr(8).gap(8).items_center().rounded(7).border_1().cursor_pointer()
          .when(on, (x) => x.bg(`${t.accent}2e`).border_color(t.accent))
          .when(!on, (x) => x.border_color(`${t.accent}00`).hover((y) => y.bg(t.hover)))
          .on_click((_e, cx) => pick(i, cx))
          .when(i.focused, (x) => x.child(div().absolute().left(0).top(6).bottom(6).w(3).rounded(2).bg(t.accent)))
          .child(avatar(t, i.who, 18))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).when(i.focused, (y) => y.font_semibold()).child(i.label))
          .when(i.focused, (x) => x.child(div().flex_none().px(6).h(17).flex().items_center().rounded(5).bg(`${t.accent}26`).text_size(11).font_medium().text_color(t.accent).child(tr("Viewing"))))
          .child(stateDot(t, i.status));
      })));
  })));
}

// One big option: a picture, a title, a line under it, and the mark of the chosen one.
export function optionRow(t, id, on, picture, title, sub, go) {
  return h_flex().id(id).gap(10).px(12).py(9).items_center().rounded(10).border_1().cursor_pointer()
    .when(on, (el) => el.bg(`${t.accent}2e`).border_color(t.accent))
    .when(!on, (el) => el.border_color(t.border).hover((x) => x.bg(t.hover)))
    .on_click(go)
    .when(Boolean(picture), (el) => el.child(picture))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().truncate().text_size(13.5).font_medium().text_color(t.foreground).child(title))
      .when(Boolean(sub), (el) => el.child(div().text_size(12).text_color(t.dim).whitespace_normal().child(sub))))
    .child(div().size(16).flex_none().rounded(8).border_1().border_color(on ? t.accent : t.border).flex().items_center().justify_center()
      .child(on ? div().size(8).rounded(4).bg(t.accent) : div()));
}
