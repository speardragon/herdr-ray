// Pull requests for the ray-theme side panel, under three filters:
//   This repo (default)  open PRs in the repository of the focused terminal's
//                        folder (else the space's): the first page pins those
//                        waiting for my review and mine above the others';
//   Mine / Review        my open PRs, or those waiting for my review, in every
//                        repository.
// Lists come 20 PRs a page, and a page is read from GitHub when it's first
// shown (see data.js, pages.js). Each row shows its checks (dot), review state
// and age; a row opens the PR in the browser; on hover, "To agent" asks the
// focused pane's agent to handle its review comments. The header picks the gh
// account to ask (see lib/github.js): when it can't see this repository the
// panel says so and offers the picker. The shown page rereads every 3 minutes
// and with ↻.

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, agents, focused, panes, spaces, hc, shared, setShared, props, closeOverlay } from "herdr";
import { readSearchPage, readRepoPage, findRepo, knownRepo, PAGE_SIZE } from "./data.js";
import { PagedLists } from "./pages.js";
import { accounts, chosenAccount, chooseAccount, openUrl, ALL } from "./lib/github.js";
import { tr } from "./i18n/i18n.js";
import { pager } from "./pager.js";
import { cached, fetchMissing, pathOf } from "./avatars.js";

const POLL_MS = 180_000; // the shown page rereads this often; going back to a page read sooner shows it as read
const FILTER_KEY = "ray.prs.filter";
const FILTERS = [
  { id: "repo", label: "This repo", tip: "Open PRs in the repository of the focused terminal's folder" },
  { id: "mine", label: "My pull requests", tip: "My open PRs in every repository" },
  { id: "review", label: "Review requested", tip: "Open PRs in every repository waiting for my review" },
];

const filterNow = () => (FILTERS.some((f) => f.id === shared(FILTER_KEY)) ? shared(FILTER_KEY) : "repo");

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return tr("<1m");
  if (m < 60) return tr("{n}m", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? tr("{n}h", { n: h }) : tr("{n}d", { n: Math.floor(h / 24) });
}

// The agent in the focused pane, else the focused agent.
function targetAgent() {
  const f = focused();
  const list = agents();
  return list.find((a) => a.pane === f?.pane) ?? list.find((a) => a.focused) ?? null;
}

// The focused terminal's folder, else the shown space's; null for a space on
// another machine (git and gh run on this computer).
function currentFolder() {
  const space = spaces().find((s) => s.active);
  if (!space || space.machine) return null;
  const f = focused();
  const pane = panes().find((p) => p.pane === f?.pane);
  return pane?.cwd || f?.cwd || space.folder || null;
}

const repoName = (remote) => `${remote.owner}/${remote.repo}`;

// A list's name: what it lists, as which account (another account, another list).
const listKey = (filter, remote) =>
  `${filter === "repo" ? `repo:${repoName(remote)}` : filter}|${chosenAccount() ?? ""}`.toLowerCase();

export default class Prs extends View {
  init(_props, cx) {
    this.lists = new PagedLists();
    this.inflight = new Set();
    this.picking = false;
    this.hovered = null;
    this.page = { key: null, n: 0 }; // the page shown, for the list named key
    this.hosts = { users: [], active: null };
    this.avatars = new Map(); // login -> a downloaded picture's path (avatars.js)
    cx.spawn(async (cx) => {
      this.avatars = await cached();
      cx.notify();
    });
    cx.timer.every(POLL_MS, (cx) => this.redraw(cx, true));
    accounts().then((hosts) => { this.hosts = hosts; }).catch(() => null);
  }

  // One read per name at a time; the panel redraws when it ends. Starting one
  // doesn't notify: render starts some, and notifying during render throws.
  // A click or timer that starts one redraws itself (see redraw).
  job(name, cx, work) {
    if (this.inflight.has(name)) return;
    this.inflight.add(name);
    cx.spawn(async (cx) => {
      try {
        this.hosts = await accounts();
        await work();
      } catch {
        // each work keeps its own failure to show; nothing else to do here
      } finally {
        this.inflight.delete(name);
        cx.notify();
      }
    });
  }

  // Reads page n of a list unless it was read lately (force: anyway, and drop
  // the list's other pages, which may have moved).
  loadPage(key, n, read, cx, force) {
    if (!this.lists.wants(key, n, force ? 0 : POLL_MS)) return;
    const after = this.lists.after(key, n);
    this.job(`${key}#${n}`, cx, async () => {
      const data = await read(after).catch((error) => ({ state: "error", error: String(error) }));
      this.lists.put(key, n, data, force);
      // The authors' pictures: shown as letters until they are here.
      const people = [data.items, data.review, data.mine].flat().filter(Boolean).map((pr) => ({ login: pr.author, url: pr.avatar }));
      const added = await fetchMissing(people, this.avatars).catch(() => new Map());
      if (added.size) this.avatars = new Map([...this.avatars, ...added]);
    });
  }

