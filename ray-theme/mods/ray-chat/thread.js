// One conversation: who is in it, its messages oldest to newest with the
// newest at the bottom, and a box to write to one of its agents.
// The messages aren't a scroll area (one can't be told to start at its end):
// they are laid from the bottom and cut at the top, and the wheel moves which
// message is the last one shown (`view.end`; null: the newest, and stay there).

import { div } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { avatar, clock, day, eventText, inkOn, nameColor, nameOf, stateDot } from "./parts.js";
import { markdownEl } from "./markdown.js";
import { continues, senderOf } from "./model.js";
import { tr } from "./i18n/i18n.js";

const SHOWN = 30; // messages drawn at once, ending at the last one shown (a screen holds about half)
const STEP = 40; // wheel pixels a message

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function dayLine(t, ms) {
  return h_flex().flex_none().px(12).py(8).gap(8).items_center()
    .child(div().flex_1().h(1).bg(t.border))
    .child(div().flex_none().px(9).h(22).flex().items_center().rounded(11).border_1().border_color(t.border).text_size(11.5).font_medium().text_color(t.muted).child(day(ms)))
    .child(div().flex_1().h(1).bg(t.border));
}

function eventLine(t, item, log) {
  const text = item.kind === "note" ? item.text : eventText(item, log.agents[item.agent]);
  return h_flex().id(`row-${item.id}`).flex_none().px(12).py(3).gap(8).items_center().text_size(12).text_color(t.dim)
    .hover((s) => s.bg(t.hover))
    .child(div().w(30).flex_none().flex().justify_center().child("·"))
    .child(div().flex_1().min_w(0).whitespace_normal().child(text))
    .child(div().flex_none().text_size(11).child(clock(item.ts)));
}

// A message's text, as a chat app draws it (markdown.js); `view.blocks` parses it once.
function body(t, item, view) {
  return div().text_color(t.foreground).child(markdownEl(t, view.blocks(item), `md-${item.id}`));
}

// Slack's copy button: on the row under the pointer, top right. The text drawn here
// can't be selected, so this takes it whole.
function copyChip(t, item, view) {
  const done = view.copied === item.id;
  return div().id(`copy-${item.id}`).absolute().top(2).right(10).h(22).px(8).flex().items_center().rounded(6).bg(t.raised).border_1().border_color(t.border)
    .text_size(11.5).text_color(done ? t.done : t.muted).cursor_pointer()
    .hover((s) => s.text_color(t.foreground))
    .on_click((_e, cx) => view.copy(item, cx))
    .child(done ? tr("Copied") : tr("Copy"));
}

function message(t, item, before, log, view) {
  const who = senderOf(item, log);
  const to = log.agents[item.to];
  const joined = continues(item, before);
  const go = who.address ? (_e, cx) => view.goTo(who, cx) : null;
  // (an element needs an id for its hover to show)
  return h_flex().id(`row-${item.id}`).relative().flex_none().px(12).pt(joined ? 2 : 6).pb(3).gap(9).items_start()
    .hover((s) => s.bg(t.hover))
    .on_hover((on, cx) => view.hover(item.id, on, cx))
    .when(view.hovered === item.id, (el) => el.child(copyChip(t, item, view)))
    .child(joined ? div().w(30).flex_none() : div().id(`av-${item.id}`).flex_none().when(Boolean(go), (el) => el.cursor_pointer().on_click(go)).child(avatar(t, who, 30)))
    .child(v_flex().flex_1().min_w(0)
      .when(!joined, (el) => el.child(h_flex().gap(6).items_center()
        .child(div().id(`nm-${item.id}`).flex_shrink(1).min_w(0).truncate().text_size(13.5).font_bold().text_color(nameColor(who, t.foreground))
          .when(Boolean(go), (x) => x.cursor_pointer().hover((s) => s.opacity(0.75)).on_click(go)).child(nameOf(who)))
        .when(Boolean(to), (x) => x.child(div().flex_none().text_size(12).text_color(t.dim).child(`→ ${to?.label ?? ""}`)))
        .when(Boolean(item.task), (x) => x.child(div().flex_none().px(5).h(16).flex().items_center().rounded(4).bg(`${t.accent}26`).text_size(10.5).font_medium().text_color(t.accent).child(tr("Task"))))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(clock(item.ts)))))
      .child(body(t, item, view)));
}

function header(t, c, view) {
  return v_flex().flex_none().border_b(1).border_color(t.border)
    .child(h_flex().h(40).px(8).gap(6).items_center()
      .when(view.back, (el) => el.child(div().id("chat-back").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_size(16).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tr("Conversations")).on_click((_e, cx) => view.choose(null, cx)).child("‹")))
      .child(div().flex_1().min_w(0).truncate().text_size(14.5).font_bold().text_color(t.foreground).child(c.root.label))
      .child(div().flex_none().text_size(12).text_color(t.dim).child(tr("{n} agents", { n: c.members.length }))))
    .child(h_flex().px(10).pb(8).gap(6).flex_wrap()
      .children(c.members.map((a) => {
        const status = view.status(a);
        return h_flex().id(`mem-${a.key}`).flex_none().h(24).px(7).gap(6).items_center().rounded(12).bg(t.raised).text_size(12).text_color(status ? t.foreground : t.dim)
          .when(Boolean(status), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(tr("Go to this agent")).on_click((_e, cx) => view.goTo(a, cx)))
          .child(avatar(t, a, 16)).child(div().max_w(140).truncate().child(a.label)).child(stateDot(t, status));
      })));
}

