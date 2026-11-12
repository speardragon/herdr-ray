// The PR lists the panel reads from GitHub a page at a time, by name (see
// listKey in main.js). For each list it keeps the pages read so far and the
// cursor each page is read with: page 0 with none, page n with the `next` that
// page n - 1 answered. A page is read when it's shown, so a cursor is known for
// every page up to one past the last one read.

const EMPTY = { afters: [null], pages: new Map(), me: "" };

export class PagedLists {
  constructor() {
    this.lists = new Map(); // key -> { afters, pages: Map n -> { at, data }, me }
  }

  get(key) {
    return this.lists.get(key) ?? EMPTY;
  }

  // Page n's answer, or null before it's read.
  page(key, n) {
    return this.get(key).pages.get(n)?.data ?? null;
  }

  // The cursor to read page n with (null for the first page).
  after(key, n) {
    return this.get(key).afters[n] ?? null;
  }

  hasNext(key, n) {
    return this.get(key).afters.length > n + 1;
  }

  // Whether page n should be read: its cursor is known and it hasn't been read
  // in the last maxAge ms.
  wants(key, n, maxAge) {
    const list = this.get(key);
    if (n >= list.afters.length) return false;
    const hit = list.pages.get(n);
    return !hit || Date.now() - hit.at >= maxAge;
  }

  // Keeps page n's answer and the cursor it gives the page after it.
  // `refreshed`: the other pages are dropped, as the list may have moved.
  put(key, n, data, refreshed) {
    const list = this.get(key);
    const ready = data?.state === "ready";
    const afters = !ready ? list.afters
      : data.next ? [...list.afters.slice(0, n + 1), data.next, ...list.afters.slice(n + 2)]
        : list.afters.slice(0, n + 1);
    const pages = new Map(refreshed ? [] : list.pages).set(n, { at: Date.now(), data });
    const me = (ready && data.me) || list.me;
    this.lists = new Map(this.lists).set(key, { afters, pages, me });
  }
}
