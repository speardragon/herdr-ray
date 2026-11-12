// Past agent sessions for the ray-theme side panel: the Claude Code and Codex
// sessions started in the focused terminal's folder (else the space's), newest
// first. A row resumes that session in a new tab, with the agent's own start
// command from programs.json (so its usual flags come along).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, theme, home, appHome, exec, run, knownAgents } from "herdr";
import { tr } from "./i18n/i18n.js";

const POLL_MS = 120_000;
const LIMIT = 20;
const AGENTS = {
  claude: { name: "Claude Code", resume: (id) => ["--resume", id] },
  codex: { name: "Codex", resume: (id) => ["resume", id] },
};

function shortPath(path) {
  const h = home();
  return path === h ? "~" : path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return tr("<1m");
  if (m < 60) return tr("{n}m", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? tr("{n}h", { n: h }) : tr("{n}d", { n: Math.floor(h / 24) });
}

const parseField = (text) => {
  try {
    return String(JSON.parse(text));
  } catch {
    return "";
  }
};

function parse(stdout) {
  return stdout.split("\n").filter(Boolean).map((line) => {
    const [agent, id, updated, title, branch] = line.split("\t");
    const b = parseField(branch);
    return {
      agent,
      id,
      updated: Number(updated) * 1000,
      title: parseField(title).replace(/\s+/g, " ").trim(),
      branch: b === "HEAD" ? "" : b,
    };
  }).filter((s) => AGENTS[s.agent] && s.id).sort((a, b) => b.updated - a.updated);
}

// The focused terminal's folder when it's in the shown space, else the space's.
function currentFolder() {
  const space = spaces().find((s) => s.active);
  if (!space || space.machine) return null; // sessions are read on this computer
  const f = focused();
  const pane = panes().find((p) => p.pane === f?.pane);
  return pane?.cwd || f?.cwd || space.folder || null;
}

export default class Sessions extends View {
  init(_props, cx) {
    this.folder = null;
    this.pending = undefined;
    this.list = null;
    this.error = null;
    this.programs = {};
    cx.spawn(async (cx) => {
      const known = await knownAgents().catch(() => []);
      this.programs = Object.fromEntries(known.map((p) => [p.key, p]));
      cx.notify();
    });
    cx.timer.every(POLL_MS, (cx) => this.load(this.folder, cx));
  }

  load(folder, cx) {
    if (!folder) return;
    this.pending = folder;
    cx.spawn(async (cx) => {
      let list = [];
      let error = null;
      try {
        const r = await exec("/bin/sh", [`${appHome()}/mods/ray-sessions/list-sessions.sh`, folder, String(LIMIT)], { timeout: 20_000 });
        list = parse(r.stdout);
        if (r.code !== 0) error = r.stderr.trim().split("\n")[0];
      } catch (e) {
        error = String(e);
      }
      if (this.pending !== folder) return;
      this.pending = undefined;
      this.folder = folder;
      this.list = list;
      this.error = error;
      cx.notify();
    });
  }

  resume(s) {
    const program = this.programs[s.agent];
    const start = program?.run?.length ? program.run : [s.agent];
    run("tab.new", { folder: this.folder, argv: [...start, ...AGENTS[s.agent].resume(s.id)] });
  }

  icon(t, agent) {
    const p = this.programs[agent];
    if (!p?.icon) return div().size(16).flex_none();
    return p.tint ? svg(p.icon).size(16).flex_none().text_color(t.muted) : image(p.icon).size(16).flex_none();
  }

  row(t, s) {
    const meta = [AGENTS[s.agent].name, ago(s.updated), s.branch].filter(Boolean).join(" · ");
    return h_flex()
      .id(`session-${s.agent}-${s.id}`)
      .flex_none()
      .px(12)
      .py(7)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .tooltip(tr("Resume in a new tab"))
      .on_click(() => this.resume(s))
      .child(this.icon(t, s.agent))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_color(t.foreground).child(s.title || tr("Untitled session")))
        .child(div().truncate().text_size(12).text_color(t.dim).child(meta)));
  }

  body(t, folder) {
    const note = (text) => div().px(14).py(10).text_color(t.dim).child(text);
    if (!folder) return note(tr("Focus a terminal on this computer to see its folder's sessions."));
    if (this.list === null || this.folder !== folder) return note(tr("Loading…"));
    if (!this.list.length) return note(this.error ?? tr("No Claude Code or Codex sessions in this folder yet."));
    return v_flex().id("sessions-list").flex_1().min_h(0).overflow_y_scrollbar().p(5)
      .children(this.list.map((s) => this.row(t, s)));
  }

  render(cx) {
    const t = theme();
    const folder = currentFolder();
    if (folder && folder !== this.folder && folder !== this.pending) this.load(folder, cx);
    return v_flex()
      .id("ray-sessions")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13.5)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(tr("Sessions")))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.dim).child(folder ? shortPath(folder) : ""))
        .child(div().id("refresh").flex_none().size(24).flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(tr("Refresh"))
          .on_click((_e, cx) => this.load(folder, cx))
          .child("↻")))
      .child(this.body(t, folder));
  }
}
