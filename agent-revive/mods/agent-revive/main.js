// Agent Revive: when herdr-core loses a terminal and gives its address a new shell (core restart,
// reboot), a "Revive N agents" button shows in the status bar; pressing it resumes the chosen Claude Code
// sessions with `claude --resume`.
// - The status-bar block (id "agent-revive") scans and draws the button; with nothing to revive it is 1px.
// - The popup is this mod's overlay copy; candidates reach it through shared state.
// Snapshot: ~/.config/herdr-app/agent-revive/snapshot.json (outside mods/, so writing it doesn't hot-reload)

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
  appHome, checking, closeOverlay, exec, hc, home, notify, openOverlay, props,
  readTextFile, run, setShared, shared, theme, writeTextFile,
} from "herdr";
import { applyChoice, atPrompt, isSessionId, plan, resumeCommand } from "./plan.js";

const SCAN_MS = 20_000;
const KEY = "agent-revive.candidates";
const BLOCK_ID = "agent-revive"; // the layout's status-bar block: its width follows the button
const BUTTON_PX = 180;
const POPUP_W = 420;
const ROW_H = 44;
const MAX_ROWS = 7; // more rows scroll

async function hcJson(args) {
  const r = await hc([...args, "--json"]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `hc ${args[0]} failed`);
  return JSON.parse(r.stdout);
}

async function getTerm(address) {
  try {
    return await hcJson(["get", address]);
  } catch {
    return null;
  }
}

// Claude keeps ~/.claude/sessions/<pid>.json while it runs. procStart tells it from a stale record of a reused pid.
async function claudeSession(pid) {
  const text = await readTextFile(`${home()}/.claude/sessions/${pid}.json`);
  if (!text) return null;
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return null;
  }
  if (rec.pid !== pid || !isSessionId(rec.sessionId) || !rec.cwd) return null;
  const ps = await exec("env", ["LC_ALL=C", "TZ=UTC", "ps", "-o", "lstart=", "-p", String(pid)], { timeout: 5000 });
  if (ps.code !== 0 || ps.stdout.trim() !== rec.procStart) return null;
  return { sessionId: rec.sessionId, cwd: rec.cwd };
}

// A session with no message has no transcript, and --resume fails: start a new claude then.
async function hasLog(sessionId) {
  const r = await exec("sh", ["-c", `ls "$HOME"/.claude/projects/*/${sessionId}.jsonl`], { timeout: 5000 });
  return r.code === 0 && r.stdout.trim() !== "";
}

// The status-bar copy and the popup write the same file: writeTextFile's expected keeps either from overwriting the other.
class Store {
  constructor() {
    this.dir = `${appHome()}/agent-revive`;
    this.file = `${this.dir}/snapshot.json`;
    this.saved = undefined;
  }

  async load() {
    if (this.saved === undefined) {
      await exec("mkdir", ["-p", this.dir]);
      this.saved = await readTextFile(this.file);
    }
    try {
      return this.saved ? JSON.parse(this.saved) : {};
    } catch {
      return {};
    }
  }

  // false when someone wrote first: read again next time
  async save(snapshot) {
    const text = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (text === this.saved) return true;
    try {
      await writeTextFile(this.file, text, this.saved ?? null);
    } catch {
      this.saved = undefined;
      return false;
    }
    this.saved = text;
    return true;
  }
}

const candidates = () => shared(KEY) ?? [];

