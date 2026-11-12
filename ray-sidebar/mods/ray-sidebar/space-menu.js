// A space's right-click menu: the stock menu's items for a space (rename,
// worktrees, close) and "Edit logo". ↑/↓ move, Enter runs, Esc closes.
// Owned by the Sidebar copy the popup starts (see main.js), which draws it.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, keys, spaces, panes, exec } from "herdr";
import { tr } from "./i18n/i18n.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

const worktree = (space, action) => () => openOverlay({
  mod: "worktree", kind: "dialog", ...(action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: { space, action },
});

export const LOGO_DIALOG = { width: 400, height: 430 };

// [label, icon (a stock one's name, or a path), what it does, the command its shortcut is shown for]
function items(id, git) {
  return [
    ["Rename", "square-pen", () => run("space.rename", { id }), "space.rename"],
    ["Edit logo", "mods/ray-sidebar/smile.svg", () => openOverlay({ mod: "ray-sidebar", kind: "dialog", ...LOGO_DIALOG, props: { logo: id } })],
    ...(git ? [["New worktree", "git-branch", worktree(id, "new")], ["Open worktree", "git-branch", worktree(id, "open")]] : []),
    ...(git === "linked" ? [["Remove worktree", "git-branch", worktree(id, "remove")]] : []),
    ["Close", "x", () => run("space.close", { id }), "space.close"],
  ];
}

const shortcut = (command) => (command && keys().find((b) => b.section === "global" && b.action === command)?.keys) || "";

export class SpaceMenu {
  constructor(id, cx) {
    this.id = id;
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = spaces().find((s) => s.id === id);
    const folder = space && place(space);
    if (folder) {
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
    }
  }

  choose(item) {
    if (!item) return;
    closeOverlay(props()?.overlay);
    item[2]();
  }

  render(t) {
    const list = items(this.id, this.git);
    return v_flex().id("space-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(14)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(list[this.at]);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.map((it, i) => v_flex()
        .when(it[0] === "Close", (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mi-${i}`).h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
          .when(i === this.at, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.choose(it))
          .child(svg(it[1].includes("/") ? it[1] : `mods/workspace-chrome/${it[1]}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(tr(it[0])))
          .child(div().text_size(11).text_color(t.dim).child(shortcut(it[3]))))));
  }
}
