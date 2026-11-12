// One mod: what it is, where it comes from, where it is used, and what can be done to it.

import { div } from "gpui-kit";
import { v_flex, h_flex, Input } from "gpui-base";
import { badges, KIND } from "./list.js";
import { tr } from "./i18n/i18n.js";

const pad = (n) => String(n).padStart(2, "0");
const when = (ms) => { if (!ms) return "–"; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const short = (sha) => (sha ? sha.slice(0, 7) : "–");

const field = (t, label, value) => h_flex().gap(10).items_start().py(3)
  .child(div().w(84).flex_none().text_size(12).text_color(t.dim).child(label))
  .child(div().flex_1().min_w(0).whitespace_normal().text_size(12.5).text_color(t.foreground).child(value));

function button(t, id, label, go, { primary = false, danger = false, busy = false, off = false } = {}) {
  const color = danger ? t.blocked : t.accent;
  return div().id(id).flex_none().px(11).h(30).flex().items_center().rounded(7).text_size(12.5).font_medium()
    .when(off || busy, (el) => el.bg(t.raised).text_color(t.dim))
    .when(!off && !busy && primary, (el) => el.bg(color).text_color(t.accent_foreground ?? "#111418").cursor_pointer().hover((s) => s.opacity(0.88)).on_click(go))
    .when(!off && !busy && !primary, (el) => el.border_1().border_color(danger ? `${color}99` : t.border).text_color(danger ? color : t.foreground).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(go))
    .child(busy ? "…" : label);
}

// `view`: { checks, busy, notice, confirm, linkInput, back(cx), act(name, action, cx), check(name, cx) }
export function detail(t, item, view) {
  const check = view.checks[item.name];
  const busy = view.busy[item.name];
  const ask = (action) => view.confirm?.name === item.name && view.confirm?.action === action;
  const shipped = item.kind === "shipped";
  const self = item.name === "ray-mods";
  const notice = view.notice?.name === item.name ? view.notice : null;
  return v_flex().size_full().min_h(0)
    .child(h_flex().h(42).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().id("mods-back").size(26).flex_none().flex().items_center().justify_center().rounded(6).text_size(16).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => view.back(cx)).child("‹"))
      .child(div().flex_shrink(1).min_w(0).truncate().text_size(14.5).font_bold().text_color(t.foreground).child(item.name))
      .children(badges(t, item, check)))
    .child(v_flex().id("mod-detail").flex_1().min_h(0).p(12).gap(12).overflow_y_scrollbar()
      .child(v_flex()
        .child(field(t, tr("Title"), item.title || "–"))
        .child(field(t, tr("Kind"), tr(KIND[item.kind]) + (item.cloned ? ` · ${tr("from {name} {version}", { name: item.cloned.name, version: item.cloned.version ?? "" })}` : "")))
        .when(item.kind !== "missing", (el) => el
          .child(field(t, tr("Size"), tr("{kb} KB · {n} files", { kb: item.size, n: item.files })))
          .child(field(t, tr("Changed"), when(item.mtime))))
        .child(field(t, tr("In the layout"), item.nodes.length ? item.nodes.map((n) => `${n.id}${n.hidden ? ` (${tr("hidden")})` : ""}`).join(", ") : tr("Not used")))
        .child(field(t, tr("Keys"), item.keys.length ? item.keys.map((k) => `${k.key} → ${k.action}`).join(", ") : "–")))
      // Where it comes from
      .child(v_flex().gap(6).p(10).rounded(9).bg(t.raised)
        .child(div().text_size(12).font_semibold().text_color(t.muted).child(tr("Source")))
        .when(Boolean(item.source), (el) => el
          .child(field(t, tr("Repository"), `${item.source.repo} · ${item.source.path}`))
          .child(field(t, tr("Installed"), item.source.commit ? `${short(item.source.commit)} · ${when(item.source.at)}` : tr("Unknown (installed before it was linked)")))
          .child(field(t, tr("Latest"), check?.state === "checking" ? tr("Checking…") : check?.error ? check.error : check?.latest ? `${short(check.latest.sha)} · ${when(check.latest.date)} · ${check.latest.message}` : "–"))
          .when(Boolean(check?.changed), (x) => x.child(div().whitespace_normal().text_size(12).text_color(t.working).child(tr("Its files were changed here since it was installed: updating replaces them (the old ones are kept aside).")))))
        .when(!item.source && !shipped, (el) => el
          .child(div().whitespace_normal().text_size(12).text_color(t.dim).child(tr("Not linked. Link it to a GitHub repository that has it in mods/{name}/ to get updates.", { name: item.name })))
          .child(h_flex().gap(6).items_center()
            .child(div().flex_1().min_w(0).child(Input.new(view.linkInput).h(30).px(9).items_center().rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12.5)))
            .child(button(t, "mod-link", tr("Link"), (_e, cx) => view.act(item.name, "link", cx), { busy: busy === "link" })))))
      .when(Boolean(notice), (el) => el.child(div().whitespace_normal().text_size(12.5).text_color(notice.ok ? t.done : t.blocked).child(notice.text)))
      .when(shipped, (el) => el.child(div().whitespace_normal().text_size(12).text_color(t.dim).child(tr("Herdr installs and updates this one itself; it can't be changed here.")))))
    // Actions
    .when(!shipped, (el) => el.child(h_flex().flex_none().px(12).py(10).gap(6).flex_wrap().border_t(1).border_color(t.border)
      .when(Boolean(item.source), (x) => x
        .child(button(t, "mod-check", tr("Check"), (_e, cx) => view.check(item.name, cx), { busy: check?.state === "checking" }))
        .child(button(t, "mod-update", ask("update") ? tr("Replace it? Press again") : item.kind === "missing" ? tr("Install") : tr("Update"), (_e, cx) => view.act(item.name, "update", cx),
          { primary: true, busy: busy === "update" })))
      .when(item.kind !== "missing" && !self, (x) => x
        .child(item.disabled
          ? button(t, "mod-on", tr("Turn on"), (_e, cx) => view.act(item.name, "on", cx), { busy: busy === "on" })
          : button(t, "mod-off", ask("off") ? tr("Turn off? Press again") : tr("Turn off"), (_e, cx) => view.act(item.name, "off", cx), { busy: busy === "off", off: !item.nodes.length && !item.keys.length }))
        .child(button(t, "mod-remove", ask("remove") ? tr("Remove? Press again") : tr("Remove"), (_e, cx) => view.act(item.name, "remove", cx), { danger: true, busy: busy === "remove" })))
      .when(item.kind !== "missing", (x) => x.child(button(t, "mod-folder", tr("Folder"), (_e, cx) => view.act(item.name, "folder", cx))))
      .when(Boolean(item.source), (x) => x.child(button(t, "mod-unlink", tr("Unlink"), (_e, cx) => view.act(item.name, "unlink", cx))))));
}
