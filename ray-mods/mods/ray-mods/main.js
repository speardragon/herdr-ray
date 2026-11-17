// Mods: the mods installed in this app, in a side panel. For each: what it is,
// where the shown layout and keys.json use it, where it comes from; and
// update (from its GitHub repository), turn off / on, remove.
// Herdr has no switch for a mod, so "off" hides its blocks in the shown layout
// and puts its keys away (both kept in the registry and put back by "on").
// Removing moves the folder aside (.install-spare/); updating keeps the old
// one aside and puts it back if the new one doesn't load.
// Inventory: inventory.js. What is done: actions.js and ops.sh. Memory: registry.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay } from "herdr";
import { inventory } from "./inventory.js";
import { fingerprint, latest, link, off, on, openFolder, remove, unlink, upgrade } from "./actions.js";
import { list } from "./list.js";
import { detail } from "./detail.js";
import { tr } from "./i18n/i18n.js";
import { ringColor, ringOut, ringProbe } from "./focus-ring.js";

const UPDATES = "ray.mods.updates"; // how many mods have an update (the panel button's badge)
const CONFIRM_MS = 4000;
const CHECK_MS = 6 * 3600_000; // updates are looked for every 6 hours, and on "Check all"

export default class Mods extends View {
  init(_props, cx) {
    this.items = [];
    this.loading = true;
    this.error = null;
    this.sel = null;
    this.checks = {}; // name -> { state: checking | update | latest | unknown | error, latest, changed, error }
    this.busy = {};
    this.notice = null; // { name, ok, text }
    this.confirm = null; // { name, action }
    this.folded = {};
    this.linkInput = InputState.new({ placeholder: "owner/repo" });
    this.reload(cx, true);
    cx.timer.every(CHECK_MS, (cx) => this.checkAll(cx));
  }

