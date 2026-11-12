// The language picker, a popup from the ray-theme status bar. Picking one
// switches every ray-theme mod at once (see i18n.js).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { LOCALES, locale, setLocale, tr } from "./i18n.js";

export default class LocalePicker extends View {
  render() {
    const t = theme();
    const on = locale().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(14.5)
      .child(div().px(8).pt(4).pb(6).text_size(12.5).text_color(t.dim).child(tr("Language")))
      .children(LOCALES.map((l) => h_flex()
        .id(`locale-${l.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setLocale(l.id);
          const overlay = props()?.overlay;
          if (overlay) closeOverlay(overlay);
        })
        .child(div().flex_1().child(l.name))
        .when(l.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }
}
