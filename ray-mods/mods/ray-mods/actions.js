// What the Mods panel does to a mod. Each returns { ok, text } for the panel to
// show. Nothing is deleted for good: replaced or removed folders go under
// .install-spare/ (ops.sh), and turning a mod off is undone by turning it on.

import { appHome, exec, readTextFile, writeTextFile } from "herdr";
import { accounts, accountsFor, ghForRepo } from "./lib/github.js";
import { readJson, keysOf, layoutName, nodesOf } from "./inventory.js";
import { update as save } from "./registry.js";
import { tr } from "./i18n/i18n.js";

const ops = () => `${appHome()}/mods/ray-mods/ops.sh`;
const sh = (args, timeout = 60_000) => exec("/bin/sh", [ops(), ...args], { timeout });
const short = (sha) => (sha ?? "").slice(0, 7);
const firstLine = (s) => String(s ?? "").split("\n")[0].trim();

export const fingerprint = async (name) => (await sh(["fingerprint", `${appHome()}/mods/${name}`])).stdout.trim() || null;

const remoteOf = (repo) => {
  const [owner, name] = String(repo).split("/");
  return owner && name ? { owner, repo: name } : null;
};

// The newest commit that changed the mod's folder in its repo. -> { sha, date, message } or { error }
export async function latest(source) {
  const remote = remoteOf(source.repo);
  if (!remote) return { error: tr("Not a repository: {repo}", { repo: source.repo }) };
  const r = await ghForRepo(remote, ["api", `repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`]);
  if (r.code !== 0) return { error: firstLine(r.stderr) || tr("Couldn't reach GitHub.") };
  try {
    const c = JSON.parse(r.stdout)?.[0];
    if (!c) return { error: tr("{path} isn't in {repo}.", { path: source.path, repo: source.repo }) };
    return { sha: c.sha, date: Date.parse(c.commit?.committer?.date ?? "") || null, message: firstLine(c.commit?.message) };
  } catch {
    return { error: tr("GitHub gave an answer that couldn't be read.") };
  }
}

// Links a mod to `owner/repo` (its folder there: mods/<mod> unless `path`), after checking it is there.
export async function link(name, repo, path = `mods/${name}`) {
  const source = { repo: repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, ""), path };
  const head = await latest(source);
  if (head.error) return { ok: false, text: head.error };
  await save((reg) => ({ ...reg, sources: { ...reg.sources, [name]: { ...source, commit: null, fingerprint: null, at: Date.now() } } }));
  return { ok: true, text: tr("Linked to {repo}. Latest: {sha} {message}", { repo: source.repo, sha: short(head.sha), message: head.message }) };
}

export async function unlink(name) {
  await save((reg) => { const { [name]: _gone, ...sources } = reg.sources; return { ...reg, sources }; });
  return { ok: true, text: tr("Unlinked.") };
}

// Installs the newest commit of the mod's folder over the one here (the old one is kept aside),
// checks that it loads, and puts the old one back if it doesn't.
export async function upgrade(item) {
  const source = item.source;
  const head = await latest(source);
  if (head.error) return { ok: false, text: head.error };
  const home = appHome();
  const tar = `${home}/.install-spare/${item.name}-${short(head.sha)}.tgz`;
  await exec("mkdir", ["-p", `${home}/.install-spare`], { timeout: 10_000 });
  const owner = source.repo.split("/")[0];
  const tries = accountsFor(owner, await accounts());
  const got = await sh(["download", tar, source.repo, head.sha, ...tries], 120_000);
  if (got.code !== 0) return { ok: false, text: tr("Couldn't download {repo}.", { repo: source.repo }) };
  const put = await sh(["install", home, item.name, tar, source.path], 120_000);
  exec("rm", ["-f", tar]).catch(() => null);
  if (put.code !== 0) return { ok: false, text: firstLine(put.stderr) || tr("Couldn't install it.") };
  const backup = put.stdout.trim();
  const check = await exec("herdr-app", ["check", `${home}/mods/${item.name}`], { timeout: 60_000 }).catch(() => null);
  if (check && check.code !== 0) {
    if (backup) await sh(["restore", home, item.name, backup]);
    return { ok: false, text: tr("The new version doesn't load, so the old one is back: {error}", { error: firstLine(check.stderr || check.stdout) }) };
  }
  const fp = await fingerprint(item.name);
  await save((reg) => ({ ...reg, sources: { ...reg.sources, [item.name]: { ...source, commit: head.sha, fingerprint: fp, at: Date.now() } } }));
  return { ok: true, text: tr("Updated to {sha} ({message}).", { sha: short(head.sha), message: head.message }) + (backup ? ` ${tr("The old one is in {path}.", { path: backup.replace(`${home}/`, "") })}` : "") };
}

