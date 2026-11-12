// Usage limits, for the right end of the status bar: for each provider that
// reports a limit (Claude, Codex), how much of the 5-hour window is used, the
// week's and each model's own weekly limit (Fable). Pressing it opens a popup
// above it with every provider on this computer: Claude, Codex, Antigravity
// and Grok (panel.js). Where the numbers come from: sources.js.
// Two shapes, by props().view: the chip (default) and "panel" (the popup).
// The chip keeps what it read in shared "ray.usage" so the popup opens filled.
// Which providers the chip shows is picked in the popup (a box on each card),
// kept in shared "ray.usage.chip": { [provider id]: boolean }.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, props, shared, setShared, openOverlay } from "herdr";
import { readAll } from "./sources.js";
import { panel, heightOf, labelOf, when, brand, WIDTH } from "./panel.js";
import { tr } from "./i18n/i18n.js";

const POLL_MS = 60_000;
const KEY = "ray.usage";
const AT_KEY = "ray.usage.at";

const CHIP_KEY = "ray.usage.chip";
const CHIP_DEFAULT = { claude: true, codex: true };
const ROOMY = 2; // more providers than this in the chip: icons and percents only

const inChip = (id) => ({ ...CHIP_DEFAULT, ...(shared(CHIP_KEY) ?? {}) })[id] === true;

// A row's name in the chip: "5h" and "1w" in every language, a model's own
// limit by the model's name ("Fable"), a group's by both ("Gemini 5h").
const SHORT = { "5-hour window": "5h", Week: "1w" };
function short(r) {
  const window = SHORT[r.label] ?? (r.label ? tr(r.label) : "");
  if (!r.group) return window;
  return r.key.startsWith("model-") ? r.group : `${r.group} ${window}`.trim();
}

function describe(r) {
  return r.used === null
    ? tr("{name}: no report since its last reset", { name: labelOf(r) })
    : tr("{name}: {pct}% used, resets {at}", { name: labelOf(r), pct: r.used, at: r.resets ? when(r.resets) : "–" });
}

export default class Usage extends View {
  init(_props, cx) {
    // The popup: opened from the chip (view "panel"), or on its own with mod.open (an overlay).
    this.popup = props()?.view === "panel" || Boolean(props()?.overlay);
    this.providers = shared(KEY) ?? [];
    this.at = shared(AT_KEY) ?? null; // when the providers were last read
    this.loading = false;
    this.pressedAt = null;
    cx.timer.every(POLL_MS, (cx) => this.refresh(cx, false));
    // The popup says how many minutes ago things were read.
    if (this.popup) cx.timer.every(15_000, (cx) => cx.notify());
    this.refresh(cx, this.popup);
  }

  refresh(cx, force) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.providers = await readAll(force);
        this.at = Date.now();
        setShared(KEY, this.providers);
        setShared(AT_KEY, this.at);
      } catch {
        // keeps what it had
      }
      this.loading = false;
      cx.notify();
    });
  }

  // A popup opens downward from the pointer and the status bar is the
  // window's bottom edge, so it opens above the press instead.
  open() {
    const height = heightOf(this.providers);
    const p = this.pressedAt;
    openOverlay({
      mod: "ray-usage",
      kind: "popup",
      width: WIDTH,
      height,
      ...(p ? { at: { x: Math.max(8, p.x - WIDTH + 60), y: Math.max(8, p.y - height - 14) } } : {}),
      props: { view: "panel" },
    });
  }

  level(t, used) {
    if (used === null) return t.dim;
    if (used >= 80) return t.blocked;
    if (used >= 50) return t.working;
    return t.foreground;
  }

  // "Claude 5h 72% · 1w 55% · Fable 29%": every row named, the first one's
  // percent colored by how full it is.
  chip(t, p) {
    const pct = (r) => (r.used === null ? "–" : `${r.used}%`);
    return h_flex().flex_none().gap(6).items_center()
      .child(p.tint ? svg(p.icon).size(14).flex_none().text_color(brand(t, p.id)) : image(p.icon).w(14).h(14).flex_none())
      .child(div().text_color(brand(t, p.id)).child(p.name))
      .children(p.rows.map((r, i) => h_flex().gap(4)
        .child(div().text_color(t.dim).child(`${i ? "· " : ""}${short(r)}`))
        .child(div().text_color(i === 0 ? this.level(t, r.used) : r.used === null ? t.dim : r.used >= 80 ? t.blocked : t.foreground).child(pct(r)))));
  }

  // Many providers: just the icon and each row's percent (the tooltip names them).
  compact(t, p) {
    return h_flex().flex_none().gap(5).items_center()
      .child(p.tint ? svg(p.icon).size(14).flex_none().text_color(brand(t, p.id)) : image(p.icon).w(14).h(14).flex_none())
      .children(p.rows.map((r, i) => div().text_color(i === 0 ? this.level(t, r.used) : r.used === null ? t.dim : r.used >= 80 ? t.blocked : t.foreground)
        .child(`${i ? "· " : ""}${r.used === null ? "–" : `${r.used}%`}`)));
  }

  render() {
    const t = theme();
    if (this.popup) {
      const toggle = (id, cx) => {
        setShared(CHIP_KEY, { ...CHIP_DEFAULT, ...(shared(CHIP_KEY) ?? {}), [id]: !inChip(id) });
        cx.notify();
      };
      return panel(t, this.providers, this.loading, (_e, cx) => { this.refresh(cx, true); cx.notify(); }, { on: inChip, toggle }, this.at);
    }
    const limited = this.providers.filter((p) => p.rows.length && inChip(p.id));
    return h_flex()
      .id("usage")
      .size_full()
      .px(14)
      .gap(16)
      .items_center()
      .justify_end()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13.5)
      .text_color(t.muted)
      .when(this.providers.length > 0, (el) => el
        .cursor_pointer()
        .tooltip(limited.flatMap((p) => p.rows.map((r) => `${p.name} ${describe(r)}`)).join("\n") || tr("Usage"))
        .on_mouse_down("left", (e) => { this.pressedAt = e.position; })
        .on_click(() => this.open()))
      .children(limited.map((p) => (limited.length > ROOMY ? this.compact(t, p) : this.chip(t, p))))
      .when(this.providers.length > 0 && !limited.length, (el) => el.child(div().child(tr("Usage"))));
  }
}
