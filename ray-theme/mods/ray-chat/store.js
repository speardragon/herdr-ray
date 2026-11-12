// The chat log, kept in a file so a conversation outlives its terminals:
// ~/.config/herdr-app/ray-chat/log.json
//   agents: { [key]: { key, address, label, name, program: {name, icon, tint},
//                       parent: key | null, root: key, created, cwd } }
//   items:  [{ id, kind: "message" | "note" | "event", ts,
//              to?: key, from?: key | "you" | null, fromLabel?, text?, task?,
//              agent?: key, what? }]   (oldest first)
// Only the watcher (the hidden copy in the status bar) writes it; the panels
// read it again when shared "ray.chat.rev" changes.

import { appHome, exec, readTextFile, writeTextFile } from "herdr";

const DIR = () => `${appHome()}/ray-chat`;
const FILE = () => `${DIR()}/log.json`;
const MAX_ITEMS = 3000;
export const MAX_TEXT = 6000; // a longer message is cut: reports that long belong in a file

export const EMPTY = { agents: {}, items: [] };

// -> { log, text }: `text` is what is on disk, for the next save.
export async function load() {
  const text = await readTextFile(FILE());
  if (!text) return { log: EMPTY, text: null };
  try {
    const log = JSON.parse(text);
    return { log: { agents: log.agents ?? {}, items: log.items ?? [] }, text };
  } catch {
    return { log: EMPTY, text };
  }
}

// Saves `log` over what was read as `text`. -> the new text, or null when the
// file changed underneath (read it again and redo).
export async function save(log, text) {
  const items = log.items.length > MAX_ITEMS ? log.items.slice(-MAX_ITEMS) : log.items;
  const live = new Set(items.flatMap((i) => [i.to, i.from, i.agent]));
  // An agent with nothing left in the log goes with its last item, unless it is still someone's root.
  const roots = new Set(Object.values(log.agents).filter((a) => live.has(a.key)).map((a) => a.root));
  const agents = Object.fromEntries(Object.entries(log.agents).filter(([key, a]) => live.has(key) || roots.has(key) || a.keep));
  const next = JSON.stringify({ agents, items });
  try {
    if (text === null) await exec("mkdir", ["-p", DIR()], { timeout: 10_000 });
    await writeTextFile(FILE(), next, text);
    return next;
  } catch {
    return null;
  }
}