function composer(t, c, view) {
  const live = c.members.filter((a) => view.status(a));
  if (!live.length) return div().flex_none().px(12).py(10).border_t(1).border_color(t.border).text_size(12.5).text_color(t.dim).child(tr("Every agent in this conversation has ended."));
  // Who it goes to: the one picked, else whoever spoke last, else the first agent started.
  const spoke = c.items.filter((i) => i.kind === "message" && i.from !== "you").at(-1)?.from;
  const to = live.find((a) => a.key === view.to) ?? live.find((a) => a.key === spoke) ?? live.find((a) => a.key !== c.key) ?? live[0];
  view.aim(to);
  return v_flex().flex_none().px(10).pt(8).pb(10).gap(6).border_t(1).border_color(t.border)
    .child(h_flex().gap(5).items_center().flex_wrap().text_size(12)
      .child(div().flex_none().text_color(t.dim).child(tr("To")))
      .children(live.map((a) => h_flex().id(`to-${a.key}`).flex_none().h(22).px(7).gap(5).items_center().rounded(11).cursor_pointer()
        .when(a.key === to.key, (el) => el.bg(`${t.accent}33`).text_color(t.foreground))
        .when(a.key !== to.key, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => view.pickTo(a.key, cx))
        .child(avatar(t, a, 14)).child(div().max_w(120).truncate().child(a.label))))
      .child(div().flex_1())
      // Not a message but a request: have the picked agent consult another (ask.js).
      .child(div().id("chat-ask-here").flex_none().h(22).px(7).flex().items_center().rounded(11).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tr("Have an agent ask another")).on_click((_e, cx) => view.ask(to, cx)).child(`+ ${tr("Ask")}`)))
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).child(Input.new(view.input).h(34).px(10).items_center().rounded(8).border_1().border_color(t.input).bg(t.background).text_size(13.5)))
      .child(div().id("chat-send").flex_none().px(11).h(34).flex().items_center().rounded(8).bg(t.accent).text_size(13).font_medium().text_color(inkOn(t.accent)).cursor_pointer()
        .hover((s) => s.opacity(0.85)).on_click((_e, cx) => view.send(to, cx)).child(tr("Send"))))
    .when(Boolean(view.error), (el) => el.child(div().whitespace_normal().text_size(12).text_color(t.blocked).child(view.error)));
}

// `view`: { end, input, to, error, back, rowsHeight, rowsFor, viewHeight, blocks(item), hovered, copied, hover(id, on, cx), copy(item, cx), status(agent), choose, goTo, pickTo, aim(agent), ask(agent, cx),
//   note({atTop}), measure(name, px, cx), send, scroll(delta, count, cx) }
export function thread(t, c, log, view) {
  const count = c.items.length;
  const end = view.end === null ? count : Math.max(1, Math.min(view.end, count));
  const from = Math.max(0, end - SHOWN);
  const rows = c.items.slice(from, end).flatMap((item, n) => {
    const before = c.items[from + n - 1];
    const line = item.kind === "message" ? message(t, item, before, log, view) : eventLine(t, item, log);
    return !before || !sameDay(before.ts, item.ts) ? [dayLine(t, item.ts), line] : [line];
  });
  // The first message is on screen with room to spare: that is the top. The
  // rows are then laid from the top, and the wheel goes no further back.
  // (Only a height measured for these very rows counts: one from the rows
  // drawn before would lay taller rows from the top and cut their end.)
  const measured = view.rowsFor === `${from}-${end}` && view.rowsHeight !== null && view.viewHeight !== null;
  const atTop = from === 0 && measured && view.rowsHeight <= view.viewHeight;
  view.note({ atTop });
  const pinnedTop = atTop && end < count;
  return v_flex().size_full().min_h(0)
    .child(header(t, c, view))
    .child(v_flex().id("chat-messages").flex_1().min_h(0).overflow_hidden()
      .when(pinnedTop, (el) => el.justify_start())
      .when(!pinnedTop, (el) => el.justify_end())
      .on_size_change((size, cx) => view.measure("viewHeight", size.height, cx))
      .on_scroll_wheel((e, cx) => view.scroll(e.delta?.y ?? 0, count, cx))
      // The id carries which rows these are, so each set is measured afresh.
      .child(v_flex().id(`chat-rows-${from}-${end}`).flex_none().pb(6)
        .on_size_change((size, cx) => view.measure("rowsHeight", size.height, cx, `${from}-${end}`)).children(rows)))
    // Not at the newest: a bar under the messages (not over them) goes back there.
    .when(end < count, (el) => el.child(h_flex().id("chat-newest").flex_none().h(26).justify_center().items_center().border_t(1).border_color(t.border)
      .text_size(12).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => view.scroll(null, count, cx)).child(tr("Newest ↓"))))
    .child(composer(t, c, view));
}

export { STEP };
