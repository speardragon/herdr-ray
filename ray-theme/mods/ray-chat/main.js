// Chat: what agents say to each other through hc, as a chat app shows it.
// An agent that starts others with `hc run` and those it started are one
// conversation; the list shows them, and opening one shows its messages, the
// tasks given, and when each agent started, stopped or ended. The box at the
// bottom sends to one of its agents (hc send).
// Three shapes, by props().view:
//   "watch"  the hidden copy in the status bar that reads the messages and
//            keeps the log (watch.js), so nothing is missed while the panel is shut
//   (none)   the side panel: the list, or the conversation opened from it
//   "window" both side by side, in a window (the panel's "Big view")
// The log: store.js. Where messages come from: scan.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState, ScrollHandle } from "gpui-base";
import { theme, props, shared, setShared, terminals, agents, spaces, focused, knownAgents, hc, exec, run, openOverlay, closeOverlay } from "herdr";
import { EMPTY, load } from "./store.js";
import { Watcher, REV, OUTBOX, LINKS, beat } from "./watch.js";
import { conversations } from "./model.js";
import { blocks } from "./rich.js";
import { list } from "./list.js";
import { thread, PAGE } from "./thread.js";
import { askForm } from "./ask.js";
import { agentNames } from "./names.js";
import { KINDS, request } from "./prompt.js";
import { tr } from "./i18n/i18n.js";
import { ringColor, ringOut, ringProbe } from "./focus-ring.js";

const WATCH_MS = 5000;
const READ = "ray.chat.read"; // { [conversation]: ms last looked at }
const UNREAD = "ray.chat.unread"; // how many messages are unread, for a badge

export default class Chat extends View {
  init(_props, cx) {
    this.mode = props()?.view ?? "panel";
    if (this.mode === "watch") {
      this.watcher = new Watcher();
      this.busy = false;
      cx.timer.every(WATCH_MS, (cx) => this.watch(cx));
      this.watch(cx);
      return;
    }
    this.log = EMPTY;
    this.rev = undefined;
    this.open = null; // the conversation shown
    this.scroller = ScrollHandle.new(); // the messages' scroll position (thread.js)
    this.shown = PAGE; // how many of the newest messages are drawn
    this.following = true; // kept at the newest; turning back up stops it
    this.fromBottom = 0; // how far up from the newest, in pixels, as the wheel tells it
    this.stuckAt = null; // the conversation and size last taken to the newest
    this.parsed = new Map(); // message id -> parsed Markdown blocks
    this.hovered = null; // the message row under the pointer, and the one just copied
    this.copied = null;
    this.viewHeight = null; // the messages area's height, and its rows'
    this.rowsHeight = null;
    this.to = null;
    this.error = null;
    this.notice = null;
    this.input = InputState.new({ placeholder: tr("Write a message") });
    this.input.on("submit", (_e, cx) => this.send(null, cx));
    cx.timer.every(30_000, (cx) => cx.notify()); // "2 minutes ago" moves on
    // Without a watcher block in the layout (the mod added on its own, opened as
    // a window), this copy does the watcher's work while it is open.
    cx.timer.every(WATCH_MS, (cx) => { if (Date.now() - beat.at > 3 * WATCH_MS) this.watch(cx); });
    // The request form (ask.js): null while shut.
    this.ask = null; // { step, from: address, target: id, kind }
    this.last = null; // the target and kind of the last request sent: the wizard starts on them
    this.area = TextareaState.new({ placeholder: "", rows: 4 });
    this.area.set_auto_grow(4, 12);
    this.programs = []; // installed agent programs, and hc's templates: whom a new agent can be
    this.templates = [];
    cx.spawn(async (cx) => {
      try {
        this.programs = (await knownAgents()).filter((p) => p.installed && p.run?.length);
        const r = await hc(["templates", "--json"]);
        this.templates = r.code === 0 ? JSON.parse(r.stdout).templates ?? [] : [];
      } catch {
        // without them only running agents can be asked
      }
      cx.notify();
    });
  }

  // The running agents as the sidebar names them, with the space each is in.
  facts() {
    const live = agents();
    const labels = agentNames(live, spaces().flatMap((sp) => sp.tabs ?? []));
    return live.map((a) => ({
      address: a.address, space: a.space, label: labels.get(a.address) || a.title || a.address,
      status: a.status, focused: a.focused, who: { program: a.program, label: labels.get(a.address) || a.title, key: a.address },
    }));
  }

