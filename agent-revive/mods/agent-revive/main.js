// Agent Revive: when herdr-core loses a terminal and gives its address a new shell (core restart,
// reboot), resume the Claude Code session that was there with `claude --resume`.
// It draws nothing: it runs while a 1px block in the layout's status bar holds it.
// Snapshot: ~/.config/herdr-app/agent-revive/snapshot.json (outside mods/, so writing it doesn't hot-reload)

import { View, div } from "gpui-kit";
import { appHome, checking, exec, hc, home, notify, readTextFile, writeTextFile } from "herdr";
import { plan, resumeCommand, isSessionId } from "./plan.js";

const SCAN_MS = 20_000;

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

export default class AgentRevive extends View {
  init(_props, cx) {
    if (checking()) return;
    this.dir = `${appHome()}/agent-revive`;
    this.file = `${this.dir}/snapshot.json`;
    this.saved = undefined; // what the file last held: writeTextFile's expected
    this.busy = false;
    cx.timer.every(SCAN_MS, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async () => {
      try {
        await this.scan();
      } catch (error) {
        console.log(`agent-revive: ${error?.message ?? error}`);
      } finally {
        this.busy = false;
      }
    });
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

  async save(snapshot) {
    const text = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (text === this.saved) return;
    try {
      await writeTextFile(this.file, text, this.saved ?? null);
    } catch {
      // another window wrote first: read again and catch up next scan
      this.saved = undefined;
      return;
    }
    this.saved = text;
  }

  async scan() {
    const snapshot = await this.load();
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
    // Saved before sending, so a reload mid-send never sends the same command twice
    await this.save(result.snapshot);

    const done = [];
    for (const entry of result.revive) {
      const cmd = resumeCommand(entry, await hasLog(entry.sessionId));
      const r = await hc(["send", entry.address, cmd]);
      done.push(`${entry.address} ${entry.where}${r.code === 0 ? "" : " (failed)"}`);
    }
    if (done.length > 0) {
      notify({ title: `Revived ${done.length} agent${done.length === 1 ? "" : "s"}`, body: done.join("\n"), level: "info", timeout: 8000 });
    }
  }

  render() {
    return div().size_full();
  }
}
