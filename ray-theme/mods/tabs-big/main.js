import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, nextCommand } from "herdr";
import { tr } from "./i18n/i18n.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
const DARK_INK = "#111418";

// The text color on a colored square: white or near-black, whichever reads better
// (white on a light color such as yellow or cyan is hard to read).
function inkOn(fill) {
  if (!/^#[0-9a-f]{6}/i.test(fill ?? "")) return "#ffffff";
  const l = luminance(fill);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0566 ? "#ffffff" : DARK_INK;
}

// ray-theme's own side panels: a button shows for each one the layout has
// (a "panel-body" child with that id), so removing a block removes its button.
// `needs`: a shared flag its mod sets false when it can't work here.
// `count`: a shared number its mod keeps, shown as a badge when above zero (unread messages).
const RAY_PANELS = [
  { id: "prs", label: "PRs", icon: "mods/ray-prs/pr.svg" },
  { id: "sessions", label: "Sessions", icon: "mods/ray-sessions/history.svg" },
  { id: "notes", label: "Notes", icon: "mods/ray-notes/note.svg" },
  { id: "chat", label: "Chat", icon: "mods/ray-chat/chat.svg", count: "ray.chat.unread" },
  { id: "mods", label: "Mods", icon: "mods/ray-mods/mods.svg", count: "ray.mods.updates" },
];

// Cmd+Alt+<letter> opens a side panel (keys.json: "tabs-big.<panel id>"); the same key closes it.
// With Shift (or a Shift+click) it goes to the bottom half ("tabs-big.low-<panel id>"):
// the layout's "panel-low" stack, which holds a second block "low-<id>" for each panel.
const PANEL_KEY = { files: "F", changes: "G", prs: "P", sessions: "S", notes: "M", chat: "C", mods: "E" };

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.enabled = [];
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.lows = JSON.parse(localStorage.getItem("panels-low") ?? "{}");
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand(), toLow = command.startsWith("low-"), id = toLow ? command.slice(4) : command;
        if (this.enabled.includes(id)) this.togglePanel(id, toLow);
      }
    });
  }

  // What shows now: `top` and `bottom` are panel ids (null: that half is closed).
  panelState(root = layout()) {
    const panel = find(root, "panel"), body = find(panel, "panel-body"), low = find(panel, "panel-low");
    const open = Boolean(panel) && !panel.hidden;
    return { panel, body, low, top: open ? body?.active ?? null : null,
      bottom: open && low && !low.hidden ? low.active?.replace(/^low-/, "") ?? null : null };
  }

  // A click or key on a panel's button. A panel shows in one half only: asking for
  // it in the other half swaps the two (or does nothing when there is nothing to swap with).
  togglePanel(id, toLow = false) {
    const { body, low, top, bottom } = this.panelState();
    const setTop = (x) => { run("layout.select", { stack: "panel-body", child: x }); run("layout.show", { id: "panel" }); };
    const setLow = (x) => { run("layout.select", { stack: "panel-low", child: `low-${x}` }); run("layout.show", { id: "panel-low" }); };
    const closeLow = () => { if (low && !low.hidden) run("layout.hide", { id: "panel-low" }); };
    if (toLow && find(low, `low-${id}`) && !(top === null && body?.active === id)) {
      if (bottom === id) closeLow();
      else if (top === id) { if (bottom) { setTop(bottom); setLow(id); } }
      else { setLow(id); if (top === null) run("layout.show", { id: "panel" }); }
    } else if (top === id) { run("layout.hide", { id: "panel" }); closeLow(); }
    else {
      if (bottom === id) { if (top) setLow(top); else closeLow(); }
      setTop(id);
    }
  }

  // The bottom half is remembered per space too, the same way as the top (below).
  syncLow(space, low, enabled) {
    if (!space || !low) return;
    const now = low.hidden ? null : low.active?.replace(/^low-/, "") ?? null;
    if (space.id !== this.lowSpace) {
      const first = this.lowSpace === undefined;
      this.lowSpace = space.id; this.lowPending = null;
      if (!(first && !(space.id in this.lows))) {
        const stored = this.lows[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.lowPending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-low", child: `low-${want}` }); run("layout.show", { id: "panel-low" }); }
          else run("layout.hide", { id: "panel-low" });
          return;
        }
      }
    }
    if (this.lowPending) {
      if (this.lowPending.want !== now && Date.now() < this.lowPending.until) return;
      this.lowPending = null;
    }
    if (this.lows[space.id] === now) return;
    this.lows[space.id] = now;
    localStorage.setItem("panels-low", JSON.stringify(this.lows));
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? tr("Terminal") : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(14.5)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const ray = RAY_PANELS.filter((p) => find(body, p.id) && !find(body, p.id).hidden && (!p.needs || shared(p.needs) !== false));
    const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), ...ray.map((p) => p.id)];
    this.enabled = enabled;
    this.syncPanel(space, panel, body, enabled);
    const { low, top, bottom } = this.panelState(root);
    this.syncLow(space, low, enabled);
    // A panel that opened itself on top while it was in the bottom half: the bottom closes.
    if (top && top === bottom) run("layout.hide", { id: "panel-low" });
    const panelButton = (id, label, icon, count = 0) => {
      const on = top === id, onLow = bottom === id && !on;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(14).bg(on || onLow ? t.selected : t.chrome).text_color(on || onLow ? t.foreground : t.muted)
        .when(onLow, (el) => el.border_b(2).border_color(t.accent))
        .hover(s => s.bg(t.hover)).on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.shift = Boolean(e.modifiers?.shift); })
        .on_click((e) => this.togglePanel(id, e?.modifiers?.shift ?? this.shift)).child(svg(icon).size(14)).child(label)
        .when(Boolean(PANEL_KEY[id]), (el) => el.child(div().text_size(11).text_color(t.dim).child(`(${PANEL_KEY[id]})`)))
        .when(count > 0, (el) => el.child(div().flex_none().px(5).h(16).min_w(16).flex().items_center().justify_center().rounded(8).bg(t.blocked)
          .text_size(11).font_bold().text_color(inkOn(t.blocked)).child(count > 99 ? "99+" : String(count))));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", tr("Files"), "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", tr("Changes"), "mods/changes/changes.svg")))
      .children(ray.map((p) => panelButton(p.id, tr(p.label), p.icon, p.count ? Number(shared(p.count)) || 0 : 0)))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-big/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-big/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-big/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
