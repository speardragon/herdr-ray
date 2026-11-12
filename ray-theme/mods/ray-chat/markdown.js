// A message's Markdown drawn as a chat app draws it: bold really bold, `code`
// as a chip, code blocks in a box, lists with bullets, quotes with a bar,
// links you can click. rich.js parses (once a message: see view.blocks in
// main.js) and this draws. Styled text wraps word by word, since one element
// has one style.

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, window } from "herdr";
import { words, runsText } from "./rich.js";

const MONO = "JetBrains Mono"; // ships with Herdr
const SIZE = 13.5;
const HEADINGS = [17, 15.5, 14.5];
const MAX_WORDS = 1400; // a message that long stops here: the rest is in the agent's record
const MAX_BLOCKS = 80;

// The look, from the theme's colors.
const skinOf = (t) => ({
  text: t.foreground, dim: t.dim, link: t.accent, border: t.border,
  codeBg: `${t.foreground}1c`, codeFg: t.working, preBg: t.chrome, quoteBar: t.dim, headBg: t.raised,
});

function open(url) {
  const platform = window()?.platform;
  const [command, args] = platform === "macos" ? ["open", [url]] : platform === "windows" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  exec(command, args, { timeout: 10_000 }).catch(() => null);
}

const isPlain = (runs) => runs.every((r) => !r.b && !r.i && !r.s && !r.u && !r.code && !r.href && !r.mention && !r.color);

function wordEl(run, key, skin) {
  let el = div().flex_none().child(run.text.replace(/\n$/, ""));
  if (run.b) el = el.font_bold();
  if (run.i) el = el.italic();
  if (run.s) el = el.line_through();
  if (run.code) el = el.font_family(MONO).text_size(Math.round(SIZE * 0.88)).px(5).mx(1).rounded(4).bg(skin.codeBg).text_color(skin.codeFg);
  if (run.mention) el = el.text_color(skin.link);
  if (run.href) {
    el = el.id(key).cursor_pointer().text_color(skin.link).underline().on_click(() => open(run.href)).tooltip(run.href.slice(0, 120));
  } else if (run.u) el = el.underline();
  return el;
}

function runsEl(runs, id, skin, bud, opts = {}) {
  const size = opts.size ?? SIZE;
  const base = (el) => el.text_size(size).line_height(1.55).text_color(opts.color ?? skin.text).when(Boolean(opts.bold), (e) => e.font_bold());
  if (isPlain(runs)) {
    const text = runsText(runs);
    bud.words -= Math.ceil(text.length / 40);
    return base(div().w_full().min_w(0).whitespace_normal()).child(text);
  }
  const parts = words(runs, Math.max(0, bud.words));
  bud.words -= parts.length;
  const kids = [];
  parts.forEach((run, i) => {
    if (run.text !== "\n") kids.push(wordEl(run, `${id}-${i}`, skin));
    if (run.text.endsWith("\n")) kids.push(div().w_full().h(0));
  });
  return base(h_flex().w_full().min_w(0).flex_wrap().items_baseline()).children(kids);
}

function tableEl(block, id, skin, bud) {
  const cols = Math.max(1, ...block.rows.map((r) => r.length));
  return v_flex().w_full().rounded(6).border_1().border_color(skin.border).overflow_hidden().children(block.rows.slice(0, 30).map((row, r) =>
    h_flex().w_full().items_stretch().when(r > 0, (e) => e.border_t(1).border_color(skin.border)).when(block.header && r === 0, (e) => e.bg(skin.headBg))
      .children(Array.from({ length: cols }, (_x, c) => div().flex_1().min_w(0).px(8).py(5).when(c > 0, (e) => e.border_l(1).border_color(skin.border))
        .child(runsEl(row[c] ?? [], `${id}-${r}-${c}`, skin, bud, { size: SIZE - 1, bold: block.header && r === 0 }))))));
}

function blockEl(block, id, skin, bud) {
  switch (block.t) {
    case "h":
      return div().w_full().pt(6).child(runsEl(block.runs, id, skin, bud, { size: HEADINGS[block.level - 1] ?? SIZE, bold: true }));
    case "li": {
      const mark = block.ordered ? `${block.n ?? 1}.` : block.depth % 2 ? "◦" : "•";
      return h_flex().w_full().items_start().gap(6).pl(4 + block.depth * 18)
        .child(div().w(18).flex_none().text_size(SIZE).line_height(1.55).text_color(skin.dim).child(mark))
        .child(div().flex_1().min_w(0).child(runsEl(block.runs, id, skin, bud)));
    }
    case "code":
      return div().w_full().px(11).py(9).rounded(7).bg(skin.preBg).border_1().border_color(skin.border).font_family(MONO).text_size(Math.round(SIZE * 0.88)).line_height(1.55)
        .text_color(skin.text).whitespace_normal().child(block.text.split("\n").slice(0, 50).join("\n").slice(0, 3000));
    case "quote":
      return h_flex().w_full().items_stretch().gap(10).child(div().w(3).flex_none().rounded(2).bg(skin.quoteBar))
        .child(div().flex_1().min_w(0).child(runsEl(block.runs, id, skin, bud, { color: skin.dim })));
    case "hr":
      return div().w_full().h(1).my(6).bg(skin.border);
    case "table":
      return tableEl(block, id, skin, bud);
    case "more":
      return div().w_full().text_size(12).text_color(skin.dim).child("…");
    default:
      return div().w_full().pl((block.depth ?? 0) * 18).child(runsEl(block.runs ?? [], id, skin, bud));
  }
}

// The parsed blocks of a message -> one element.
export function markdownEl(t, list, id) {
  const skin = skinOf(t);
  const bud = { words: MAX_WORDS };
  const kids = [];
  for (let i = 0; i < list.length && i < MAX_BLOCKS && bud.words > 0; i++) kids.push(blockEl(list[i], `${id}-${i}`, skin, bud));
  return v_flex().w_full().gap(5).children(kids);
}
