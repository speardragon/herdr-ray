// Copied from mods/ray-locale by its sync.sh: edit it there, then run sync.sh.
// GitHub through the gh CLI, shared by the ray-theme mods that show PRs.
//
// Which account asks:
//   - shared "ray.gh.account": null (default) for gh's own active account, a
//     login picked in the PR panel, or "*" for every logged-in account;
//   - for one repo, a logged-in account named like the repo's owner goes
//     first, so a personal account reads its own private repos; if the first
//     try can't see the repo, the other logged-in accounts are tried, and the
//     one that worked is remembered for that repo.
// Logged-in accounts come from gh's hosts.yml; with none found, gh's default.

import { exec, home, readTextFile, shared, setShared, window } from "herdr";

const KEY = "ray.gh.account";
export const ALL = "*";

// Opens a link in the default browser.
export function openUrl(url) {
  const platform = window()?.platform;
  const [command, args] = platform === "macos" ? ["open", [url]]
    : platform === "windows" ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  return exec(command, args, { timeout: 10_000 }).catch(() => null);
}

export const chosenAccount = () => shared(KEY) ?? null;
export const chooseAccount = (value) => setShared(KEY, value);

// The github.com block of hosts.yml: its users and the active one.
export function parseHosts(text) {
  const lines = (text ?? "").split("\n");
  const start = lines.findIndex((l) => /^github\.com:\s*$/.test(l));
  if (start < 0) return { users: [], active: null };
  const users = [];
  let active = null;
  let usersAt = -1;   // indent of the "users:" key while inside it
  let userIndent = -1; // indent of its children (the logins)
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = line.match(/^(\s*)([^:#\s][^:]*):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2].trim();
    const value = m[3].trim();
    if (usersAt >= 0 && indent > usersAt) {
      if (userIndent < 0) userIndent = indent;
      if (indent === userIndent) users.push(key);
      continue;
    }
    usersAt = key === "users" && !value ? indent : -1;
    userIndent = -1;
    if (key === "user" && value) active = value;
  }
  return { users, active: active ?? users[0] ?? null };
}

let hostsCache = null;
let hostsAt = 0;

export async function accounts() {
  if (hostsCache && Date.now() - hostsAt < 60_000) return hostsCache;
  const config = `${home()}/.config/gh/hosts.yml`;
  hostsCache = parseHosts(await readTextFile(config).catch(() => null));
  hostsAt = Date.now();
  return hostsCache;
}

// Runs gh as `account` (null: whoever gh is logged in as).
export function gh(args, { account = null, cwd, timeout = 20_000 } = {}) {
  if (!account) return exec("gh", args, { cwd, timeout });
  const script = 'GH_TOKEN="$(gh auth token --hostname github.com --user "$1")" || exit 4; shift; export GH_TOKEN; exec gh "$@"';
  return exec("/bin/sh", ["-c", script, "sh", account, ...args], { cwd, timeout });
}

// owner/repo from a GitHub remote: https, ssh, and ssh host aliases
// ("git@github.com-work:owner/repo.git").
export function parseRemote(url) {
  const m = (url ?? "").trim().match(/github\.com[^:/]*[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// The order to try accounts in for a repo of `owner`.
export function accountsFor(owner, { users, active }) {
  const chosen = chosenAccount();
  const own = users.find((u) => u.toLowerCase() === (owner ?? "").toLowerCase());
  const first = own ?? (chosen && chosen !== ALL && users.includes(chosen) ? chosen : active);
  return [first, ...users.filter((u) => u !== first)].filter((u, i, all) => u !== undefined && all.indexOf(u) === i);
}

const worked = new Map(); // "owner/repo" -> account that could see it

// Runs a repo-scoped gh command, trying accounts until one can see the repo.
// "No PR for this branch" is an answer, not a reason to try another account.
export async function ghForRepo(remote, args, options = {}) {
  const list = await accounts();
  const key = `${remote.owner}/${remote.repo}`.toLowerCase();
  const order = accountsFor(remote.owner, list);
  const known = worked.get(key);
  const tries = known !== undefined ? [known, ...order.filter((a) => a !== known)] : order;
  let last = null;
  for (const account of tries.length ? tries : [null]) {
    last = await gh(args, { ...options, account });
    const denied = last.code !== 0 && /Could not resolve to a Repository|HTTP 40[134]|authentication|not found/i.test(last.stderr)
      && !/no pull requests found/i.test(last.stderr);
    if (!denied) {
      worked.set(key, account);
      return last;
    }
  }
  return last;
}
