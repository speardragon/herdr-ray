// The request wizard: have one agent consult another without writing out how.
// Four steps, one choice each: who asks, whom it asks (a new agent of an
// installed program, an hc template, or an agent already running), what kind of
// request it is, and the question. A choice only marks it; "Next" (or the
// numbers on top, which jump to any step) goes on. The choices are filled in
// from last time, so a known request is "open, press 4, write, send".
// prompt.js writes the instruction that is sent.

import { div } from "gpui-kit";
import { v_flex, h_flex, Textarea } from "gpui-base";
import { avatar, inkOn } from "./parts.js";
import { agentPicker, chip, optionRow } from "./picker.js";
import { KINDS } from "./prompt.js";
import { tr } from "./i18n/i18n.js";

const STEPS = [{ label: "Who asks" }, { label: "Whom it asks" }, { label: "What for" }, { label: "Write" }];

const bubble = (t, n, now) => {
  const done = n < now, here = n === now;
  return div().size(26).flex_none().rounded(13).flex().items_center().justify_center().text_size(12).font_semibold().border_1()
    .when(here, (el) => el.bg(t.accent).border_color(t.accent).text_color(inkOn(t.accent)))
    .when(done, (el) => el.bg(`${t.accent}33`).border_color(t.accent).text_color(t.accent))
    .when(!done && !here, (el) => el.border_color(t.border).text_color(t.dim))
    .child(done ? "✓" : String(n));
};

// 1 - 2 - 3 - 4 with what each is; pressing one goes there.
function stepper(t, form) {
  return h_flex().flex_none().px(8).pt(12).pb(8).children(STEPS.map((s, i) => {
    const n = i + 1, line = (on) => div().flex_1().h(2).rounded(1).bg(on ? t.accent : t.border);
    return v_flex().id(`step-${n}`).flex_1().min_w(0).gap(5).items_center().cursor_pointer()
      .on_click((_e, cx) => form.go(n, cx))
      .child(h_flex().w_full().items_center().gap(3)
        .child(i === 0 ? div().flex_1() : line(n <= form.step))
        .child(bubble(t, n, form.step))
        .child(i === STEPS.length - 1 ? div().flex_1() : line(n < form.step)))
      .child(div().max_w(78).text_size(11.5).text_center().whitespace_normal().text_color(n === form.step ? t.foreground : t.dim).child(tr(s.label)));
  }));
}

// The little robot over each step's title.
function robot(t) {
  return h_flex().relative().w(70).h(54).flex_none().items_center().justify_center()
    .child(div().absolute().left(8).top(10).size(36).rounded(11).bg(`${t.accent}33`))
    .child(h_flex().w(50).h(42).rounded(14).bg(t.accent).gap(8).items_center().justify_center()
      .child(div().size(8).rounded(4).bg(inkOn(t.accent))).child(div().size(8).rounded(4).bg(inkOn(t.accent))))
    .child(div().absolute().right(2).top(0).text_size(13).text_color(t.accent).child("✦"));
}

const heading = (t, text) => v_flex().items_center().gap(8).pb(4)
  .child(robot(t))
  .child(div().text_size(15).font_semibold().text_center().whitespace_normal().text_color(t.foreground).child(text));

const KIND_ABOUT = { ask: "Ask a question and bring back the answer.", review: "Have the work in progress reviewed.", opinion: "Have its plan checked for weak spots.", delegate: "Hand a task over and check what it did." };

function stepAgent(t, form) {
  return v_flex().gap(10).child(heading(t, tr("First pick the agent that asks.")))
    .child(form.senders.length
      ? agentPicker(t, form, form.senders, (i) => i.address === form.from, (i, cx) => form.choose("from", i.address, cx), "from-")
      : div().text_size(12.5).text_color(t.dim).child(tr("No agent is running.")));
}

function stepTarget(t, form) {
  const news = form.targets.filter((x) => x.kind !== "agent");
  const running = form.targets.filter((x) => x.kind === "agent" && x.address !== form.from);
  // The running agents' list is open when it was opened, or by default when one of them is picked.
  const pickedRunning = running.find((x) => x.id === form.target);
  const open = form.showRunning ?? Boolean(pickedRunning);
  return v_flex().gap(10).child(heading(t, tr("Whom should it ask?")))
    .child(v_flex().gap(6).children(news.map((x) => optionRow(t, `tg-${x.id}`, form.target === x.id, x.who ? avatar(t, x.who, 26) : null, x.name,
      x.kind === "template" ? x.where ?? tr("Role template") : tr("Start a new one"), (_e, cx) => form.choose("target", x.id, cx)))))
    .when(running.length > 0, (el) => el
      // Closed: a chip (the picked agent's, if one is picked) that opens the list; open: its header folds it.
      .when(!open, (x) => x.child(h_flex().gap(6).flex_wrap().child(pickedRunning
        ? chip(t, "tg-running", true, avatar(t, pickedRunning.who, 16), pickedRunning.name, null, (_e, cx) => form.pick("showRunning", true, cx))
        : chip(t, "tg-running", false, null, tr("An agent already running…"), null, (_e, cx) => form.pick("showRunning", true, cx)))))
      .when(open, (x) => x
        .child(h_flex().id("tg-running-head").h(24).px(2).gap(6).items_center().cursor_pointer().text_color(t.dim)
          .hover((y) => y.text_color(t.foreground))
          .on_click((_e, cx) => form.pick("showRunning", false, cx))
          .child(div().flex_1().text_size(11.5).child(tr("Already running")))
          .child(div().text_size(11.5).child(`${tr("Fold")} ▴`)))
        .child(agentPicker(t, form, running, (i) => `agent:${i.address}` === form.target, (i, cx) => form.choose("target", `agent:${i.address}`, cx), "to-"))));
}

