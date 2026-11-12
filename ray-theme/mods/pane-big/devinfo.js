// What a pane header shows about the code in its folder: the GitHub PR for its
// branch (number, state, checks) and the Jira issue named in the branch
// ("feature/EDU-1340-x" -> EDU-1340, via the `twg` CLI when installed).
//
// Every pane header of a repo asks the same questions, so answers are cached
// here at module level (module code is shared by all copies of this mod), with
// one request in flight per question.

import { exec } from "herdr";
import { ghForRepo, parseRemote } from "./lib/github.js";

const REPO_TTL = 5 * 60_000;
const PR_TTL = 60_000;
const ISSUE_TTL = 10 * 60_000;
const cache = new Map();

// The cached value now (maybe stale), starting a reload when it's older than ttl.
function cached(key, ttl, load) {
  let entry = cache.get(key);
  if (!entry) {
    entry = { at: 0, value: undefined, promise: null };
    cache.set(key, entry);
  }
  if (!entry.promise && Date.now() - entry.at >= ttl) {
    entry.promise = load()
      .catch(() => entry.value)
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
        entry.promise = null;
        return value;
      });
  }
  return entry;
}

async function settle(entry) {
  return entry.promise ? entry.promise : entry.value;
}

// { root, remote: { owner, repo } | null } for a folder inside a git repo, else null.
async function repoOf(cwd) {
  const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 5_000 });
  if (r.code !== 0) return null;
  const root = r.stdout.trim();
  const url = await exec("git", ["-C", root, "remote", "get-url", "origin"], { timeout: 5_000 });
  return { root, remote: url.code === 0 ? parseRemote(url.stdout) : null };
}

function checksOf(rollup) {
  const states = (rollup ?? []).map((c) => (c.conclusion || c.state || c.status || "").toUpperCase());
  if (!states.length) return null;
  if (states.some((s) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s))) return "failed";
  if (states.some((s) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "EXPECTED", "WAITING", "REQUESTED"].includes(s))) return "running";
  return "passed";
}

async function prOf(repo, branch) {
  const r = await ghForRepo(repo.remote, ["pr", "view", branch, "--json", "number,title,state,isDraft,url,statusCheckRollup"], { cwd: repo.root });
  if (r.code !== 0) return null;
  const pr = JSON.parse(r.stdout);
  return { number: pr.number, title: pr.title, state: pr.isDraft ? "DRAFT" : pr.state, url: pr.url, checks: checksOf(pr.statusCheckRollup) };
}

let twgMissing = false;

async function issueOf(key) {
  if (twgMissing) return null;
  let r;
  try {
    r = await exec("twg", ["-o", "json", "--output-summary", "none", "jira", "workitem", "get", key], { timeout: 20_000 });
  } catch {
    twgMissing = true;
    return null;
  }
  if (r.code !== 0) return null;
  const item = JSON.parse(r.stdout).data?.[0];
  if (!item?.key) return null;
  const site = r.stdout.match(/https:\/\/[^"/\s]+\/browse\//)?.[0] ?? null;
  return { key: item.key, title: item.summary ?? "", status: item.status?.name ?? "", url: site ? `${site}${item.key}` : null };
}

export const issueKey = (branch) => branch?.match(/(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]+-\d+)/)?.[1]?.toUpperCase() ?? null;

// Answers what's cached now: { pr, issue } (each may be null or undefined: unknown yet).
export function peek(cwd, branch) {
  const repo = cache.get(`repo:${cwd}`)?.value;
  const key = issueKey(branch);
  return {
    pr: repo?.remote && branch ? cache.get(`pr:${repo.root}:${branch}`)?.value : null,
    issue: key ? cache.get(`issue:${key}`)?.value : null,
  };
}

// Refreshes what's due for this folder and branch; resolves once all answered.
export async function refresh(cwd, branch) {
  if (!cwd) return;
  const repo = await settle(cached(`repo:${cwd}`, REPO_TTL, () => repoOf(cwd)));
  const jobs = [];
  if (repo?.remote && branch && branch !== "HEAD") {
    jobs.push(settle(cached(`pr:${repo.root}:${branch}`, PR_TTL, () => prOf(repo, branch))));
  }
  const key = issueKey(branch);
  if (key) jobs.push(settle(cached(`issue:${key}`, ISSUE_TTL, () => issueOf(key))));
  await Promise.all(jobs);
}