  // Whom the asking agent can ask: a new agent of an installed program, an hc
  // template, or an agent that is running.
  targets() {
    return [
      ...this.programs.map((p) => ({ id: `run:${p.key}`, kind: "run", name: p.name, run: p.run, who: { program: p, label: p.name, key: p.key } })),
      ...this.templates.map((x) => ({ id: `tpl:${x.name}`, kind: "template", name: x.name, where: x.description ?? null })),
      ...this.facts().map((a) => ({ id: `agent:${a.address}`, kind: "agent", name: a.label, ...a })),
    ];
  }

  // Opens the wizard on step 1 with what was chosen last time already in place.
  openAsk(from, cx) {
    const live = agents();
    const here = focused()?.terminal;
    const first = live.find((a) => a.address === from) ?? live.find((a) => a.address === here) ?? live[0] ?? null;
    const targets = this.targets();
    const target = targets.find((x) => x.id === this.last?.target) ?? targets[0];
    this.ask = { step: 1, from: first?.address ?? null, target: target?.id ?? null, kind: this.last?.kind ?? "ask" };
    this.error = null;
    cx.notify();
  }

  sendAsk(cx) {
    const ask = this.ask;
    const target = this.targets().find((x) => x.id === ask?.target);
    const from = terminals().find((x) => x.address === ask?.from && x.state === "live");
    const kind = KINDS.find((k) => k.id === ask?.kind) ?? KINDS[0];
    const text = this.area.value().trim();
    if (!from || !target) { this.error = tr("Pick who asks and whom it asks."); cx.notify(); return; }
    if (kind.needs && !text) { this.error = tr("Write what it should ask."); cx.notify(); return; }
    const message = request(kind.id, target, text);
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", from.address, message]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || tr("Couldn't send."));
        const sent = { id: `you-${Date.now()}`, kind: "message", ts: Date.now(), to: `${from.address}@${from.created_ms ?? 0}`, from: "you", text: message };
        setShared(OUTBOX, [...(shared(OUTBOX) ?? []), sent]);
        // Asked to talk to a running agent: the two are shown as one conversation.
        if (target.kind === "agent") {
          const links = (shared(LINKS) ?? []).filter((l) => l.child !== target.address);
          setShared(LINKS, [...links, { parent: from.address, child: target.address }].slice(-50));
        }
        this.last = { target: target.id, kind: kind.id };
        this.area.set_value("");
        this.ask = null;
        this.notice = tr("Sent. The conversation shows up here once the agent starts or reaches the other one.");
      } catch (error) {
        this.error = String(error?.message ?? error);
      }
      cx.notify();
    });
  }

  form() {
    const sp = spaces();
    return {
      ...this.ask, error: this.error, area: this.area, targets: this.targets(), space: focused()?.space ?? null,
      senders: this.facts(),
      // The spaces in the sidebar's order, for grouping the agents under them.
      spaces: sp.map((x) => ({ id: x.id, name: x.name, machine: x.machine ?? null })),
      pick: (field, value, cx) => { this.ask = { ...this.ask, [field]: value }; this.error = null; cx.notify(); },
      // Chooses in a step; going on is the "Next" button's or the step numbers' job.
      choose: (field, value, cx) => { this.ask = { ...this.ask, [field]: value }; this.error = null; cx.notify(); },
      go: (step, cx) => { this.ask = { ...this.ask, step }; this.error = null; cx.notify(); },
      next: (cx) => { this.ask = { ...this.ask, step: Math.min(4, (this.ask.step ?? 1) + 1) }; cx.notify(); },
      // Back a step; from the first, out of the wizard.
      back: (cx) => {
        if ((this.ask.step ?? 1) > 1) this.ask = { ...this.ask, step: this.ask.step - 1 };
        else { this.ask = null; }
        this.error = null;
        cx.notify();
      },
      // A space's agents folded or unfolded in a list (`key`: which list and space).
      toggle: (key, open, cx) => { this.ask = { ...this.ask, open: { ...(this.ask.open ?? {}), [key]: !open } }; cx.notify(); },
      send: (cx) => this.sendAsk(cx),
      close: (cx) => { this.ask = null; this.error = null; cx.notify(); },
    };
  }

  watch(cx) {
    this.watcher ??= new Watcher();
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        const changed = await this.watcher.tick(terminals());
        // The badge: counted again only after the log or what was read changed.
        const read = shared(READ) ?? {};
        const stamp = JSON.stringify(read);
        if (changed || stamp !== this.readStamp) {
          this.readStamp = stamp;
          const { log } = await load();
          const unread = conversations(log, read).reduce((n, c) => n + c.unread, 0);
          if (unread !== (shared(UNREAD) ?? 0)) setShared(UNREAD, unread);
        }
      } catch {
        // the next look tries again
      }
      this.busy = false;
    });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      this.log = (await load()).log;
      cx.notify();
    });
  }

  // A live agent's state by its key, null when it has ended.
  status(agent) {
    const t = terminals().find((x) => x.address === agent.address && `${x.address}@${x.created_ms ?? 0}` === agent.key);
    return t && t.state === "live" ? t.status ?? "idle" : null;
  }

  // Marks a conversation read, and brings the panel button's badge along
  // (counted the way the watcher counts it, so the two never disagree).
  markRead(key) {
    const read = { ...(shared(READ) ?? {}), [key]: Date.now() };
    setShared(READ, read);
    const unread = conversations(this.log, read).reduce((n, c) => n + c.unread, 0);
    if (unread !== (shared(UNREAD) ?? 0)) setShared(UNREAD, unread);
  }

  choose(key, cx) {
    this.open = key;
    this.newest();
    this.shown = PAGE;
    this.error = null;
    if (key && this.convs?.find((c) => c.key === key)?.unread) this.markRead(key);
    cx.notify();
  }

  // Back at the newest, and staying there as messages come.
  newest() {
    this.following = true;
    this.fromBottom = 0;
    this.stuckAt = null; // asked for the newest again on the next frame
  }

  // The scroll area scrolls by itself; this only keeps track of how far up it
  // is, to know whether to stay with the newest, and draws a page more at the
  // top. Nothing is redrawn unless one of those changes.
  wheel(delta, count, cx) {
    const room = Math.max(0, (this.rowsHeight ?? 0) + 6 - (this.viewHeight ?? 0));
    this.fromBottom = Math.max(0, Math.min(room, this.fromBottom + delta));
    const following = this.fromBottom < 24;
    const more = delta > 0 && this.fromBottom >= room - 2 && this.shown < count;
    if (more) this.shown += PAGE;
    if (following === this.following && !more) return;
    this.following = following;
    cx.notify();
  }

  send(agent, cx) {
    const text = this.input.value().trim();
    const conv = this.current;
    const to = agent ?? this.target;
    if (!text || !to) return;
    this.input.set_value("");
    this.error = null;
    const sent = { id: `you-${Date.now()}`, kind: "message", ts: Date.now(), to: to.key, from: "you", text };
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", to.address, text]);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n")[0] || tr("Couldn't send."));
        setShared(OUTBOX, [...(shared(OUTBOX) ?? []), sent]);
        this.newest();
      } catch (error) {
        this.error = String(error?.message ?? error);
        this.input.set_value(text);
      }
      cx.notify();
    });
  }

  // The conversations, worked out again only when the log, what was read or
  // what is waiting to be written changed: not on every redraw (a wheel turn,
  // a hover elsewhere, another mod's shared value).
  conversations() {
    const read = shared(READ) ?? {};
    const outbox = shared(OUTBOX) ?? [];
    const stamp = `${JSON.stringify(read)}|${outbox.map((o) => o.id).join(",")}`;
    if (this.convs && this.convsLog === this.log && this.convsStamp === stamp) return this.convs;
    this.convs = conversations(this.log, read, outbox);
    this.convsLog = this.log;
    this.convsStamp = stamp;
    return this.convs;
  }

  view(back) {
    return {
      open: this.open, shown: this.shown, following: this.following, scroller: this.scroller, input: this.input, to: this.to, error: this.error, back,
      status: (a) => this.status(a),
      choose: (key, cx) => this.choose(key, cx),
      goTo: (a, cx) => { run("agent.focus", { terminal: a.address }); cx.notify(); },
      pickTo: (key, cx) => { this.to = key; cx.notify(); },
      send: (a, cx) => this.send(a, cx),
      ask: (a, cx) => this.openAsk(a?.address ?? null, cx),
      aim: (a) => { this.target = a; }, // who Enter sends to: the one the box shows
      hovered: this.hovered, copied: this.copied,
      hover: (id, on, cx) => {
        if (on && this.hovered !== id) { this.hovered = id; cx.notify(); }
        else if (!on && this.hovered === id) { this.hovered = null; cx.notify(); }
      },
      // Copies a message's text to the system clipboard.
      copy: (item, cx) => {
        const script = 'printf %s "$1" | { pbcopy || wl-copy || xclip -selection clipboard || clip; } 2>/dev/null';
        exec("/bin/sh", ["-c", script, "sh", item.text ?? ""], { timeout: 5000 }).catch(() => null);
        this.copied = item.id;
        cx.notify();
        cx.timer.after(1500, (cx) => { if (this.copied === item.id) { this.copied = null; cx.notify(); } });
      },
      // A message's parsed Markdown, kept: parsing every frame would cost more than a frame has.
      blocks: (item) => {
        const hit = this.parsed.get(item.id);
        if (hit) return hit;
        const list = blocks(item.text ?? "", 120);
        this.parsed.set(item.id, list);
        if (this.parsed.size > 400) this.parsed.delete(this.parsed.keys().next().value);
        return list;
      },
      measure: (name, px, cx) => {
        const was = this[name];
        if (was !== null && Math.abs(was - px) < 1) return;
        this[name] = px;
        // Rows added above or below while turned back push the newest further down.
        if (name === "rowsHeight" && was !== null && !this.following) this.fromBottom += Math.max(0, px - was);
      },
      stuckAt: this.stuckAt,
      stuck: (key) => { this.stuckAt = key; },
      wheel: (delta, count, cx) => this.wheel(delta, count, cx),
      older: (count, cx) => { this.shown = Math.min(count, this.shown + PAGE); this.following = false; cx.notify(); },
      newest: (cx) => { this.newest(); cx.notify(); },
    };
  }

  head(t, title, right) {
    return h_flex().h(40).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().text_size(14.5).font_bold().text_color(t.foreground).child(title))
      .children(right);
  }

  button(t, id, label, tip, go) {
    return div().id(id).flex_none().px(8).h(24).flex().items_center().rounded(6).text_size(12).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(go).child(label);
  }

  render(cx) {
    const t = theme();
    if (this.mode === "watch") return div();
    const rev = shared(REV) ?? null;
    if (rev !== this.rev) {
      this.rev = rev;
      this.reload(cx);
    }
    const convs = this.conversations();
    this.current = convs.find((c) => c.key === this.open) ?? null;
    // Looking at a conversation keeps it read. (Setting a shared value redraws
    // every mod, so only when there is something unread, and once for it.)
    if (this.current?.unread && this.marking !== this.current.last?.id) {
      this.marking = this.current.last?.id;
      const key = this.current.key;
      cx.spawn(async () => this.markRead(key));
    }
    const root = v_flex().id("chat").size_full().min_h(0).bg(t.background).text_color(t.foreground).border_1().border_color(ringColor(this, "#00000000")).on_mouse_down_out(ringOut(this)).child(ringProbe(this));
    const askButton = this.button(t, "chat-ask", `+ ${tr("Ask")}`, tr("Have an agent ask another"), (_e, cx) => this.openAsk(null, cx));
    if (this.mode === "window") {
      const shown = this.current ?? convs[0] ?? null;
      if (shown && !this.current) this.current = shown;
      return root.bg(t.popover)
        .child(this.head(t, tr("Chat"), [askButton, this.button(t, "chat-close", "✕", tr("Close"), () => closeOverlay(props()?.overlay))]))
        .child(h_flex().flex_1().min_h(0)
          .child(v_flex().w(300).flex_none().h_full().border_r(1).border_color(t.border).child(list(t, convs, this.log, { ...this.view(false), open: shown?.key ?? null })))
          .child(v_flex().flex_1().min_w(0).h_full().child(this.ask ? askForm(t, this.form()) : shown ? thread(t, shown, this.log, this.view(false)) : div())));
    }
    if (this.ask) return root.child(askForm(t, this.form()));
    if (this.current) return root.child(thread(t, this.current, this.log, this.view(true)));
    const close = props()?.overlay ? [this.button(t, "chat-close-window", "✕", tr("Close"), () => closeOverlay(props().overlay))] : [];
    return root
      .child(this.head(t, tr("Chat"), [askButton, ...close, this.button(t, "chat-big", tr("Big view"), tr("Open in a window, list and conversation side by side"),
        () => openOverlay({ mod: "ray-chat", kind: "window", key: "ray-chat", width: 0.8, height: 660, props: { view: "window" } }))]))
      .when(Boolean(this.notice), (el) => el.child(div().id("chat-notice").flex_none().mx(8).mt(8).px(10).py(7).rounded(8).bg(`${t.accent}1f`).whitespace_normal().text_size(12.5).text_color(t.foreground)
        .cursor_pointer().on_click((_e, cx) => { this.notice = null; cx.notify(); }).child(this.notice)))
      .child(list(t, convs, this.log, this.view(true)));
  }
}