  // Starts whatever reads the shown page needs: the folder's repo, then the page.
  ensure(cx, force = false, filter = filterNow()) {
    if (filter !== "repo") {
      const key = listKey(filter);
      this.loadPage(key, this.pageFor(key), (after) => readSearchPage(filter, after), cx, force);
      return;
    }
    const folder = currentFolder();
    if (!folder) return;
    const info = knownRepo(folder);
    if (info === undefined || force) this.job(`folder:${folder}`, cx, () => findRepo(folder));
    if (!info?.remote) return;
    const key = listKey("repo", info.remote);
    this.loadPage(key, this.pageFor(key), (after) => readRepoPage(info.remote, after), cx, force);
  }

  // ensure() from a click or a timer, then redraw to show the busy ↻.
  redraw(cx, force, filter) {
    this.ensure(cx, force, filter);
    cx.notify();
  }

  // The page shown for the list named key; another list starts at its first.
  // A page whose cursor went away (the page before it, reread, ends the list
  // now) gives way to the last one that can be read.
  pageFor(key) {
    if (this.page.key !== key) this.page = { key, n: 0 };
    const last = this.lists.get(key).afters.length - 1;
    if (this.page.n > last) this.page = { key, n: last };
    return this.page.n;
  }

  accountLabel() {
    const chosen = chosenAccount();
    if (chosen === ALL) return tr("All accounts");
    if (chosen) return chosen;
    return this.hosts.active ? tr("gh default ({name})", { name: this.hosts.active }) : tr("gh default");
  }

  picker(t) {
    const { users, active } = this.hosts;
    const options = [
      { value: null, label: active ? tr("gh default ({name})", { name: active }) : tr("gh default") },
      ...users.map((u) => ({ value: u, label: u })),
      ...(users.length > 1 ? [{ value: ALL, label: tr("All accounts") }] : []),
    ];
    const chosen = chosenAccount();
    return v_flex().flex_none().p(5).gap(1).border_b(1).border_color(t.border).bg(t.surface)
      .children(options.map((o) => h_flex()
        .id(`acct-${o.value ?? "default"}`)
        .h(28)
        .px(9)
        .rounded(6)
        .items_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .text_color(o.value === chosen ? t.foreground : t.muted)
        .on_click((_e, cx) => {
          chooseAccount(o.value);
          this.picking = false;
          this.redraw(cx, false);
        })
        .child(div().flex_1().child(o.label))
        .when(o.value === chosen, (el) => el.child(div().text_color(t.accent).child("●")))));
  }

  filters(t, filter) {
    return h_flex().flex_none().px(9).py(6).gap(4).border_b(1).border_color(t.border)
      .children(FILTERS.map((f) => div()
        .id(`filter-${f.id}`)
        .px(9)
        .h(24)
        .flex()
        .items_center()
        .rounded(6)
        .cursor_pointer()
        .text_size(12.5)
        .tooltip(tr(f.tip))
        .when(f.id === filter, (el) => el.bg(t.raised).text_color(t.foreground).font_medium())
        .when(f.id !== filter, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => {
          setShared(FILTER_KEY, f.id);
          this.redraw(cx, false, f.id);
        })
        .child(tr(f.label))));
  }

