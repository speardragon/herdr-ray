// The footer under a PR list longer than one page: where this page sits in
// the list, and ‹ › to the page before and after. The page after can be
// reached once this one is read (its cursor comes with it; see pages.js).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { tr } from "./i18n/i18n.js";

function step(t, id, label, to, go) {
  const enabled = to !== null;
  return div().id(id).size(24).flex().items_center().justify_center().rounded(6).text_size(15)
    .when(enabled, (el) => el.cursor_pointer().text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => go(to, cx)))
    .when(!enabled, (el) => el.text_color(t.border))
    .child(label);
}

// p: { n (0-based), pages, from, to, total, hasNext }; go(n, cx) shows page n.
export function pager(t, p, go) {
  return h_flex().flex_none().h(36).px(12).gap(4).items_center().border_t(1).border_color(t.border)
    .text_size(12.5).text_color(t.dim)
    .child(div().flex_1().min_w(0).truncate().child(tr("{from}–{to} of {total}", { from: p.from, to: p.to, total: p.total })))
    .child(step(t, "page-prev", "‹", p.n > 0 ? p.n - 1 : null, go))
    .child(div().px(4).flex_none().child(`${p.n + 1} / ${p.pages}`))
    .child(step(t, "page-next", "›", p.hasNext ? p.n + 1 : null, go));
}
