// Small pieces the list and the conversation both draw.

import { div, svg, image } from "gpui-kit";
import { TINTS } from "./model.js";
import { shared } from "herdr";
import { tr } from "./i18n/i18n.js";

const pad = (n) => String(n).padStart(2, "0");
const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
const DARK_INK = "#111418";

// The text color on a colored square: white or near-black, whichever reads better
// (white on a light color such as yellow or cyan is hard to read).
export function inkOn(fill) {
  if (!/^#[0-9a-f]{6}/i.test(fill ?? "")) return "#ffffff";
  const l = luminance(fill);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0566 ? "#ffffff" : DARK_INK;
}


// "2:03 PM" (Korean: "오후 2:03").
export function clock(ms) {
  const d = new Date(ms);
  return tr("{time} {half}", { time: `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`, half: tr(d.getHours() < 12 ? "AM" : "PM") });
}

// "Today", "Yesterday" or "11/10".
export function day(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tr("Today");
  if (d.toDateString() === yesterday.toDateString()) return tr("Yesterday");
  return tr("{month}/{day}", { month: d.getMonth() + 1, day: d.getDate() });
}

// In a list: the time today, else the day.
export const brief = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? clock(ms) : day(ms));

// Agents often run the same program, so their logo alone doesn't tell them
// apart: each has a background color of its own (`tint`, given by the watcher
// so that no two agents of a conversation share one while there are colors left).
export function tintOf(who) {
  if (who?.tint) return who.tint;
  const key = who?.key ?? who?.label ?? "";
  let hash = 7;
  for (const c of key) hash = (hash * 31 + c.codePointAt(0)) % 1000003;
  return TINTS[hash % TINTS.length];
}

// The agent's own color for its name: lightened toward white so it reads on the dark panel.
export function nameColor(who, fallback) {
  if (who?.you) return fallback;
  const c = tintOf(who);
  const mix = (i) => Math.round(parseInt(c.slice(i, i + 2), 16) + (255 - parseInt(c.slice(i, i + 2), 16)) * 0.38);
  return "#" + [1, 3, 5].map((i) => mix(i).toString(16).padStart(2, "0")).join("");
}

// A sender's square picture: its program's logo on its own color, "Me" for the person.
export function avatar(t, who, size) {
  const box = div().size(size).flex_none().flex().items_center().justify_center().rounded(Math.round(size * 0.22));
  if (who?.you) return box.bg(`${t.accent}33`).text_size(Math.round(size * 0.42)).font_bold().text_color(t.accent).child(tr("Me"));
  const icon = who?.program?.icon;
  const inner = Math.round(size * 0.62);
  const tint = tintOf(who);
  if (!icon) return box.bg(`${tint}66`).text_size(Math.round(size * 0.46)).font_bold().text_color(t.foreground).child([...(who?.label ?? "?")][0]?.toUpperCase() ?? "?");
  return box.bg(`${tint}66`).child(who.program.tint ? svg(icon).size(inner).flex_none().text_color(t.foreground) : image(icon).w(inner).h(inner).flex_none());
}

// A space's picture as the sidebar draws it: the emoji, character or image picked
// there (shared "space.logos"), else its first letter on its color ("space.colors").
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const EMOJI = (() => {
  try {
    return new RegExp("\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\u20E3", "u");
  } catch {
    return /[\u2190-\u2BFF\u{1F000}-\u{1FAFF}]/u;
  }
})();
export function spaceAvatar(t, space, size) {
  const logo = (shared("space.logos") ?? {})[space.id];
  const radius = Math.round(size * 0.28);
  if (logo?.image) return image(logo.image).size(size).flex_none().rounded(radius);
  const box = div().size(size).flex_none().flex().items_center().justify_center().rounded(radius);
  const glyph = logo?.text ?? logo?.emoji;
  if (glyph && EMOJI.test(glyph)) return box.text_size(Math.round(size * 0.83)).child(div().child(glyph));
  const color = (shared("space.colors") ?? {})[space.id] ?? "ansi6";
  const fill = color.startsWith("#") ? color : MARK[color] ?? t[color] ?? t.raised;
  return box.bg(fill).text_size(Math.round(size * 0.67)).font_bold().text_color(inkOn(fill)).child(glyph ? glyph.toUpperCase() : [...space.name][0]?.toUpperCase() ?? "?");
}

// A live agent's state as a dot: working, needs someone, finished, idle; gone: none.
export function stateDot(t, status) {
  if (!status) return div().size(7).flex_none();
  const color = status === "working" ? t.working : status === "blocked" || status === "error" ? t.blocked : status === "done" ? t.done : t.dim;
  return div().size(7).flex_none().rounded(4).when(status === "idle", (el) => el.border(1.5).border_color(color)).when(status !== "idle", (el) => el.bg(color));
}

export const nameOf = (who) => (who?.you ? tr("You") : who?.label ?? "hc");

// What an event says, for a line between messages.
export function eventText(item, agent) {
  const name = agent?.label ?? "";
  const key = { started: "{name} started", done: "{name} finished its turn", blocked: "{name} needs you", error: "{name} hit an error", exited: "{name} ended" }[item.what];
  return key ? tr(key, { name }) : name;
}
