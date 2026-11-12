// What the sidebar knows of agents, taken from the stock agents mod: how an
// agent is named, how urgent it is, since when it has been in its state, its
// sub-agents, and the mark that shows its status.

import { div, image, svg } from "gpui-kit";
import { panes } from "herdr";
import { tr } from "./i18n/i18n.js";

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Tab order", icon: "layers" },
];

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

// A tab's name, or its agent's own title when nobody named the tab.
function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

// address -> the name an agent's row shows under its space: a tab someone
// named or the agent's own title; for an automatic tab number, the program.
export function names(list, tabs) {
  const all = panes();
  const label = (a) => {
    const tab = tabs.find((x) => x.id === a.tab);
    return tab ? title(tab, lead(tab, all)) : a.title || a.program?.name || "";
  };
  return new Map(list.map((a) => {
    const l = label(a);
    return [a.address, /^\d+$/.test(l) ? a.program?.name || l : l];
  }));
}

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
export function kidStatus(k, listed) {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
}

// Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
export function tree(all, addr, before = []) {
  const kids = all.filter((k) => k.parent === addr && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...before, last ? "└" : "├"] },
      ...tree(all, k.address, [...before, last ? "" : "│"]),
    ];
  });
}

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return tr("<1m");
  if (m < 60) return tr("{n}m", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? tr("{n}h", { n: h }) : tr("{n}d", { n: Math.floor(h / 24) });
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
export function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Working: a spinner; blocked: "Needs you" (compact: a !); idle: a ring; done: a dot.
export function statusMark(t, status, compact = false) {
  const color = t[status] ?? t.dim;
  if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(12).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(12).font_semibold().text_color(t.blocked).flex().items_center().child(tr("Needs you"));
  if (status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(status === "done" ? color : t.dim + "00");
}

// Each agent's last state and when it changed (ms), kept across restarts, and
// the done agent being looked at.
export class AgentTimes {
  constructor() {
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.held = null;
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it keeps done's rank until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }
}
