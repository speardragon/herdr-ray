// The conversations list: a row a conversation, as a chat app's sidebar.
// The top agent's picture and name, how many agents are in it, the last
// message, when, and how many are unread.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { avatar, brief, eventText, inkOn, nameOf, stateDot } from "./parts.js";
import { senderOf } from "./model.js";
import { tr } from "./i18n/i18n.js";

function preview(c, log) {
  const last = c.last;
  if (!last) return "";
  if (last.kind === "event") return eventText(last, log.agents[last.agent]);
  const text = (last.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  return last.kind === "note" ? text : `${nameOf(senderOf(last, log))}: ${text}`;
}

// `view`: { open, status(address) -> word | null, choose(key, cx) }
export function list(t, convs, log, view) {
  if (!convs.length) {
    return v_flex().flex_1().p(16).gap(6).text_size(13).text_color(t.dim)
      .child(div().whitespace_normal().child(tr("No conversations yet.")))
      .child(div().whitespace_normal().child(tr("When an agent starts another with hc run, what they send each other shows up here.")));
  }
  return v_flex().id("chat-list").flex_1().min_h(0).py(4).overflow_y_scrollbar()
    .children(convs.map((c) => {
      const on = view.open === c.key;
      const live = c.members.map((a) => view.status(a)).filter(Boolean);
      const top = ["blocked", "error", "working", "done", "idle"].find((s) => live.includes(s)) ?? null;
      return h_flex().id(`conv-${c.key}`).mx(6).px(8).py(7).gap(9).items_start().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected))
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click((_e, cx) => view.choose(c.key, cx))
        .child(avatar(t, c.root, 34))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().gap(6).items_center()
            .child(div().flex_shrink(1).min_w(0).truncate().text_size(14).text_color(t.foreground).when(c.unread > 0, (el) => el.font_bold()).when(!c.unread, (el) => el.font_medium()).child(c.root.label))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(tr("{n} agents", { n: c.members.length })))
            .child(stateDot(t, top))
            .child(div().flex_1())
            .child(div().flex_none().text_size(11.5).text_color(c.unread ? t.foreground : t.dim).child(c.last ? brief(c.last.ts) : "")))
          .child(h_flex().gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(c.unread ? t.foreground : t.muted).child(preview(c, log)))
            .when(c.unread > 0, (el) => el.child(div().flex_none().px(6).h(17).min_w(17).flex().items_center().justify_center().rounded(9).bg(t.blocked).text_size(11).font_bold().text_color(inkOn(t.blocked)).child(String(c.unread))))));
    }));
}
