// The ray-theme layout's words in the language picked in its status bar.
// Mods can't import across folders, so sync.sh copies this file and locales/
// into each ray-theme mod (as i18n/): edit them here, then run sync.sh.
// Another language: a file in locales/, a line in LOCALES, then sync.sh.

import { shared, setShared } from "herdr";
import ko from "./locales/ko.js";

export const LOCALES = [
  { id: "en", name: "English", words: {} },
  { id: "ko", name: "한국어", words: ko },
];

const KEY = "ray.locale";

// Unset or unknown: English, the words the mods are written in.
export const locale = () => LOCALES.find((l) => l.id === shared(KEY)) ?? LOCALES[0];

// Every mod re-renders when shared state changes, so this switches the whole layout.
export const setLocale = (id) => setShared(KEY, id);

// The English text is the key; {name} takes a value: tr("{n} agents", { n: 3 }).
export function tr(text, vars) {
  const s = locale().words[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : s;
}