export default class AgentRevive extends View {
  init(_props, cx) {
    this.popup = Boolean(props()?.overlay);
    if (this.popup) {
      this.chosen = new Set(candidates().map((c) => c.address));
      this.busy = false;
      this.error = null;
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.width = null;
    this.pressedAt = null;
    if (checking()) return;
    this.store = new Store();
    this.scanning = false;
    cx.timer.every(SCAN_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  // ── Status bar: the scan and the button ─────────────────────────

  tick(cx) {
    if (this.scanning) return;
    this.scanning = true;
    cx.spawn(async () => {
      try {
        await this.scan();
      } catch (error) {
        console.log(`agent-revive: ${error?.message ?? error}`);
      } finally {
        this.scanning = false;
      }
    });
  }

  async scan() {
    const snapshot = await this.store.load();
    const list = (await hcJson(["ls"])).terminals ?? [];
    const local = list.filter((t) => t.state === "live" && !t.address.includes("/"));

    const live = [];
    for (const t of local.filter((t) => t.agent === "claude-code")) {
      const term = await getTerm(t.address);
      const pid = term?.foreground?.pid;
      if (!Number.isInteger(pid)) continue;
      const s = await claudeSession(pid);
      if (s) live.push({ address: t.address, ...s, shellPid: term.pid, where: t.where ?? "" });
    }

    const terms = {};
    for (const address of Object.keys(snapshot)) {
      if (!live.some((a) => a.address === address)) terms[address] = await getTerm(address);
    }

    const result = plan(snapshot, live, terms, Date.now());
    // The popup wrote first, so this result is stale: leave the button and catch up next scan
    if (!(await this.store.save(result.snapshot))) return;
    if (JSON.stringify(result.candidates) !== JSON.stringify(candidates())) setShared(KEY, result.candidates);
  }

  fit(n) {
    const px = n > 0 ? BUTTON_PX : 1;
    if (px === this.width) return;
    this.width = px;
    try {
      run("layout.resize", { id: BLOCK_ID, px });
    } catch (error) {
      console.log(`agent-revive: layout.resize ${BLOCK_ID}: ${error?.message ?? error}`);
    }
  }

  // The status bar is the window's bottom edge, so the popup opens above the press.
  open() {
    const height = 132 + Math.min(candidates().length, MAX_ROWS) * ROW_H;
    const p = this.pressedAt;
    openOverlay({
      mod: "agent-revive",
      kind: "popup",
      width: POPUP_W,
      height,
      ...(p ? { at: { x: Math.max(8, p.x - POPUP_W + 90), y: Math.max(8, p.y - height - 14) } } : {}),
      props: { view: "panel" },
    });
  }

  bar(t) {
    const n = candidates().length;
    this.fit(n);
    if (n === 0) return div().size_full();
    return h_flex()
      .id("agent-revive")
      .size_full()
      .px(10)
      .items_center()
      .justify_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip("Resume the Claude sessions in terminals herdr-core lost")
      .on_mouse_down("left", (e) => { this.pressedAt = e.position; })
      .on_click(() => this.open())
      .child(div().text_color(t.working).font_semibold().child(`↻ Revive ${n} agent${n === 1 ? "" : "s"}`));
  }

  // ── Popup: choose and revive ────────────────────────────────────

  toggle(address, cx) {
    if (this.chosen.has(address)) this.chosen.delete(address);
    else this.chosen.add(address);
    cx.notify();
  }

  async revive(cx) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    const list = candidates();
    const store = new Store();
    const next = applyChoice(await store.load(), list, this.chosen, Date.now());
    // Saved before sending, so a second press or a scan never sends the same command twice
    if (!(await store.save(next))) {
      this.busy = false;
      this.error = "The snapshot just changed. Press again.";
      cx.notify();
      return;
    }
    const done = [];
    for (const c of list.filter((c) => this.chosen.has(c.address))) {
      // Something started in that shell while choosing: don't type into it
      const term = await getTerm(c.address);
      if (!atPrompt(term) || term.pid !== c.newShellPid) {
        done.push(`${c.address} skipped (the shell changed)`);
        continue;
      }
      const r = await hc(["send", c.address, resumeCommand(c, await hasLog(c.sessionId))]);
      done.push(`${c.address} ${c.where}${r.code === 0 ? "" : " (failed)"}`);
    }
    setShared(KEY, []);
    if (done.length > 0) notify({ title: `Revived ${done.length} agent${done.length === 1 ? "" : "s"}`, body: done.join("\n"), level: "info", timeout: 8000 });
    closeOverlay(props().overlay);
  }

  onKey(event, cx) {
    cx.stop_propagation();
    if (event.keystroke === "enter") cx.spawn(async (cx) => this.revive(cx));
    if (event.keystroke === "escape") closeOverlay(props().overlay);
  }

  row(t, c) {
    const on = this.chosen.has(c.address);
    return h_flex()
      .id(`row-${c.address}`)
      .h(ROW_H)
      .flex_none()
      .px(8)
      .gap(10)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.toggle(c.address, cx))
      .child(div().w(16).text_color(on ? t.accent : t.dim).child(on ? "☑" : "☐"))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(h_flex().gap(8)
            .child(div().text_color(t.foreground).font_semibold().child(c.address))
            .child(div().flex_1().truncate().text_color(on ? t.muted : t.dim).child(c.where || "")))
          .child(div().truncate().text_size(11).text_color(t.dim).child(`${c.cwd.replace(home(), "~")} · ${c.sessionId.slice(0, 8)}`)),
      );
  }

  button(t, id, label, primary, onClick) {
    return div()
      .id(id)
      .px(12)
      .py(5)
      .rounded(6)
      .cursor_pointer()
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, (el) => el.border(1).border_color(t.border).text_color(t.muted))
      .hover((s) => s.opacity(0.85))
      .on_click(onClick)
      .child(label);
  }

  panel(t) {
    const list = candidates();
    const n = list.filter((c) => this.chosen.has(c.address)).length;
    return v_flex()
      .id("agent-revive-panel")
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .size_full()
      .min_h(0)
      .p(14)
      .gap(8)
      .rounded(8)
      .bg(t.popover)
      .text_size(13)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Revive agents"))
      .child(div().text_size(12).text_color(t.dim).child("Terminals herdr-core lost. Unchecked ones are forgotten."))
      .child(v_flex().id("rows").flex_none().h(Math.min(list.length, MAX_ROWS) * ROW_H).overflow_y_scrollbar().children(list.map((c) => this.row(t, c))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(
        h_flex()
          .gap(8)
          .justify_end()
          .child(this.button(t, "close", "Close (Esc)", false, () => closeOverlay(props().overlay)))
          .child(this.button(t, "go", this.busy ? "Reviving…" : n > 0 ? `Revive ${n} (Enter)` : "Forget all (Enter)", true,
            (_e, cx) => cx.spawn(async (cx) => this.revive(cx)))),
      );
  }

  render() {
    const t = theme();
    return this.popup ? this.panel(t) : this.bar(t);
  }
}