// Hides the mod's nodes in the shown layout and takes its keys out of keys.json; on() undoes it.
export async function off(item) {
  const home = appHome();
  const name = item.name;
  const lp = `${home}/layouts/${layoutName()}.json`;
  const layout = await readJson(lp);
  const keys = await readJson(`${home}/keys.json`);
  const hide = nodesOf(layout.json, name).filter((n) => !n.hidden).map((n) => n.id);
  const took = keysOf(keys.json, name);
  if (hide.length && layout.json) {
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (n.content?.mod === name && hide.includes(n.id)) n.hidden = true; Object.values(n).forEach((v) => v && typeof v === "object" && walk(v)); } };
    walk(layout.json);
    await writeTextFile(lp, `${JSON.stringify(layout.json, null, 2)}\n`, layout.text);
  }
  if (took.length && keys.json) {
    const next = JSON.parse(JSON.stringify(keys.json));
    for (const k of took) {
      delete next[k.section][k.key];
      if (!Object.keys(next[k.section]).length && k.section !== "global") delete next[k.section];
    }
    await writeTextFile(`${home}/keys.json`, `${JSON.stringify(next, null, 2)}\n`, keys.text);
  }
  await save((reg) => ({ ...reg, disabled: { ...reg.disabled, [name]: { layout: layoutName(), nodes: hide, keys: took, at: Date.now() } } }));
  return { ok: true, text: tr("Turned off: {nodes} block(s) hidden, {keys} key(s) put away.", { nodes: hide.length, keys: took.length }) };
}

export async function on(item) {
  const home = appHome();
  const name = item.name;
  const rec = item.disabled;
  const lp = `${home}/layouts/${rec.layout ?? layoutName()}.json`;
  const layout = await readJson(lp);
  if (rec.nodes?.length && layout.json) {
    const walk = (n) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { if (rec.nodes.includes(n.id) && n.content?.mod === name) delete n.hidden; Object.values(n).forEach((v) => v && typeof v === "object" && walk(v)); } };
    walk(layout.json);
    await writeTextFile(lp, `${JSON.stringify(layout.json, null, 2)}\n`, layout.text);
  }
  const clash = [];
  if (rec.keys?.length) {
    const keys = await readJson(`${home}/keys.json`);
    const next = JSON.parse(JSON.stringify(keys.json ?? {}));
    for (const k of rec.keys) {
      next[k.section] ??= {};
      if (next[k.section][k.key] && next[k.section][k.key] !== k.action) { clash.push(k.key); continue; } // taken meanwhile: left as it is
      next[k.section][k.key] = k.action;
    }
    await writeTextFile(`${home}/keys.json`, `${JSON.stringify(next, null, 2)}\n`, keys.text);
  }
  await save((reg) => { const { [name]: _gone, ...disabled } = reg.disabled; return { ...reg, disabled }; });
  return { ok: true, text: clash.length ? tr("Turned on. These keys are used by something else now and were left: {keys}", { keys: clash.join(", ") }) : tr("Turned on.") };
}

// Moves the mod's folder aside, when nothing in the layout uses it.
export async function remove(item) {
  const home = appHome();
  if (item.nodes.length) return { ok: false, text: tr("The layout still uses it ({nodes}). Take it out of the layout first.", { nodes: item.nodes.map((n) => n.id).join(", ") }) };
  if (item.keys.length) await off(item); // its keys go too (kept in the registry)
  const r = await sh(["trash", home, item.name]);
  if (r.code !== 0) return { ok: false, text: tr("Couldn't move it.") };
  await save((reg) => { const { [item.name]: _s, ...sources } = reg.sources; const { [item.name]: _d, ...disabled } = reg.disabled; return { sources, disabled }; });
  return { ok: true, text: tr("Removed. It is kept in {path} if you want it back.", { path: r.stdout.trim().replace(`${home}/`, "") }) };
}

export const openFolder = (name) => exec("open", [`${appHome()}/mods/${name}`], { timeout: 10_000 }).catch(() => null);
