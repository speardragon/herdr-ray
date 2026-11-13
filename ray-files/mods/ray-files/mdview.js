// Markdown source colored as VS Code's Dark Modern colors it. The app's editor
// gives Markdown no colors, so this draws the lines itself: numbered, wrapped,
// read-only. (Text drawn this way can't be selected.)

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { C } from "./look.js";

const MAX_LINES = 1500;
const MD = {
  text: "#CCCCCC", head: "#569CD6", bold: "#569CD6", italic: "#C586C0", code: "#CE9178",
  quote: "#6A9955", list: "#6796E6", link: "#CE9178", plain: "#D4D4D4", number: "#6E7681",
};

// `code`, **bold**, *italic*, ~~strike~~, [text](address)
const INLINE = /(`+)[^`]+\1|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]*\]\([^)\n]*\)|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|(?<![\w_])_[^_\s][^_\n]*_(?!\w)/g;

function inline(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const s = m[0];
    if (s[0] === "`") out.push({ text: s, color: MD.code });
    else if (s.startsWith("**") || s.startsWith("__")) out.push({ text: s, color: MD.bold, bold: true });
    else if (s.startsWith("~~")) out.push({ text: s, strike: true });
    else if (s[0] === "[") {
      const cut = s.indexOf("](");
      out.push({ text: s.slice(0, cut + 1), color: MD.link }, { text: "(" }, { text: s.slice(cut + 2, -1), underline: true }, { text: ")" });
    } else out.push({ text: s, color: MD.italic, italic: true });
    at = m.index + s.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// One line -> its colored runs. `state.fence` is carried from line to line.
function runsOf(line, state) {
  if (/^\s*(```|~~~)/.test(line)) { state.fence = !state.fence; return [{ text: line, color: MD.plain }]; }
  if (state.fence) return [{ text: line, color: MD.plain }];
  if (/^#{1,6}(\s|$)/.test(line)) return [{ text: line, color: MD.head, bold: true }];
  const quote = line.match(/^\s*>+\s?/);
  if (quote) return [{ text: quote[0], color: MD.quote }, ...inline(line.slice(quote[0].length))];
  const list = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)/);
  if (list) return [{ text: list[1] }, { text: list[2], color: MD.list }, { text: list[3] }, ...inline(line.slice(list[0].length))];
  return inline(line);
}

function styled(el, run) {
  let out = el;
  if (run.color) out = out.text_color(run.color);
  if (run.bold) out = out.font_bold();
  if (run.italic) out = out.italic();
  if (run.strike) out = out.line_through();
  if (run.underline) out = out.underline();
  return out;
}

// A file's text -> its lines, each { indent, words }: done once when the file opens.
// Leading spaces would be dropped by wrapping, so they become the line's left padding.
export function parseMarkdown(text) {
  const all = text.split("\n");
  const state = { fence: false };
  const lines = all.slice(0, MAX_LINES).map((line) => {
    const indent = line.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length;
    const runs = runsOf(line, state).filter((r) => r.text);
    if (indent && runs[0]) runs[0] = { ...runs[0], text: runs[0].text.replace(/^[ \t]+/, "") };
    return { indent, words: runs.flatMap((run) => run.text.split(/(?<=\s)(?=\S)/).filter(Boolean).map((part) => ({ ...run, text: part }))) };
  });
  return { lines, more: Math.max(0, all.length - MAX_LINES) };
}

function lineEl({ indent, words }, n, size) {
  const text = words.length <= 1
    ? styled(div().flex_1().min_w(0).min_h(size * 1.5).whitespace_normal(), words[0] ?? {}).child(words[0]?.text ?? "")
    : h_flex().flex_1().min_w(0).flex_wrap().items_baseline().children(words.map((w) => styled(div().flex_shrink_1().min_w(0).max_w_full().whitespace_normal(), w).child(w.text)));
  return h_flex().flex_none().w_full().min_w(0).items_start()
    .child(div().w(46).pr(14).flex_none().text_right().text_color(MD.number).child(String(n)))
    .child(div().flex_1().min_w(0).pl(indent * size * 0.6).child(text));
}

// `parsed`: what parseMarkdown gave.
export function markdownSource(parsed, font, size) {
  const lines = parsed.lines.map((line, i) => lineEl(line, i + 1, size));
  return v_flex().id("files-markdown").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().bg(C.editor).pt(2).pb(12).pr(18)
    .font_family(font).text_size(size).line_height(1.5).text_color(MD.text)
    .children(lines)
    .when(parsed.more > 0, (el) => el.child(div().pl(46).pt(6).text_color(MD.number).child(`… (${parsed.more} more lines)`)));
}
