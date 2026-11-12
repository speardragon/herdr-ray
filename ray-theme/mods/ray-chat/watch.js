// The watcher: the one copy of the mod that is always there (a hidden block in
// the status bar). Every few seconds it looks at the terminals in a
// parent-child relation, reads the hc messages in their agents' records, notes
// when a child starts, stops, needs someone or exits, and adds what is new to
// the log (store.js). Messages typed in a panel wait in shared "ray.chat.outbox"
// and are added here too, so only this copy writes the file.

import { shared, setShared } from "herdr";
import { load, save } from "./store.js";
import { family, rootOf, keyOf, recordOf, messagesOf, launchTask } from "./scan.js";
import { freshTint } from "./model.js";

export const REV = "ray.chat.rev";
export const OUTBOX = "ray.chat.outbox";
// Agents asked, from the panel, to talk to an agent that isn't their child:
// [{ parent: address, child: address }]. They count as one family, so what
// the two send each other shows as a conversation too.
export const LINKS = "ray.chat.links";
const RECORD_MS = 30_000; // how long a terminal's record file is taken to be the same one

const SAME_MS = 10 * 60_000;
const sayKey = (i) => `${i.to}|${i.fromLabel}|${i.text}`;

const labelOf = (t) => t.name || t.title || t.labels?.where || t.program?.name || t.address;

async function quietly(read) {
  try {
    return await read();
  } catch {
    return null;
  }
}

function agentOf(t, by, old) {
  return {
    key: keyOf(t), address: t.address, label: labelOf(t), name: t.name ?? null,
    program: { name: t.program?.name ?? null, icon: t.program?.icon ?? null, tint: Boolean(t.program?.tint) },
    parent: t.parent && by.has(t.parent) ? keyOf(by.get(t.parent)) : old?.parent ?? null,
    root: old?.root ?? keyOf(rootOf(t, by)), // set once: a parent may be gone later
    ...(old?.tint ? { tint: old.tint } : {}),
    created: t.created_ms ?? null, cwd: t.cwd ?? null,
  };
}

// When the watcher last looked. Module state is shared by every copy of this mod,
// so a panel or window can tell whether a watcher block is running (see main.js).
export const beat = { at: 0 };

export class Watcher {
  constructor() {
    this.status = new Map(); // key -> the child's last seen state
    this.records = new Map(); // key -> { file, at }
  }

  async record(t) {
    const key = keyOf(t);
    const kept = this.records.get(key);
    if (kept && Date.now() - kept.at < RECORD_MS) return kept.file;
    const file = await quietly(() => recordOf(t));
    this.records.set(key, { file, at: Date.now() });
    return file;
  }

  // What changed for the children since the last look, as events.
  events(fam, agents, add) {
    const now = new Map([...fam.values()].filter((t) => t.parent).map((t) => [keyOf(t), t.state === "live" ? t.status ?? "idle" : "exited"]));
    const event = (key, what) => add({ id: `ev-${key}-${what}-${Date.now()}`, kind: "event", ts: Date.now(), agent: key, what });
    for (const [key, state] of now) {
      const before = this.status.get(key);
      if (before === undefined || before === state) continue;
      if (state === "exited" || state === "blocked" || state === "error") event(key, state);
      else if (before === "working") event(key, "done");
    }
    // A child that is no longer listed has ended and been removed.
    for (const [key, before] of this.status) if (!now.has(key) && before !== "exited" && agents[key]) event(key, "exited");
    this.status = now;
  }

  // One look. -> true when the log changed.
  async tick(listed) {
    beat.at = Date.now();
    const links = shared(LINKS) ?? [];
    const live = new Set(listed.map((t) => t.address));
    const terminals = listed.map((t) => {
      const link = t.parent ? null : links.find((l) => l.child === t.address && live.has(l.parent));
      return link ? { ...t, parent: link.parent, linked: true } : t;
    });
    const fam = family(terminals);
    const outbox = shared(OUTBOX) ?? [];
    if (!fam.size && !outbox.length && !this.status.size) return false;
    const { log, text } = await load();
    const agents = { ...log.agents };
    const have = new Set(log.items.map((i) => i.id));
    const fresh = [];
    const add = (item) => {
      if (have.has(item.id)) return;
      have.add(item.id);
      fresh.push(item);
    };
    for (const t of fam.values()) {
      const made = agentOf(t, fam, agents[keyOf(t)]);
      const a = made.tint ? made : { ...made, tint: freshTint(agents, made.root) };
      agents[a.key] = a;
      if (t.parent && !t.linked) add({ id: `started-${a.key}`, kind: "event", ts: a.created ?? Date.now(), agent: a.key, what: "started" });
      const task = t.parent && !t.linked && a.parent ? launchTask(t) : null;
      if (task) add({ id: `launch-${a.key}`, kind: "message", ts: (a.created ?? Date.now()) + 1, to: a.key, from: a.parent, fromLabel: agents[a.parent]?.label ?? null, text: task, task: true });
    }
    this.events(fam, agents, add);
    const firstChild = Math.min(...[...fam.values()].filter((t) => t.parent).map((t) => t.created_ms ?? 0), Infinity);
    // One message can be in a record twice (queued, then delivered): the same
    // text from the same sender to the same agent within a while is one.
    const said = new Map(log.items.filter((i) => i.kind !== "event").map((i) => [sayKey(i), i.ts]));
    const repeat = (item) => {
      const before = said.get(sayKey(item));
      said.set(sayKey(item), item.ts);
      return before !== undefined && Math.abs(item.ts - before) < SAME_MS;
    };
    for (const t of fam.values()) {
      if (t.state !== "live") continue;
      const file = await this.record(t);
      const found = file ? await quietly(() => messagesOf(file)) : null;
      const to = keyOf(t);
      for (const m of found ?? []) {
        const sender = m.address ? fam.get(m.address) : null;
        // A resumed session's record can hold messages from before this
        // terminal: an address means another terminal then, so they stay out.
        if (!m.ts || m.ts < (t.created_ms ?? 0) - 1000) continue;
        // From no one in this family (hc's own notes too): only since the
        // family's first child, or it is about terminals long gone.
        if (!sender && m.ts < firstChild) continue;
        // A linked agent's own past (it wasn't started for this): only what it and its asker said since.
        if (t.linked && !sender) continue;
        const item = {
          id: `${to}:${m.id}`, kind: m.address ? "message" : "note", ts: m.ts, to,
          from: sender ? keyOf(sender) : null,
          fromLabel: [m.address, m.name].filter(Boolean).join(" ") || null,
          text: m.text, ...(m.task ? { task: true } : {}),
        };
        if (!have.has(item.id) && !repeat(item)) add(item);
      }
    }
    for (const sent of outbox) add(sent);
    const sameAgents = JSON.stringify(agents) === JSON.stringify(log.agents);
    if (!fresh.length && sameAgents) return false;
    const items = fresh.length ? [...log.items, ...fresh].sort((a, b) => a.ts - b.ts) : log.items;
    if ((await save({ agents, items }, text)) === null) return false; // changed underneath: the next look redoes it
    if (outbox.length) setShared(OUTBOX, (shared(OUTBOX) ?? []).filter((o) => !have.has(o.id)));
    setShared(REV, Date.now());
    return true;
  }
}