function stepKind(t, form) {
  return v_flex().gap(10).child(heading(t, tr("What kind of request?")))
    .child(v_flex().gap(6).children(KINDS.map((k) => optionRow(t, `kd-${k.id}`, form.kind === k.id, null, tr(k.label), tr(KIND_ABOUT[k.id]), (_e, cx) => form.choose("kind", k.id, cx)))));
}

// What was chosen, in one line; each part goes back to its step.
function summary(t, form) {
  const from = form.senders.find((a) => a.address === form.from);
  const target = form.targets.find((x) => x.id === form.target);
  const kind = KINDS.find((k) => k.id === form.kind) ?? KINDS[0];
  const part = (id, n, picture, label) => chip(t, id, false, picture, label, null, (_e, cx) => form.go(n, cx));
  return h_flex().gap(5).items_center().flex_wrap()
    .child(part("sm-from", 1, from ? avatar(t, from.who, 16) : null, from?.label ?? "?"))
    .child(div().text_color(t.dim).child("→"))
    .child(part("sm-target", 2, target?.who ? avatar(t, target.who, 16) : null, target?.name ?? "?"))
    .child(div().text_color(t.dim).child("·"))
    .child(part("sm-kind", 3, null, tr(kind.label)));
}

function stepWrite(t, form) {
  const kind = KINDS.find((k) => k.id === form.kind) ?? KINDS[0];
  return v_flex().gap(10).child(heading(t, tr(kind.hint)))
    .child(summary(t, form))
    .child(div().px(10).py(8).rounded(8).border_1().border_color(t.input).bg(t.background).text_size(13.5).child(Textarea.new(form.area)))
    .when(Boolean(form.error), (el) => el.child(div().whitespace_normal().text_size(12.5).text_color(t.blocked).child(form.error)))
    .child(div().whitespace_normal().text_size(12).text_color(t.dim).child(tr("The agent is told how to start or reach the other one, how the answer comes back, and to sum it up for you.")));
}

// `form`: { step, from, target, kind, error, area, space (the one in view), showRunning, open, machine ({ [list]: machine tab }),
//           spaces: [{id, name, machine}], senders: [{address, label, space, status, focused, who}],
//           targets: [{id, kind, name, who?, ...as a sender}],
//           pick(field, value, cx) and choose(field, value, cx): set a value, the step stays,
//           go(step, cx), back(cx), toggle(key, open, cx), send(cx), close(cx) }
export function askForm(t, form) {
  const last = form.step === STEPS.length;
  const ready = form.step === 1 ? Boolean(form.from) : form.step === 2 ? Boolean(form.target) : true;
  const body = [stepAgent, stepTarget, stepKind, stepWrite][form.step - 1](t, form);
  const button = (id, label, go, on) => div().id(id).h(40).flex().items_center().justify_center().rounded(10).text_size(14).font_semibold()
    .when(on, (el) => el.bg(t.accent).text_color(inkOn(t.accent)).cursor_pointer().hover((x) => x.opacity(0.88)).on_click(go))
    .when(!on, (el) => el.bg(t.raised).text_color(t.dim))
    .child(label);
  return v_flex().size_full().min_h(0)
    .child(h_flex().h(40).flex_none().px(8).gap(6).items_center()
      .child(div().id("ask-back").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_size(16).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => form.back(cx)).child("‹"))
      .child(div().flex_1().text_size(14.5).font_bold().text_color(t.foreground).child(tr("Agent request")))
      .child(div().id("ask-close").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_size(14).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tr("Close")).on_click((_e, cx) => form.close(cx)).child("✕")))
    .child(stepper(t, form))
    .child(v_flex().id("ask-body").flex_1().min_h(0).px(12).py(10).overflow_y_scrollbar().child(body))
    .child(div().flex_none().px(12).pt(6).pb(12)
      .child(last ? button("ask-send", tr("Send"), (_e, cx) => form.send(cx), true) : button("ask-next", `${tr("Next")}  ›`, (_e, cx) => form.next(cx), ready)));
}
