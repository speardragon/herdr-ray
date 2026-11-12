// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.
// ray-theme adds, for a terminal in a git repo on this computer: its branch,
// the branch's PR (number, colored by its checks; click opens it) and the Jira
// issue named in the branch (key and title; click opens it). See devinfo.js.
// A narrow header drops the issue title, then the branch.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { tr } from "./i18n/i18n.js";
import { openUrl } from "./lib/github.js";
import { peek, refresh } from "./devinfo.js";

const INFO_MS = 20_000;
// Jira's brand blue, so the chip reads as Jira at a glance; the title stays
// short (about ten characters): the chip is a link, the tooltip has the rest.
const JIRA_BLUE = "#2684FF";
const ISSUE_TITLE_PX = 140;

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init(_props, cx) {
    this.hovered = false;
    this.width = 0;
    this.infoFor = null;
    cx.timer.every(INFO_MS, (cx) => this.loadInfo(cx));
  }

  // Remote panes (ids with a "machine/" prefix) and mod panes are left out.
  loadInfo(cx) {
    const p = this.me();
    if (!p?.cwd || !p.terminal || p.pane.includes("/")) return;
    cx.spawn(async (cx) => {
      await refresh(p.cwd, p.branch).catch(() => null);
      cx.notify();
    });
  }

  chip(t, id, url, tip) {
    return h_flex().id(id).flex_none().min_w(0).gap(5).items_center().px(5).h(20).rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (url) openUrl(url);
      });
  }

  info(t, p) {
    const { pr, issue } = peek(p.cwd, p.branch);
    const wide = this.width === 0 || this.width >= 720;
    const roomy = this.width === 0 || this.width >= 560;
    const items = [];
    if (p.branch && p.branch !== "HEAD" && roomy) {
      items.push(h_flex().flex_none().min_w(0).max_w(220).gap(4).items_center().text_color(t.dim)
        .child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none())
        .child(div().min_w(0).truncate().child(p.branch)));
    }
    if (pr) {
      const color = { passed: t.done, failed: t.blocked, running: t.working }[pr.checks] ?? t.dim;
      const state = { OPEN: tr("Open"), DRAFT: tr("Draft"), MERGED: tr("Merged"), CLOSED: tr("Closed") }[pr.state] ?? pr.state;
      const checks = { passed: tr("Checks passed"), failed: tr("Checks failed"), running: tr("Checks running") }[pr.checks] ?? tr("No checks");
      items.push(this.chip(t, `pr-${p.pane}`, pr.url, `#${pr.number} ${pr.title} · ${state} · ${checks}`)
        .child(div().size(7).flex_none().rounded(4).bg(color))
        .child(div().text_color(pr.state === "OPEN" ? t.foreground : t.muted).child(`#${pr.number}`)));
    }
    if (issue) {
      items.push(this.chip(t, `issue-${p.pane}`, issue.url, [issue.key, issue.status, issue.title].filter(Boolean).join(" · "))
        .child(svg("mods/pane-big/jira.svg").size(12).flex_none().text_color(JIRA_BLUE))
        .child(div().flex_none().text_color(t.foreground).child(issue.key))
        .when(wide && Boolean(issue.title), (el) => el.flex_shrink(1)
          .child(div().min_w(0).max_w(ISSUE_TITLE_PX).truncate().text_color(t.muted).child(issue.title))));
    }
    return items;
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane-big/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || tr("shell");
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const infoKey = `${p.cwd}|${p.branch}`;
    if (infoKey !== this.infoFor) {
      this.infoFor = infoKey;
      this.loadInfo(cx);
    }
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(14)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd)))
      .children(this.info(t, p))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(12).font_semibold().text_color(t.blocked).child(tr("Needs you"))))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
