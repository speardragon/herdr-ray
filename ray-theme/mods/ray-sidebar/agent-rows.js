// The rows under a space in the sidebar: an "Agents n" line, then its agents
// (and their sub-agents), hanging off one line that runs down from the space's
// avatar. `x` is where that line is, from the row's left edge.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, openOverlay } from "herdr";
import { colorOf, MENU } from "./agent-color.js";
import { duration, icon, kidStatus, statusMark, RANK } from "./agents.js";
import { tr } from "./i18n/i18n.js";

const HEAD_H = 28;
const AGENT_H = 32;
const SUB_H = 28;
const TICK = 9; // the stub from the line to a row

const lineColor = (t) => t.input ?? t.border;

// The strip left of a row that carries the line: `through` runs it past the
// row (more rows follow), `tick` adds the stub to this row.
function gutter(t, x, h, { through, tick }) {
  const mid = Math.floor(h / 2);
  return div().relative().w(x + TICK + 4).h(h).flex_none()
    .child(div().absolute().left(x).top(0).w(1).h(through ? h : mid).bg(lineColor(t)))
    .when(tick, (el) => el.child(div().absolute().left(x).top(mid).w(TICK).h(1).bg(lineColor(t))));
}

export function agentsHead(t, x, count, spaceId) {
  return h_flex().id(`agents-of-${spaceId}`).h(HEAD_H).flex_none().items_center()
    .child(gutter(t, x, HEAD_H, { through: true, tick: true }))
    .child(h_flex().gap(6).items_center().text_size(13).text_color(t.muted)
      .child(svg("mods/ray-sidebar/bot.svg").size(14).flex_none().text_color(t.dim))
      .child(div().child(tr("Agents")))
      .child(div().px(6).h(18).flex().items_center().rounded(9).bg(t.raised).text_size(12).text_color(t.muted).child(String(count))));
}

// The chevron that folds an agent's sub-agents; folded, their count too,
// colored by the most urgent one.
function fold(v, t, a, subs, listed) {
  const top = subs.map((s) => kidStatus(s.t, listed)).reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
  const open = !v.foldedAgents.has(a.address);
  return div().id(`fold-${a.address}`).h(18).px(3).gap(3).flex().items_center().rounded(4).text_size(12.5)
    .text_color(open ? t.dim : (t[top] ?? t.dim))
    .cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      v.toggleAgent(a.address);
      cx.notify();
    })
    .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
    .when(!open, (el) => el.child(String(subs.length)));
}

// The pin on a hovered line: opens the palette to mark the agent with a color
// (agent-color.js). A marked agent's line has that color, softly, behind it.
function pin(v, t, a, color) {
  return div().id(`pin-${a.address}`).flex_none().p(2).rounded(4).text_color(color ?? t.dim).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(tr("Mark with a color"))
    .on_click((_e, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: "ray-sidebar", kind: "popup", ...MENU, props: { colorMenu: a.address } });
    })
    .child(svg("mods/workspace-chrome/pin.svg").size(13));
}

// o: { x, last, name, subs, listed, since (ms, 0: unknown), now }
// An idle agent's name: the text color a little dimmed, a light gray on dark themes.
const idleText = (t) => (/^#[0-9a-f]{6}$/i.test(t.foreground ?? "") ? `${t.foreground}B3` : t.muted);

export function agentRow(v, t, a, o) {
  const pic = icon(a.program, 16, t.foreground);
  const idle = a.status === "idle" && !a.focused;
  const hovered = v.hovered === a.address;
  const color = colorOf(a.address);
  return h_flex().id(`ag-${a.address}`).h(AGENT_H).flex_none().items_center()
    .child(gutter(t, o.x, AGENT_H, { through: !o.last, tick: true }))
    .child(h_flex().id(`ag-pill-${a.address}`).flex_1().min_w(0).h(AGENT_H - 1).px(7).gap(8).rounded(7).items_center()
      // Its color, softly; a little stronger when it is the one in view or under the pointer.
      .when(Boolean(color), (el) => el.bg(`${color}${a.focused ? "47" : "26"}`).hover((s) => s.bg(`${color}3D`)))
      .when(!color, (el) => el.when(a.focused, (x) => x.bg(t.selected)).hover((s) => s.bg(t.hover)))
      .cursor_pointer()
      .on_hover((on, cx) => {
        if (on) v.hovered = a.address;
        else if (v.hovered === a.address) v.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().text_color(idle ? idleText(t) : t.foreground).child(o.name))
      .when(o.subs.length > 0, (el) => el.child(fold(v, t, a, o.subs, o.listed)))
      .when(hovered, (el) => el.child(pin(v, t, a, color)))
      .when(!hovered && Boolean(o.since), (el) => el.child(div().flex_none().text_size(12.5).text_color(t.dim).child(duration(o.now - o.since))))
      .child(statusMark(t, a.status)));
}

// A sub-agent under its agent. o: { x, through, listed, shown }
export function subRow(t, s, o) {
  const k = s.t;
  const pic = icon(k.program, 14, t.foreground);
  const on = k.address === o.shown;
  return h_flex().id(`sub-${k.address}`).h(SUB_H).flex_none().items_center()
    .child(gutter(t, o.x, SUB_H, { through: o.through, tick: false }))
    .child(h_flex().id(`sub-pill-${k.address}`).flex_1().min_w(0).h(SUB_H - 1).pl(14).pr(7).rounded(7).items_center().text_size(14)
      .when(on, (el) => el.bg(t.raised))
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .children(s.lines.map((l) => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), (el) => el.border_l(1.5).border_color(lineColor(t)))
        .when(l === "└" || l === "├", (el) => el.border_b(1.5).rounded_bl(6))))
      .when(Boolean(pic), (el) => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(statusMark(t, kidStatus(k, o.listed), true)));
}
