// An agent's color: a mark a person gives an agent to find it again, drawn as
// a soft background on its line. Picked from a small palette that opens from
// the pin on the line (hover it). Kept in shared "agent.colors":
// { [terminal address]: "#rrggbb" }; an address no longer running is dropped
// the next time one is set.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, shared, setShared, terminals } from "herdr";
import { tr } from "./i18n/i18n.js";

const KEY = "agent.colors";
export const PALETTE = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6", "#EC4899"];
const SWATCH = 22;
const GAP = 8;
export const MENU = { width: 20 + PALETTE.length * SWATCH + (PALETTE.length - 1) * GAP, height: 112 };

export const colorOf = (address) => (shared(KEY) ?? {})[address] ?? null;

function setColor(address, color) {
  const live = new Set(terminals().map((x) => x.address));
  const { [address]: _old, ...others } = Object.fromEntries(Object.entries(shared(KEY) ?? {}).filter(([a]) => live.has(a)));
  setShared(KEY, color ? { ...others, [address]: color } : others);
}

// The palette popup for the agent at `address`.
export function colorMenu(t, address) {
  const now = colorOf(address);
  const pick = (color) => () => {
    setColor(address, color);
    closeOverlay(props().overlay);
  };
  return v_flex().w_full().p(10).gap(8).bg(t.popover).text_size(14)
    .child(div().text_size(12.5).text_color(t.dim).child(tr("Mark with a color")))
    .child(h_flex().gap(GAP).children(PALETTE.map((c) => div().id(`color-${c}`).size(SWATCH).flex_none().rounded(SWATCH / 2).bg(c).cursor_pointer()
      .border(2).border_color(now === c ? t.foreground : `${c}00`)
      .hover((s) => s.opacity(0.8))
      .on_click(pick(c)))))
    .child(h_flex().id("color-none").h(28).px(6).gap(8).rounded(6).items_center().text_color(now ? t.foreground : t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(pick(null))
      .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none().text_color(t.muted))
      .child(tr("No color")));
}
