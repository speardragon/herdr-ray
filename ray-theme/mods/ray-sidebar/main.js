// The ray-theme sidebar: spaces with their agents under them, one machine at a
// time. From the top: a tab per machine (once one isn't this computer), a
// "Spaces" line with search and the agents' sort, then each space (avatar,
// name, what's unusual about its git, a chevron that folds its agents) with its
// agents hanging under it, and "New space" at the end.
// A space: click to switch, right-click for its menu, drag to reorder.
// An agent: click to focus it; on hover, the pin marks it with a color (agent-color.js).
// The same mod draws its own overlays, by props: { sortMenu } the sort popup,
// { colorMenu: address } an agent's color palette,
// { spaceMenu: id } a space's right-click menu, { logo: id } its logo editor.
// Built from the stock spaces and agents mods (git.js, machines.js, agents.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, terminals, focused, run, openOverlay, closeOverlay, theme, shared, setShared, setAgentOrder, props, window, layout } from "herdr";
import { Git, where } from "./git.js";
import { Machines } from "./machines.js";
import { AgentTimes, SORTS, RANK, names, tree, kidStatus, statusMark } from "./agents.js";
import { agentRow, subRow, termRow, tabBox, ROW_H } from "./agent-rows.js";
import { colorMenu } from "./agent-color.js";
import { SpaceMenu } from "./space-menu.js";
import { LogoEditor } from "./logo-editor.js";
import { avatar } from "./logo.js";
import { tr } from "./i18n/i18n.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Back from the rail to the width it had.
function unfoldSidebar() {
  setShared("sidebar.collapsed", false);
  run("layout.resize", { id: "sidebar", px: shared("sidebar.width") ?? 268 });
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

// A space's color, as a fill for its letter.
function fillOf(t, id) {
  const color = (shared("space.colors") ?? {})[id] ?? "ansi6";
  return color.startsWith("#") ? color : (MARK[color] ?? t[color]);
}

const AVATAR_X = 17; // the middle of a space's avatar, where its agents' line runs
const NESTED_X = 36; // the same for a worktree space, drawn indented

const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const load = (key, fallback) => JSON.parse(localStorage.getItem(key) ?? fallback);

export default class Sidebar extends View {
  init(_props, cx) {
    const p = props();
    if (p?.sortMenu || p?.colorMenu) return;
    if (p?.spaceMenu) { this.menu = new SpaceMenu(p.spaceMenu, cx); return; }
    if (p?.logo) { this.editor = new LogoEditor(p.logo, cx); return; }
    this.git = new Git();
    this.machines = new Machines();
    this.times = new AgentTimes();
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.hovered = null;
    this.foldedSpaces = new Set(load("spaces.folded", "[]"));
    this.foldedAgents = new Set();
    this.tab = load("machine.tab", "null"); // the machine shown; null: this computer
    this.activeOn = undefined; // the active space's machine at the last look
    this.machines.refresh(cx);
    cx.timer.every(15000, (cx) => this.machines.refresh(cx));
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.timer.every(30000, (cx) => cx.notify()); // the agents' "5m" grow
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.git.due(now, sp, panes(), (m) => m === this.tab);
    if (due.size) this.git.refresh(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  showMachine(name) {
    this.tab = name;
    localStorage.setItem("machine.tab", JSON.stringify(name));
  }

  toggleSpace(id) {
    this.foldedSpaces.has(id) ? this.foldedSpaces.delete(id) : this.foldedSpaces.add(id);
    localStorage.setItem("spaces.folded", JSON.stringify([...this.foldedSpaces]));
  }

  toggleAgent(address) {
    this.foldedAgents.has(address) ? this.foldedAgents.delete(address) : this.foldedAgents.add(address);
  }

  // Every space gets a color the fewest others have; colors of gone spaces go.
  assignColors(sp) {
    const before = shared("space.colors") ?? {};
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(before).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(before).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = PALETTE.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const info = this.git.info;
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in info || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: info[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: false });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      out.push(...list.filter((k) => nested(k) && k.g.repo === r.g.repo).map((k) => ({ ...k, tree: true })));
    }
    return out;
  }

  // The agents, in the order shown: by space, then by the sort.
  // -> { bySpace: Map space id -> agents, listed: Map address -> status, all: terminals() }
  agentsBySpace(sp) {
    const list = agents();
    const all = terminals();
    const listed = new Map(list.map((a) => [a.address, a.status]));
    const now = Date.now();
    this.times.track(list, now);
    this.times.hold(list);
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.times.rank(a), ...tree(all, a.address).map((s) => RANK[kidStatus(s.t, listed)] ?? 0))]));
    const byPriority = sortOf().id === "priority";
    const order = (x, y) => (byPriority ? urgency.get(y.address) - urgency.get(x.address) || this.times.since(y) - this.times.since(x) || y.seq - x.seq : 0);
    // Agents of one tab stay together, where the first of them sorts.
    const together = (arr) => [...new Set(arr.map((a) => a.tab))].flatMap((tab) => arr.filter((a) => a.tab === tab));
    const bySpace = new Map(sp.map((s) => [s.id, together(list.filter((a) => a.space === s.id).sort(order))]));
    const placed = new Set([...bySpace.values()].flat().map((a) => a.address));
    setAgentOrder([...[...bySpace.values()].flat(), ...list.filter((a) => !placed.has(a.address))].map((a) => a.address));
    // The terminals that run no agent, by space, in pane order.
    const taken = new Set(list.map((a) => a.pane));
    const ps = panes().filter((p) => p.terminal && !p.program?.agent && !taken.has(p.pane));
    const terms = new Map(sp.map((s) => {
      const tabs = new Set((s.tabs ?? []).map((x) => x.id));
      return [s.id, ps.filter((p) => tabs.has(p.tab))];
    }));
    return { bySpace, terms, listed, all, now, labels: names(list, sp.flatMap((s) => s.tabs ?? [])) };
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex().w_full().p(5).bg(t.popover).text_size(14.5)
      .child(div().px(8).pt(4).pb(6).text_size(12.5).text_color(t.dim).child(tr("Sort agents")))
      .children(SORTS.map((s) => h_flex().id(`sort-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(tr(s.label)))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  // One tab per machine; the one not shown says when an agent there needs you.
  machineTabs(t, machineNames) {
    const waiting = new Set(agents().filter((a) => a.status === "blocked").map((a) => (a.address.includes("/") ? a.address.split("/")[0] : null)));
    return h_flex().flex_none().mx(12).mt(4).mb(6).p(2).h(34).rounded(17).border_1().border_color(t.border)
      .children(machineNames.map((m) => {
        const on = m === this.tab;
        const connected = !m || this.machines.get(m)?.state === "connected";
        const mark = m === null ? "mods/workspace-chrome/monitor.svg" : m === "home" ? "mods/ray-sidebar/home.svg" : "mods/workspace-chrome/server.svg";
        return h_flex().id(`machine-tab-${m ?? "local"}`).flex_1().min_w(0).h_full().px(8).gap(7).rounded(15).items_center().justify_center()
          .text_size(13.5).cursor_pointer()
          .when(on, (el) => el.bg(t.raised).text_color(t.foreground))
          .when(!on, (el) => el.text_color(connected ? t.muted : t.dim).hover((s) => s.text_color(t.foreground)))
          .on_click((_e, cx) => { this.showMachine(m); cx.notify(); })
          .child(svg(mark).size(14).flex_none())
          .child(div().min_w(0).truncate().child(m ?? tr("This computer")))
          .when(!on && waiting.has(m), (el) => el.child(div().size(6).rounded(3).flex_none().bg(t.blocked)));
      }));
  }

  // What's wrong with a machine that isn't connected, and a way back to one
  // that was rebuilt; null when all is well.
  machineState(t, m) {
    const repair = this.machines.reconnecting[m];
    const machine = this.machines.get(m);
    const rebuilt = this.machines.rebuilt(machine) || Boolean(repair);
    if (!m || (machine?.state === "connected" && !rebuilt)) return null;
    return h_flex().id(`machine-state-${m}`).h(28).flex_none().px(8).gap(6).items_center().text_size(13).text_color(t.dim)
      .child(div().size(6).rounded(3).flex_none().bg(t.dim))
      .when(!rebuilt, (el) => el.child(div().flex_1().truncate().child(tr((machine?.state ?? "asleep").replace(/_/g, " ")))))
      .when(rebuilt, (el) => el
        .child(div().flex_1().min_w(0).truncate().child(repair?.error || tr("rebuilt ·")))
        .child(div().id(`machine-connect-${m}`).flex_none().cursor_pointer().text_color(repair?.error ? t.blocked : t.muted)
          .hover((s) => s.text_color(t.foreground))
          .tooltip(repair?.error || tr("This machine was rebuilt or replaced. Click to connect to the new one."))
          .on_click((_e, cx) => this.machines.reconnect(machine, cx))
          .child(tr(repair?.busy ? "Connecting…" : "Connect"))));
  }

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo or
  // branch goes when the name already says it (a worktree is named after its
  // branch), and master/main go: nearly every space is on one.
  gitTail(g, nested, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = nested || same(g.name) ? "" : g.name;
    const text = [repo, branch].filter(Boolean).join(" · ");
    return h_flex().flex_1().min_w(0).gap(5).justify_end().items_center().text_size(13).text_color(t.dim)
      .when(Boolean(text), (el) => el.child(div().min_w(0).truncate().child(text)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)));
  }

  // The chevron that folds a space's agents; folded, it says how many there
  // are and the most urgent state among them.
  spaceFold(t, w, mine, terms) {
    const open = !this.foldedSpaces.has(w.id);
    const top = mine.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
    return h_flex().id(`space-fold-${w.id}`).flex_none().h(22).px(3).gap(4).items_center().rounded(5).text_size(12.5).text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggleSpace(w.id);
        cx.notify();
      })
      .when(!open, (el) => el
        .when(Boolean(top) && top !== "idle", (x) => x.child(statusMark(t, top, true)))
        .child(String(mine.length + terms.length)))
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(13).flex_none());
  }

  release(ag, cx) {
    const from = this.pressed;
    const over = this.over;
    this.pressed = null;
    this.over = null;
    const source = from === null ? null : spaces()[from];
    if (!source) return;
    if (over !== null && over !== from) run("space.move", { id: source.id, index: over + 1 });
    // A click folds or unfolds the space's agents; a space with none to
    // fold is gone to instead (its agents' rows are how you go to one).
    else if (over === from && (ag.bySpace.get(source.id) ?? []).length > 0) this.toggleSpace(source.id);
    else if (over === from) run("space.select", { id: source.id });
    cx.notify();
  }

  // A space's own line. Pressing it starts a drag (see spaceGroup, which takes
  // the drop); right-click opens its menu.
  spaceRow({ w, i, g, tree: nested }, t, mine, terms) {
    const on = w.active;
    return v_flex().id(`space-${w.id}`).px(8).h(nested ? 28 : 32).flex_none().justify_center().rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      // A popup is as tall as its items; height is only the most.
      .on_mouse_down("right", () => openOverlay({ mod: "ray-sidebar", kind: "popup", width: 200, height: 300, props: { spaceMenu: w.id } }))
      .child(h_flex().gap(9).items_center()
        .when(nested, (el) => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).flex_none().text_color(t.dim)))
        .when(!nested, (el) => el.child(avatar(w, 18, fillOf(t, w.id))))
        .child(div().flex_shrink(0).max_w(140).truncate().text_color(t.foreground).child(w.name))
        .child(g ? this.gitTail(g, nested, w.name, t) : div().flex_1())
        .when(mine.length + terms.length > 0, (el) => el.child(this.spaceFold(t, w, mine, terms))));
  }

  // The rows under a space: its agents and their sub-agents, unless folded.
  agentRows(r, t, ag, mine, terms, shown) {
    if (!(mine.length + terms.length) || this.foldedSpaces.has(r.w.id)) return [];
    const x = r.tree ? NESTED_X : AVATAR_X;
    // By tab: agents first (they come together), then the tab's terminals.
    const groups = [];
    const of = (tab) => groups.find((g) => g.tab === tab) ?? groups[groups.push({ tab, agents: [], terms: [] }) - 1];
    for (const a of mine) of(a.tab).agents.push(a);
    for (const p of terms) of(p.tab).terms.push(p);
    return groups.flatMap((g, n) => {
      const last = n === groups.length - 1;
      const boxed = g.agents.length + g.terms.length > 1;
      const rows = [];
      g.agents.forEach((a, k) => {
        const end = last && k === g.agents.length - 1 && !g.terms.length;
        const subs = tree(ag.all, a.address);
        rows.push({ h: ROW_H.agent, el: agentRow(this, t, a, { x, boxed, last: end, name: ag.labels.get(a.address), subs, listed: ag.listed, since: this.times.since(a), now: ag.now }) });
        if (this.foldedAgents.has(a.address)) return;
        for (const s of subs) rows.push({ h: ROW_H.sub, el: subRow(t, s, { x, boxed, through: !end, listed: ag.listed, shown }) });
      });
      g.terms.forEach((p, k) => rows.push({ h: ROW_H.term, el: termRow(t, p, { x, boxed, last: last && k === g.terms.length - 1 }) }));
      return boxed ? [tabBox(t, x, `${r.w.id}-${g.tab}`, rows, last)] : rows.map((row) => row.el);
    });
  }

  // A space with its agents, as one block: a space dragged by its line is
  // dropped anywhere on another space's block (its agents' rows too) and goes
  // there with its agents (the drop itself: release()). While dragged the whole block is dimmed, and a line
  // on the block under the pointer shows which side it will land on.
  spaceGroup(r, t, ag, first, shown) {
    const { w, i } = r;
    const mine = ag.bySpace.get(w.id) ?? [];
    const terms = ag.terms.get(w.id) ?? [];
    const dragging = this.pressed !== null && this.over !== this.pressed;
    return v_flex().relative().id(`group-${w.id}`).flex_none()
      .when(!first && !r.tree, (el) => el.mt(8))
      .when(dragging && this.pressed === i, (el) => el.opacity(0.45))
      .when(dragging && this.over === i, (el) => el.child(
        div().absolute().left(0).right(0).h(2).rounded(1).bg(t.accent)
          .when(this.pressed < i, (line) => line.bottom(-3))
          .when(this.pressed > i, (line) => line.top(-3)),
      ))
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null) return;
        const source = spaces()[this.pressed];
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? i : null;
        if (this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .child(this.spaceRow(r, t, mine, terms))
      .children(this.agentRows(r, t, ag, mine, terms, shown));
  }

  // The rail: a number per space and per agent, each with its state.
  rail(t, rows, ag) {
    const line = (id, n, on, mark, go) => h_flex().id(id).h(26).flex_none().px(6).gap(4).items_center().justify_center()
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(go)
      .child(div().text_color(on ? t.foreground : t.muted).child(String(n)))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(mark));
    const dot = (status) => div().text_color(t[status] ?? t.unknown).child(status === "blocked" || status === "done" ? "●" : "·");
    const mine = rows.flatMap((r) => ag.bySpace.get(r.w.id) ?? []);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(15)
      .child(v_flex().id("rail").flex_1().min_h(0).overflow_y_scrollbar()
        .children(rows.map((r) => line(`space-${r.w.id}`, r.i + 1, r.w.active, dot(r.w.status), () => run("space.select", { id: r.w.id }))))
        .child(div().h(1).flex_none().my(6).bg(t.border))
        .children(mine.map((a, n) => line(`ag-${a.address}`, n + 1, a.focused, statusMark(t, a.status, true), () => run("pane.focus", { pane: a.pane })))))
      .child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("unfold").text_size(15).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(unfoldSidebar).child("»")));
  }

  headButton(t, id, mark, tip, go) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip)
      .on_click(go)
      .child(svg(mark).size(15));
  }

  render() {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    if (props()?.colorMenu) return colorMenu(t, props().colorMenu);
    if (this.menu) return this.menu.render(t);
    if (this.editor) return this.editor.render(t, fillOf(t, this.editor.id));
    const sp = spaces();
    this.assignColors(sp);
    const machineNames = this.machines.names(sp.map((s) => s.machine));
    // The shown machine follows the active space to another machine.
    const activeOn = sp.find((s) => s.active)?.machine ?? null;
    // (The first look only notes where it is: the tab kept from last time stays.)
    if (activeOn !== this.activeOn) {
      if (this.activeOn !== undefined) this.showMachine(activeOn);
      this.activeOn = activeOn;
    }
    if (!machineNames.includes(this.tab)) this.showMachine(null);
    const m = this.tab;
    const rows = this.ordered().filter((r) => (r.w.machine ?? null) === m);
    const ag = this.agentsBySpace(sp);
    if (narrow()) return this.rail(t, rows, ag);

    const state = this.machineState(t, m);
    const live = machines().find((k) => k.name === m)?.layout;
    const loading = live === "loading" || (m && !live && this.machines.get(m)?.state === "connected")
      || sp.some((s) => (s.machine ?? null) === m && !this.shown.has(s.id));
    const shown = focused()?.agent;
    const sort = sortOf();
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(15)
      .when(machineNames.length > 1, (el) => el.child(this.machineTabs(t, machineNames)))
      .child(h_flex().h(34).flex_none().pl(16).pr(10).gap(2).items_center().text_size(13).text_color(t.dim)
        .child(div().flex_1().child(tr("Spaces")))
        .child(this.headButton(t, "search", "mods/workspace-chrome/search.svg", tr("Search"), () => run("mod.open", { name: "ray-picker" })))
        .child(this.headButton(t, "ag-sort", "mods/ray-sidebar/sort.svg", tr("Sort agents: {sort}", { sort: tr(sort.label) }),
          () => openOverlay({ mod: "ray-sidebar", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))))
      .child(v_flex().id("sidebar-list").flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        // Letting go, anywhere in the list, ends a press on a space's line:
        // over another space's block it moves there; over its own it was a
        // click. Handled here, once, and not on each block: which of two
        // nested elements hears the release first isn't something to rely on.
        .on_mouse_up("left", (_e, cx) => this.release(ag, cx))
        .when(Boolean(state), (el) => el.child(state))
        .when(loading && !rows.length, (el) => el.child(div().h(28).flex_none().px(8).text_size(14).text_color(t.dim).child(tr("Loading…"))))
        .children(rows.map((r, n) => this.spaceGroup(r, t, ag, n === 0, shown)))
        .when(!state, (el) => el.child(h_flex().id("space-new").h(30).flex_none().mt(8).px(8).gap(11).items_center().rounded(8)
          .text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new", m ? { machine: m } : {}))
          .child(h_flex().size(18).flex_none().items_center().justify_center().child(svg("mods/workspace-chrome/plus.svg").size(13)))
          .child(tr("New space")))));
  }
}
