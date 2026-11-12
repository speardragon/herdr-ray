// The usage popup: a card a provider, in its brand color. A limit is a row
// with a bar (what's used), the percent and when it resets; Grok, which has
// no limit, shows counts instead. Sizes are fixed so the chip can tell how
// tall the popup will be before it opens (it opens upward from the status bar).

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { tr } from "./i18n/i18n.js";

// Brand colors: Anthropic's clay, OpenAI's green, Google's blue. Grok's
// mark is black or white, so it takes the theme's text color.
const BRAND = { claude: "#D97757", codex: "#10A37F", antigravity: "#3186FF" };
export const brand = (t, id) => BRAND[id] ?? t.foreground;

export const WIDTH = 400;
const PAD = 12;
const HEAD = 38;
const CARD_HEAD = 30;
const ROW = 24;
const STATS = 46;
const NOTE = 22;
const CARD_PAD = 20; // a card's top and bottom padding
const GAP = 8;
const LABEL_W = 108;
const PCT_W = 38;
const RESET_W = 88;
const BAR_W = WIDTH - PAD * 2 - 24 - LABEL_W - PCT_W - RESET_W - 24;

const cardHeight = (p) => CARD_PAD + CARD_HEAD + p.rows.length * ROW + (p.stats ? STATS : 0) + (p.note ? NOTE : 0);

// How tall the popup is for these providers.
export function heightOf(providers) {
  if (!providers.length) return PAD * 2 + HEAD + 40;
  return PAD * 2 + HEAD + providers.reduce((sum, p) => sum + cardHeight(p), 0) + GAP * (providers.length - 1);
}

const pad = (n) => String(n).padStart(2, "0");

export function when(ms) {
  const d = new Date(ms);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? clock : `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
}

export const labelOf = (r) => [r.group, r.label && tr(r.label)].filter(Boolean).join(" · ");

function level(t, used) {
  if (used === null) return t.dim;
  if (used >= 80) return t.blocked;
  return t.foreground;
}

function limitRow(t, color, r) {
  const fill = r.used === null ? 0 : Math.max(r.used > 0 ? 3 : 0, Math.round((BAR_W * Math.min(r.used, 100)) / 100));
  return h_flex().h(ROW).gap(8).items_center().text_size(13)
    .child(div().w(LABEL_W).flex_none().truncate().text_color(t.muted).child(labelOf(r)))
    .child(div().w(BAR_W).h(6).flex_none().rounded(3).bg(`${color}30`)
      .child(div().w(fill).h(6).rounded(3).bg(color)))
    .child(div().w(PCT_W).flex_none().text_right().font_medium().text_color(level(t, r.used)).child(r.used === null ? "–" : `${r.used}%`))
    .child(div().w(RESET_W).flex_none().truncate().text_right().text_size(12).text_color(t.dim).child(r.resets ? `↻ ${when(r.resets)}` : ""));
}

// The box that puts a provider in the status bar's chip; only one with a
// limit to show can go there.
function chipBox(t, color, p, chip) {
  const on = chip.on(p.id);
  return div().id(`chip-${p.id}`).size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(on ? color : t.dim)
    .text_size(11).font_bold().text_color(t.popover).cursor_pointer()
    .when(on, (el) => el.bg(color))
    .tooltip(tr("Show in the status bar"))
    .on_click((_e, cx) => chip.toggle(p.id, cx))
    .child(on ? "✓" : "");
}

function card(t, p, chip) {
  const color = brand(t, p.id);
  return v_flex().h(cardHeight(p)).flex_none().px(12).py(CARD_PAD / 2).rounded(10).bg(`${color}14`).border_1().border_color(`${color}40`)
    .child(h_flex().h(CARD_HEAD).gap(8).items_center()
      .child(p.tint ? svg(p.icon).size(17).flex_none().text_color(color) : image(p.icon).w(17).h(17).flex_none())
      .child(div().text_size(14.5).font_semibold().text_color(color).child(p.name))
      .when(Boolean(p.plan), (el) => el.child(div().px(6).h(18).flex().items_center().rounded(9).bg(`${color}26`).text_size(11.5).text_color(color).child(String(p.plan))))
      .child(div().flex_1())
      .when(Boolean(p.asOf), (el) => el.child(div().text_size(12).text_color(t.dim).child(`${tr("as of {at}", { at: when(p.asOf) })} ${ago(p.asOf)}`)))
      .when(p.rows.length > 0, (el) => el.child(chipBox(t, color, p, chip))))
    .children(p.rows.map((r) => limitRow(t, color, r)))
    .when(Boolean(p.stats), (el) => el.child(h_flex().h(STATS).gap(8).items_center()
      .children(p.stats.map(([name, value]) => v_flex().flex_1().h(38).px(9).justify_center().rounded(7).bg(`${color}12`)
        .child(div().text_size(11.5).text_color(t.dim).child(tr(name)))
        .child(div().text_size(13.5).font_medium().text_color(t.foreground).child(value))))))
    .when(Boolean(p.note), (el) => el.child(div().h(NOTE).flex().items_center().truncate().text_size(12).text_color(t.dim).child(tr(p.note))));
}

// "(0m ago)", "(12m ago)", "(3h ago)", "(53d ago)": how long ago `ms` was.
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 3600) return tr("({n}m ago)", { n: Math.floor(s / 60) });
  if (s < 86400) return tr("({n}h ago)", { n: Math.floor(s / 3600) });
  return tr("({n}d ago)", { n: Math.floor(s / 86400) });
}

// "11/10 2:03:27 PM" (Korean: "11월 10일 오후 2:03:27"): when the numbers were read.
function stamp(ms) {
  const d = new Date(ms);
  return tr("{date} {time} {half}", {
    date: tr("{month}/{day}", { month: d.getMonth() + 1, day: d.getDate() }),
    time: `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    half: tr(d.getHours() < 12 ? "AM" : "PM"),
  });
}

export function panel(t, providers, loading, refresh, chip, at) {
  return v_flex().id("usage-panel").w(WIDTH).h(heightOf(providers)).p(PAD).bg(t.popover).text_color(t.foreground)
    .child(h_flex().h(HEAD).pb(8).px(2).items_center()
      .child(div().flex_1().text_size(14).font_semibold().child(tr("Usage")))
      .when(Boolean(at), (el) => el.child(div().pr(4).text_size(12).text_color(t.dim).tooltip(tr("When these were read")).child(`${stamp(at)} ${ago(at)}`)))
      .child(div().id("usage-refresh").px(7).h(24).flex().items_center().rounded(6).text_size(13).text_color(t.dim).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(tr("Refresh"))
        .on_click(refresh)
        .child(loading ? "…" : "↻")))
    .when(!providers.length, (el) => el.child(div().h(40).px(2).text_size(13).text_color(t.dim).child(tr(loading ? "Loading…" : "No usage to show yet."))))
    .child(v_flex().gap(GAP).children(providers.map((p) => card(t, p, chip))));
}