  reload(cx, thenCheck = false) {
    cx.spawn(async (cx) => {
      try {
        this.items = await inventory();
        this.error = null;
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      this.loading = false;
      cx.notify();
      if (thenCheck) this.checkAll(cx);
    });
  }

  item(name) {
    return this.items.find((i) => i.name === name) ?? null;
  }

  publish() {
    const n = Object.values(this.checks).filter((c) => c.state === "update").length;
    if ((shared(UPDATES) ?? 0) !== n) setShared(UPDATES, n);
  }

  // Asks GitHub for the newest commit of one mod's folder, and whether its files changed here.
  async look(name) {
    const item = this.item(name);
    if (!item?.source) return;
    this.checks = { ...this.checks, [name]: { ...(this.checks[name] ?? {}), state: "checking" } };
    const head = await latest(item.source);
    const now = item.source.fingerprint && item.kind !== "missing" ? await fingerprint(name) : null;
    const changed = Boolean(now && now !== item.source.fingerprint);
    const state = head.error ? "error" : item.kind === "missing" || (item.source.commit && head.sha !== item.source.commit) ? "update" : item.source.commit ? "latest" : "unknown";
    this.checks = { ...this.checks, [name]: { state, latest: head.error ? null : head, error: head.error ?? null, changed } };
  }

  check(name, cx) {
    cx.spawn(async (cx) => {
      await this.look(name).catch(() => null);
      this.publish();
      cx.notify();
    });
    cx.notify();
  }

  checkAll(cx) {
    cx.spawn(async (cx) => {
      for (const i of this.items.filter((x) => x.source)) {
        await this.look(i.name).catch(() => null);
        cx.notify();
      }
      this.publish();
      cx.notify();
    });
  }

  // A press that changes something: off and remove (and an update over changed or
  // unknown files) need a second press within a few seconds.
  needsConfirm(item, action) {
    const c = this.checks[item.name];
    if (action === "off" || action === "remove") return true;
    if (action === "update") return item.kind !== "missing" && (Boolean(c?.changed) || !item.source?.commit);
    return false;
  }

  act(name, action, cx) {
    const item = this.item(name);
    if (!item || this.busy[name]) return;
    if (action === "folder") { openFolder(name); return; }
    if (this.needsConfirm(item, action) && !(this.confirm?.name === name && this.confirm?.action === action)) {
      this.confirm = { name, action };
      cx.timer.after(CONFIRM_MS, (cx) => { if (this.confirm?.name === name && this.confirm?.action === action) { this.confirm = null; cx.notify(); } });
      cx.notify();
      return;
    }
    this.confirm = null;
    this.busy = { ...this.busy, [name]: action };
    this.notice = null;
    cx.notify();
    const work = {
      update: () => upgrade(item),
      off: () => off(item),
      on: () => on(item),
      remove: () => remove(item),
      link: () => link(name, this.linkInput.value()),
      unlink: () => unlink(name),
    }[action];
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await work();
      } catch (error) {
        result = { ok: false, text: String(error?.message ?? error) };
      }
      const { [name]: _done, ...rest } = this.busy;
      this.busy = rest;
      this.notice = { name, ...result };
      if (result.ok && action === "link") this.linkInput.set_value("");
      if (result.ok && action === "remove") this.sel = null;
      this.items = await inventory().catch(() => this.items);
      if (result.ok && (action === "update" || action === "link")) await this.look(name).catch(() => null);
      if (result.ok && action === "unlink") { const { [name]: _c, ...checks } = this.checks; this.checks = checks; }
      this.publish();
      cx.notify();
    });
  }

  view() {
    return {
      checks: this.checks, busy: this.busy, notice: this.notice, confirm: this.confirm, folded: this.folded, linkInput: this.linkInput,
      choose: (name, cx) => { this.sel = name; this.notice = null; this.confirm = null; cx.notify(); },
      back: (cx) => { this.sel = null; this.confirm = null; cx.notify(); },
      fold: (id, open, cx) => { this.folded = { ...this.folded, [id]: open }; cx.notify(); },
      act: (name, action, cx) => this.act(name, action, cx),
      check: (name, cx) => this.check(name, cx),
    };
  }

  button(t, id, label, tip, go) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(12).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(go).child(label);
  }

  render() {
    const t = theme();
    const root = v_flex().id("mods").size_full().min_h(0).bg(t.background).text_color(t.foreground).border_1().border_color(ringColor(this, "#00000000")).on_mouse_down_out(ringOut(this)).child(ringProbe(this));
    const item = this.sel ? this.item(this.sel) : null;
    if (item) return root.child(detail(t, item, this.view()));
    const mine = this.items.filter((i) => i.kind !== "shipped" && i.kind !== "missing").length;
    const updates = Object.values(this.checks).filter((c) => c.state === "update").length;
    const checking = Object.values(this.checks).some((c) => c.state === "checking");
    return root
      .child(h_flex().h(40).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(14.5).font_bold().child(tr("Mods")))
        .child(div().flex_1().text_size(12).text_color(t.dim).child(this.loading ? tr("Loading…") : tr("{n} of yours", { n: mine }) + (updates ? ` · ${tr("{n} to update", { n: updates })}` : "")))
        .child(this.button(t, "mods-check", checking ? "…" : tr("Check all"), tr("Look for updates of the linked mods"), (_e, cx) => this.checkAll(cx)))
        .child(this.button(t, "mods-reload", "↻", tr("Read the mods folder again"), (_e, cx) => this.reload(cx)))
        .when(Boolean(props()?.overlay), (el) => el.child(this.button(t, "mods-close", "✕", tr("Close"), () => closeOverlay(props().overlay)))))
      .when(Boolean(this.notice) && !this.sel, (el) => el.child(div().mx(12).mt(8).px(10).py(7).rounded(8).bg(this.notice.ok ? `${t.done}1f` : `${t.blocked}1f`)
        .whitespace_normal().text_size(12.5).text_color(t.foreground).child(`${this.notice.name}: ${this.notice.text}`)))
      .when(Boolean(this.error), (el) => el.child(div().p(12).text_size(12.5).text_color(t.blocked).child(this.error)))
      .child(list(t, this.items, this.view()));
  }
}
