// The PR panel's data, read from GitHub one page (20 PRs) at a time with the
// gh account picked in the panel:
//   readSearchPage()  my open PRs, or those waiting for my review, in every
//                     repository;
//   readRepoPage()    one repository's open PRs: its first page also carries
//                     the ones waiting for my review and mine, the pages page
//                     through the others';
//   findRepo()        the GitHub repository a folder belongs to.
// A page is asked for with the cursor the page before it answered (`next`);
// the first page with none. Search cursors count from the top of the list,
// so the same cursor reads the same place again after a refresh.

import { exec } from "herdr";
import { accounts, gh, ghForRepo, chosenAccount, parseRemote, ALL } from "./lib/github.js";

export const PAGE_SIZE = 20;
const PINNED_MAX = 50; // the first page's "waiting for my review" and "mine" in a repo
const TIMEOUT = 30_000;

const FIELDS = `number title url isDraft updatedAt reviewDecision
  author { login avatarUrl(size: 64) }
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

const PAGE = `issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${FIELDS} } }`;

const PAGE_QUERY = `query($q: String!, $after: String) {
  page: search(query: $q, type: ISSUE, first: ${PAGE_SIZE}, after: $after) { ${PAGE} }
}`;

// A repo's first page: who "me" is, whether the account can see the repo at
// all (`repository` fails when it can't; a search would just come back empty),
// and the pinned lists beside the first page of the others'.
const REPO_FIRST_QUERY = `query($owner: String!, $name: String!, $review: String!, $mine: String!, $q: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) { id }
  review: search(query: $review, type: ISSUE, first: ${PINNED_MAX}) { nodes { ... on PullRequest { ${FIELDS} } } }
  mine: search(query: $mine, type: ISSUE, first: ${PINNED_MAX}) { nodes { ... on PullRequest { ${FIELDS} } } }
  page: search(query: $q, type: ISSUE, first: ${PAGE_SIZE}) { ${PAGE} }
}`;

const SEARCH = {
  mine: "is:pr is:open author:@me archived:false sort:updated-desc",
  review: "is:pr is:open review-requested:@me archived:false sort:updated-desc",
};

const repoSearch = (remote) => {
  const repo = `repo:${remote.owner}/${remote.repo} is:pr is:open`;
  return {
    review: `${repo} review-requested:@me sort:updated-desc`,
    mine: `${repo} author:@me sort:updated-desc`,
    others: `${repo} -author:@me -review-requested:@me sort:updated-desc`,
  };
};

function toPr(node, account) {
  return {
    key: node.url,
    number: node.number,
    title: node.title,
    url: node.url,
    repo: node.repository?.nameWithOwner ?? "",
    author: node.author?.login ?? "",
    avatar: node.author?.avatarUrl ?? null,
    draft: node.isDraft,
    updated: Date.parse(node.updatedAt) || 0,
    review: node.reviewDecision ?? null,
    checks: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
    account,
  };
}

const prsOf = (list, account) => (list?.nodes ?? []).filter((n) => n?.url).map((n) => toPr(n, account));
const pagesOf = (total) => Math.max(1, Math.ceil(total / PAGE_SIZE));
const firstLine = (r) => (r.stderr || r.stdout).trim().split("\n")[0] ?? "";

function parseData(stdout) {
  try {
    return JSON.parse(stdout).data ?? null;
  } catch {
    return null;
  }
}

// The accounts the chosen setting stands for: [null] is gh's default.
async function accountsToAsk() {
  const list = await accounts();
  const chosen = chosenAccount();
  if (chosen === ALL && list.users.length) return { ask: list.users, list };
  if (chosen && chosen !== ALL && list.users.includes(chosen)) return { ask: [chosen], list };
  return { ask: [null], list };
}

// One page of a search as one account: { items, total, next } | { error } | { missing }.
async function searchAs(account, label, q, after) {
  const args = ["api", "graphql", "-f", `query=${PAGE_QUERY}`, "-f", `q=${q}`, ...(after ? ["-f", `after=${after}`] : [])];
  let r;
  try {
    r = await gh(args, { account, timeout: TIMEOUT });
  } catch {
    return { missing: true };
  }
  if (r.code !== 0) return { error: `${label}: ${firstLine(r)}` };
  const page = parseData(r.stdout)?.page;
  if (!page) return { error: `${label}: unreadable answer from gh` };
  return { items: prsOf(page, label), total: page.issueCount ?? 0, next: page.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null };
}

// One page of "mine" or "review" across the picked accounts. `after` is the
// `next` of the page before: { [account]: cursor } (an account missing from it
// has no more pages). Answers
// { state: "ready", items, total, pages, next, errors, several } | { state: "missing" }.
export async function readSearchPage(kind, after = null) {
  const { ask, list } = await accountsToAsk();
  const labels = ask.map((a) => a ?? list.active ?? "gh");
  const answers = await Promise.all(ask.map((a, i) => {
    if (after && !after[labels[i]]) return Promise.resolve({ items: [], total: 0, next: null, done: true });
    return searchAs(a, labels[i], SEARCH[kind], after?.[labels[i]]);
  }));
  if (answers.every((a) => a.missing)) return { state: "missing" };
  const byUrl = new Map();
  for (const a of answers) for (const pr of a.items ?? []) if (!byUrl.has(pr.url)) byUrl.set(pr.url, pr);
  const cursors = Object.fromEntries(answers.flatMap((a, i) => (a.next ? [[labels[i], a.next]] : [])));
  const totals = answers.filter((a) => !a.done).map((a) => a.total ?? 0);
  return {
    state: "ready",
    items: [...byUrl.values()].sort((x, y) => y.updated - x.updated),
    total: totals.reduce((s, n) => s + n, 0),
    pages: Math.max(1, ...totals.map(pagesOf)),
    next: Object.keys(cursors).length ? cursors : null,
    errors: answers.map((a) => a.error).filter(Boolean),
    several: ask.length > 1,
  };
}

// Folders -> { root, remote: { owner, repo } | null } | null (not in a git
// repo), remembered for a few minutes: the panel asks on every focus change.
const FOLDER_TTL = 5 * 60_000;
const folders = new Map();

// What's known now: undefined (not asked yet), null, or { root, remote }.
export const knownRepo = (folder) => folders.get(folder)?.info;

async function repoOf(folder) {
  const r = await exec("git", ["-C", folder, "rev-parse", "--show-toplevel"], { timeout: 5_000 });
  if (r.code !== 0) return null;
  const root = r.stdout.trim();
  const url = await exec("git", ["-C", root, "remote", "get-url", "origin"], { timeout: 5_000 });
  return { root, remote: url.code === 0 ? parseRemote(url.stdout) : null };
}

export async function findRepo(folder) {
  const hit = folders.get(folder);
  if (hit && Date.now() - hit.at < FOLDER_TTL) return hit.info;
  const info = await repoOf(folder).catch(() => null);
  folders.set(folder, { at: Date.now(), info });
  return info;
}

// gh's answer when the account can't see the repo (private, wrong account,
// no token for that login).
const DENIED = /Could not resolve to a Repository|HTTP 40[134]|Bad credentials|authentication|no oauth token|not found/i;

// The picked account reads the repo; "All accounts" tries each until one can
// (and keeps asking with the one that could).
async function askRepo(remote, args) {
  const list = await accounts();
  const chosen = chosenAccount();
  const all = chosen === ALL && list.users.length > 1;
  const account = chosen && chosen !== ALL && list.users.includes(chosen) ? chosen : null;
  const label = all ? null : account ?? list.active ?? "gh";
  try {
    const r = all ? await ghForRepo(remote, args, { timeout: TIMEOUT }) : await gh(args, { account, timeout: TIMEOUT });
    return { r, label };
  } catch {
    return { r: null, label };
  }
}

// Page `after` of a repo's open PRs (null: the first page).
// { state: "ready", items, total, pages, next, me?, review?, mine? }
// | { state: "denied", account, error } | { state: "error", error } | { state: "missing" }
export async function readRepoPage(remote, after = null) {
  const q = repoSearch(remote);
  const args = after
    ? ["api", "graphql", "-f", `query=${PAGE_QUERY}`, "-f", `q=${q.others}`, "-f", `after=${after}`]
    : ["api", "graphql", "-f", `query=${REPO_FIRST_QUERY}`, "-f", `owner=${remote.owner}`, "-f", `name=${remote.repo}`,
      "-f", `review=${q.review}`, "-f", `mine=${q.mine}`, "-f", `q=${q.others}`];
  const { r, label } = await askRepo(remote, args);
  if (!r) return { state: "missing" };
  if (r.code !== 0) {
    const error = firstLine(r);
    return DENIED.test(r.stderr) || r.code === 4 ? { state: "denied", account: label, error } : { state: "error", error };
  }
  const data = parseData(r.stdout);
  if (!data?.page) return { state: "error", error: "unreadable answer from gh" };
  if (!after && !data.repository) return { state: "denied", account: label, error: "" };
  const me = data.viewer?.login ?? "";
  const total = data.page.issueCount ?? 0;
  return {
    state: "ready",
    items: prsOf(data.page, me),
    total,
    pages: pagesOf(total),
    next: data.page.pageInfo?.hasNextPage ? data.page.pageInfo.endCursor : null,
    ...(after ? {} : { me, review: prsOf(data.review, me), mine: prsOf(data.mine, me) }),
  };
}