  sendButton(t, pr) {
    const agent = targetAgent();
    if (!agent) return null;
    return div()
      .id(`send-${pr.key}`)
      .flex_none()
      .px(7)
      .h(22)
      .flex()
      .items_center()
      .rounded(5)
      .border_1()
      .border_color(t.border)
      .text_size(12)
      .text_color(t.muted)
      .hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tr("Ask {agent} to handle this PR's review comments", { agent: agent.program?.name ?? agent.title }))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        hc(["send", agent.address, tr("Check the review comments on {url} and address them.", { url: pr.url })]);
      })
      .child(tr("To agent"));
  }

  // The author's picture, round; their first letter on a gray disc until it is
  // downloaded (or for a deleted account, "?").
  avatar(t, pr) {
    const path = pathOf(this.avatars, pr.author);
    const disc = div().id(`by-${pr.key}`).size(22).flex_none().rounded(11).tooltip(pr.author || "ghost");
    if (path) return disc.child(image(path).size(22).rounded(11)); // the picture itself is rounded: its box clipping it did not
    return disc.flex().items_center().justify_center().bg(t.raised).text_size(11).font_semibold().text_color(t.muted).child([...(pr.author || "?")][0].toUpperCase());
  }

  // inRepo: the list is one repository's, so the meta names the author instead.
  // several: the list merges accounts, so the meta names the one that saw it.
  row(t, pr, inRepo, several) {
    const checks = { SUCCESS: t.done, FAILURE: t.blocked, ERROR: t.blocked, PENDING: t.working, EXPECTED: t.working }[pr.checks] ?? t.dim;
    const checksText = { SUCCESS: tr("Checks passed"), FAILURE: tr("Checks failed"), ERROR: tr("Checks failed"), PENDING: tr("Checks running"), EXPECTED: tr("Checks running") }[pr.checks] ?? tr("No checks");
    const review = { APPROVED: [tr("Approved"), t.done], CHANGES_REQUESTED: [tr("Changes requested"), t.blocked] }[pr.review];
    const where = inRepo ? [`#${pr.number}`, pr.author] : [`${pr.repo.split("/").pop()} #${pr.number}`];
    const meta = [...where, ago(pr.updated), pr.draft && tr("Draft"), several && pr.account].filter(Boolean).join(" · ");
    const send = this.hovered === pr.key ? this.sendButton(t, pr) : null;
    return h_flex()
      .id(`pr-${pr.key}`)
      .flex_none()
      .px(12)
      .py(7)
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = pr.key;
        else if (this.hovered === pr.key) this.hovered = null;
        cx.notify();
      })
      .on_click(() => openUrl(pr.url))
      .child(div().id(`checks-${pr.key}`).size(8).flex_none().rounded(4).bg(checks).tooltip(checksText))
      .child(this.avatar(t, pr))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_color(pr.draft ? t.muted : t.foreground).child(pr.title))
        .child(h_flex().gap(6).text_size(12).text_color(t.dim)
          .child(div().min_w(0).truncate().child(meta))
          .when(Boolean(review), (el) => el.child(div().flex_none().text_color(review[1]).child(review[0])))))
      .when(Boolean(send), (el) => el.child(send));
  }

  // count: the whole list's, when only one page of it is here.
  section(t, title, list, { inRepo = false, count = list.length, several = false } = {}) {
    return v_flex().flex_none().gap(1)
      .child(div().px(12).pt(10).pb(4).text_size(12).text_color(t.dim).child(`${title} ${count}`))
      .when(!list.length, (el) => el.child(div().px(12).py(4).text_size(12.5).text_color(t.dim).child(tr("Nothing here"))))
      .children(list.map((pr) => this.row(t, pr, inRepo, several)));
  }

  note(t, text, color = t.dim) {
    return div().px(14).py(10).text_color(color).whitespace_normal().child(text);
  }

  scroller(id = "prs-list") {
    return v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().px(5).pb(8);
  }

  // The footer for page n of a list, from what a read page said of the whole
  // (`meta`: this page, or the one before while this one loads).
  pagerFor(t, key, n, meta, shown) {
    const from = n * PAGE_SIZE + 1;
    const to = shown === null ? Math.min(meta.total, (n + 1) * PAGE_SIZE) : n * PAGE_SIZE + shown;
    const p = { n, pages: Math.max(meta.pages, n + 1), from, to, total: meta.total, hasNext: this.lists.hasNext(key, n) };
    return pager(t, p, (m, cx) => {
      this.page = { ...this.page, n: m };
      cx.notify();
    });
  }

  // Page n of a list: `children` in a scroller (a fresh scroll position per
  // page), the pager under it when the list is longer than a page.
  pageView(t, key, n, d, children) {
    return v_flex().flex_1().min_h(0)
      .child(this.scroller(`prs-list-${n}`).children(children))
      .when(d.pages > 1 || n > 0, (el) => el.child(this.pagerFor(t, key, n, d, d.items.length)));
  }

  // A page not read yet: "Loading…", with the pager when it's past the first.
  loadingView(t, key, n) {
    const before = n > 0 ? this.lists.page(key, n - 1) : null;
    const loading = this.note(t, tr("Loading…"));
    if (before?.state !== "ready") return loading;
    return v_flex().flex_1().min_h(0)
      .child(v_flex().flex_1().min_h(0).child(loading))
      .child(this.pagerFor(t, key, n, before, null));
  }

  // The picked account can't read this repository: say so, and offer the picker.
  denied(t, d) {
    const title = d.account
      ? tr("{account} can't see this repository.", { account: d.account })
      : tr("None of the signed-in accounts can see this repository.");
    return v_flex().flex_none().px(14).py(14).gap(8)
      .child(div().font_semibold().text_color(t.blocked).whitespace_normal().child(title))
      .when(Boolean(d.error), (el) => el.child(div().text_size(12).text_color(t.dim).whitespace_normal().child(d.error)))
      .child(div().text_size(12.5).text_color(t.muted).whitespace_normal().child(tr("Pick another account to read it with.")))
      .child(h_flex().child(div().id("pick-account").px(10).h(26).flex().items_center().rounded(6).cursor_pointer()
        .border_1().border_color(t.border).text_size(12.5).text_color(t.foreground)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.picking = true; cx.notify(); })
        .child(tr("Choose an account"))));
  }

  repoHead(t, remote, me) {
    const name = repoName(remote);
    return h_flex().flex_none().px(12).pt(8).gap(8).items_center().text_size(12.5)
      .child(div().id("repo-link").min_w(0).truncate().cursor_pointer().text_color(t.muted)
        .hover((s) => s.text_color(t.foreground))
        .tooltip(tr("Open the repository's pull requests on GitHub"))
        .on_click(() => openUrl(`https://github.com/${name}/pulls`))
        .child(name))
      .child(div().flex_1())
      .when(Boolean(me), (el) => el.child(div().id("repo-me").flex_none().text_color(t.dim)
        .tooltip(tr("Mine and review requests are counted for {name}", { name: me }))
        .child(`@${me}`)));
  }

  repoBody(t, folder) {
    if (!folder) return this.note(t, tr("Focus a terminal on this computer to see its repository's PRs."));
    const info = knownRepo(folder);
    if (info === undefined) return this.note(t, tr("Loading…"));
    if (!info?.remote) return this.note(t, tr("This folder isn't a GitHub repository."));
    const key = listKey("repo", info.remote);
    const n = this.pageFor(key);
    const d = this.lists.page(key, n);
    if (!d) return this.loadingView(t, key, n);
    if (d.state === "missing") return this.note(t, tr("gh isn't installed."));
    if (d.state === "denied") return this.denied(t, d);
    if (d.state === "error") return this.note(t, d.error, t.blocked);
    const head = this.repoHead(t, info.remote, this.lists.get(key).me);
    const pinned = n === 0 ? [
      [tr("Review requested"), d.review],
      [tr("My pull requests"), d.mine],
    ].filter(([, list]) => list.length).map(([title, list]) => this.section(t, title, list, { inRepo: true })) : [];
    if (n === 0 && !d.total && !pinned.length) {
      return this.scroller().child(head).child(this.note(t, tr("No open pull requests in this repository.")));
    }
    const others = d.total || n > 0 ? [this.section(t, tr("Other pull requests"), d.items, { inRepo: true, count: d.total })] : [];
    return this.pageView(t, key, n, d, [head, ...pinned, ...others]);
  }

  everywhereBody(t, filter) {
    const key = listKey(filter);
    const n = this.pageFor(key);
    const d = this.lists.page(key, n);
    if (!d) return this.loadingView(t, key, n);
    if (d.state === "missing") return this.note(t, tr("gh isn't installed."));
    if (d.state === "error") return this.note(t, d.error, t.blocked);
    const title = filter === "review" ? tr("Review requested") : tr("My pull requests");
    return this.pageView(t, key, n, d, [
      ...d.errors.map((e) => this.note(t, e, t.blocked)),
      this.section(t, title, d.items, { count: d.total, several: d.several }),
    ]);
  }

  render(cx) {
    const t = theme();
    const filter = filterNow();
    // Opened on its own (mod.open), it is a window and gets a ✕.
    const closeButton = (t) => div().id("close").flex_none().size(24).flex().items_center().justify_center().rounded(6)
      .text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tr("Close"))
      .on_click(() => closeOverlay(props().overlay))
      .child("✕");
    this.ensure(cx, false, filter);
    return v_flex()
      .id("ray-prs")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(13.5)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_none().font_semibold().child(tr("Pull requests")))
        .child(div().flex_1())
        .child(h_flex().id("account").min_w(0).px(7).h(24).gap(5).items_center().rounded(6).cursor_pointer()
          .text_size(12.5).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(tr("GitHub account to ask"))
          .on_click((_e, cx) => { this.picking = !this.picking; cx.notify(); })
          .child(div().min_w(0).truncate().child(this.accountLabel())).child(div().flex_none().child("▾")))
        .child(div().id("refresh").flex_none().size(24).flex().items_center().justify_center().rounded(6)
          .text_color(this.inflight.size ? t.working : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(tr("Refresh"))
          .on_click((_e, cx) => this.redraw(cx, true))
          .child("↻"))
        .when(Boolean(props()?.overlay), (el) => el.child(closeButton(t))))
      .when(this.picking, (el) => el.child(this.picker(t)))
      .child(this.filters(t, filter))
      .child(filter === "repo" ? this.repoBody(t, currentFolder()) : this.everywhereBody(t, filter));
  }
}
