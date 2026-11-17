// The focus border: a side panel shows the accent border (as the focused terminal pane
// does) after a press inside it, until a press anywhere else or the focus moving on.
// No listener hears "a press inside, whatever child took it", so two "press outside"
// listeners are compared: the probe's (a 1px dot: every press is outside it) and the
// panel's own (only presses outside the panel). Probe without panel = a press inside.
import { div } from "gpui-kit";
import { theme, focused } from "herdr";

const at = () => { const f = focused(); return `${f?.pane ?? ""}|${f?.terminal ?? ""}`; };

function settle(view, cx) {
  if (view.ringWait) return;
  view.ringWait = true;
  cx.timer.after(20, (cx) => {
    view.ringWait = false;
    const on = Boolean(view.ringAny) && !view.ringOut;
    view.ringAny = view.ringOut = false;
    view.ringAt = on ? at() : null;
    if (on !== Boolean(view.ringOn)) { view.ringOn = on; cx.notify(); }
  });
}

/** The border color now: the accent while this panel has the focus, else `idle`. */
export const ringColor = (view, idle) => view.ringOn && view.ringAt === at() ? theme().accent : idle;
/** For the panel root's on_mouse_down_out. */
export const ringOut = (view) => (_e, cx) => { view.ringOut = true; settle(view, cx); };
/** A child of the panel root. */
export const ringProbe = (view) => div().absolute().top(0).left(0).size(1).on_mouse_down_out((_e, cx) => { view.ringAny = true; settle(view, cx); });
