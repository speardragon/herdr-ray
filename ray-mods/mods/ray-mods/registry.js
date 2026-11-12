// What the Mods panel remembers, in ~/.config/herdr-app/ray-mods/registry.json:
//   sources:  { [mod]: { repo: "owner/name", path: "mods/<mod>", commit, fingerprint, at } }
//             where a mod comes from (for updates), which commit is installed and
//             what its files looked like then (to tell it was changed here since)
//   disabled: { [mod]: { layout, nodes: [node id], keys: [{ section, key, action }], at } }
//             what turning a mod off hid in the layout and took out of keys.json

import { appHome, exec, readTextFile, writeTextFile } from "herdr";

const DIR = () => `${appHome()}/ray-mods`;
const FILE = () => `${DIR()}/registry.json`;
export const EMPTY = { sources: {}, disabled: {} };

export async function load() {
  const text = await readTextFile(FILE()).catch(() => null);
  if (!text) return { reg: EMPTY, text: null };
  try {
    const reg = JSON.parse(text);
    return { reg: { sources: reg.sources ?? {}, disabled: reg.disabled ?? {} }, text };
  } catch {
    return { reg: EMPTY, text };
  }
}

// Applies `change(reg) -> reg` to what is on disk now.
export async function update(change) {
  const { reg, text } = await load();
  const next = change(reg);
  if (text === null) await exec("mkdir", ["-p", DIR()], { timeout: 10_000 });
  await writeTextFile(FILE(), `${JSON.stringify(next, null, 2)}\n`, text);
  return next;
}
