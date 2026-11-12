// The authors' pictures. The app draws an image from its own folder, so each
// one is downloaded once (GitHub's avatar address is public: no sign-in) into
// ~/.config/herdr-app/ray-prs/avatars/<login>.<ext> and kept: the next start
// finds them there. A picture is cached by its path, so one that changed on
// GitHub keeps its old look until its file is deleted.

import { appHome, exec } from "herdr";

const DIR = "ray-prs/avatars";
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const CURL = ["-fsSL", "--max-time", "10", "--max-filesize", "2000000", "--proto", "=https", "--proto-redir", "=https"];
const AT_ONCE = 6;

const safe = (login) => login.replace(/[^A-Za-z0-9_-]/g, "_");

// The pictures already here: Map login (as safe()) -> path under the app's home.
export async function cached() {
  const r = await exec("ls", [`${appHome()}/${DIR}`], { timeout: 10_000 }).catch(() => null);
  if (!r || r.code !== 0) return new Map();
  return new Map(r.stdout.split("\n").filter((f) => /\.[a-z]+$/.test(f) && !f.startsWith(".")).map((f) => [f.replace(/\.[a-z]+$/, ""), `${DIR}/${f}`]));
}

export const pathOf = (have, login) => (login ? have.get(safe(login)) ?? null : null);

async function fetchOne(person) {
  const dir = `${appHome()}/${DIR}`;
  const temp = `${dir}/.dl-${safe(person.login)}-${Date.now()}`;
  try {
    const got = await exec("curl", [...CURL, "-o", temp, person.url], { timeout: 20_000 });
    if (got.code !== 0) return null;
    const kind = await exec("file", ["--mime-type", "-b", temp], { timeout: 10_000 }).catch(() => null);
    const ext = kind?.code === 0 ? EXT[kind.stdout.trim()] : ".png";
    if (!ext) return null;
    const name = `${safe(person.login)}${ext}`;
    const moved = await exec("mv", [temp, `${dir}/${name}`], { timeout: 10_000 });
    return moved.code === 0 ? [safe(person.login), `${DIR}/${name}`] : null;
  } catch {
    return null;
  } finally {
    exec("rm", ["-f", temp]).catch(() => null);
  }
}

// Downloads the pictures of `people` ([{ login, url }]) not in `have`.
// -> Map of the new ones, same shape as cached().
export async function fetchMissing(people, have) {
  const seen = new Set();
  const todo = people.filter((p) => p.login && p.url?.startsWith("https://") && !have.has(safe(p.login)) && !seen.has(p.login) && seen.add(p.login));
  if (!todo.length) return new Map();
  await exec("mkdir", ["-p", `${appHome()}/${DIR}`], { timeout: 10_000 });
  const got = [];
  for (let i = 0; i < todo.length; i += AT_ONCE) got.push(...(await Promise.all(todo.slice(i, i + AT_ONCE).map(fetchOne))));
  return new Map(got.filter(Boolean));
}
