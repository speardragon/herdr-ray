// What is installed: every folder in mods/, what kind it is, how big, where the
// shown layout and keys.json use it, and mods that are used but missing.

import { appHome, exec, readTextFile, shared } from "herdr";
import { load } from "./registry.js";

const ops = () => `${appHome()}/mods/ray-mods/ops.sh`;

export async function readJson(path) {
  const text = await readTextFile(path).catch(() => null);
  try {
    return text ? { json: JSON.parse(text), text } : { json: null, text };
  } catch {
    return { json: null, text };
  }
}

// The nodes of `tree` that show mod `name`: [{ id, hidden }].
export function nodesOf(tree, name, out = []) {
  if (Array.isArray(tree)) tree.forEach((n) => nodesOf(n, name, out));
  else if (tree && typeof tree === "object") {
    if (tree.content?.mod === name) out.push({ id: tree.id, hidden: Boolean(tree.hidden) });
    for (const v of Object.values(tree)) if (v && typeof v === "object") nodesOf(v, name, out);
  }
  return out;
}

// Every mod a layout shows.
export function modsOf(tree, out = new Set()) {
  if (Array.isArray(tree)) tree.forEach((n) => modsOf(n, out));
  else if (tree && typeof tree === "object") {
    if (typeof tree.content?.mod === "string") out.add(tree.content.mod);
    for (const v of Object.values(tree)) if (v && typeof v === "object") modsOf(v, out);
  }
  return out;
}

// The keys.json bindings that belong to mod `name`: its own section, and keys that open it or run its commands.
export function keysOf(keys, name) {
  const out = [];
  for (const [section, map] of Object.entries(keys ?? {})) {
    if (!map || typeof map !== "object") continue;
    for (const [key, action] of Object.entries(map)) {
      const a = String(action);
      if (section === `mod:${name}` || a === `mod.open:${name}` || a.startsWith(`${name}:`)) out.push({ section, key, action: a });
    }
  }
  return out;
}

// The mods keys.json opens or runs: their names.
export function keyedMods(keys) {
  const out = new Set();
  for (const [section, map] of Object.entries(keys ?? {})) {
    if (section.startsWith("mod:")) out.add(section.slice(4));
    for (const a of Object.values(map ?? {})) {
      const m = String(a).match(/^mod\.open:(.+)$/);
      if (m) out.add(m[1]);
    }
  }
  return out;
}

export const layoutName = () => shared("layout") ?? "ray-theme";

// -> [{ name, title, kind: mine | clone | shipped | missing, size, files, mtime, nodes, keys, source, disabled }]
export async function inventory() {
  const home = appHome();
  const [inv, shipped, layout, keys, { reg }] = await Promise.all([
    exec("/bin/sh", [ops(), "inventory", home], { timeout: 60_000 }),
    readJson(`${home}/installed.json`),
    readJson(`${home}/layouts/${layoutName()}.json`),
    readJson(`${home}/keys.json`),
    load(),
  ]);
  const ship = new Set(Object.keys(shipped.json ?? {}));
  const rows = inv.stdout.split("\n").filter(Boolean).map((line) => {
    const [name, size, files, mtime] = line.split("\t");
    return { name, size: Number(size) || 0, files: Number(files) || 0, mtime: Number(mtime) * 1000 || 0 };
  });
  const titles = await Promise.all(rows.map((r) => readJson(`${home}/mods/${r.name}/mod.json`)));
  const items = rows.map((r, i) => {
    const mod = titles[i].json ?? {};
    const kind = ship.has(r.name) ? "shipped" : mod.cloned_from ? "clone" : "mine";
    return {
      ...r, title: mod.title ?? "", kind, cloned: mod.cloned_from ?? null,
      nodes: nodesOf(layout.json, r.name), keys: keysOf(keys.json, r.name),
      source: reg.sources[r.name] ?? null, disabled: reg.disabled[r.name] ?? null,
    };
  });
  // Used by the layout or keys.json but not installed.
  const have = new Set(items.map((i) => i.name));
  const wanted = new Set([...modsOf(layout.json), ...keyedMods(keys.json), ...Object.keys(reg.sources)]);
  for (const name of wanted) {
    if (have.has(name)) continue;
    items.push({ name, title: "", kind: "missing", size: 0, files: 0, mtime: 0, nodes: nodesOf(layout.json, name), keys: keysOf(keys.json, name), source: reg.sources[name] ?? null, disabled: reg.disabled[name] ?? null });
  }
  return items;
}
