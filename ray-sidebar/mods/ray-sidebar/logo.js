// A space's logo: by default its first letter on its color; one character of
// your own (an emoji shows as it is, anything else like the letter) or an
// image when one was picked (right-click a space, "Edit logo").
// Kept in shared "space.logos": { [space id]: { text } | { image } }
// ({ emoji } is the older spelling of { text }), where
// `image` is a path under the app's home (~/.config/herdr-app); picked images
// are copied to ray-sidebar/logos there, so the original may move or go.

import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { appHome, exec, shared, setShared, window } from "herdr";
import { tr } from "./i18n/i18n.js";

const KEY = "space.logos";
const FOLDER = "ray-sidebar/logos";
const IMAGES = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|heic|icns|ico)$/i;
const AS_IS = /\.(svg|gif)$/i; // not resized: a vector, or maybe animated
const SIDE = 128; // px, the longer side of a stored logo
const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) + 0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16));
const DARK_INK = "#111418";

// The text color on a colored square: white or near-black, whichever reads better
// (white on a light color such as yellow or cyan is hard to read).
function inkOn(fill) {
  if (!/^#[0-9a-f]{6}/i.test(fill ?? "")) return "#ffffff";
  const l = luminance(fill);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0566 ? "#ffffff" : DARK_INK;
}


export const logoOf = (id) => (shared(KEY) ?? {})[id] ?? null;

// Sets (or with null clears) a space's logo; the image it replaces is deleted.
export function setLogo(id, logo) {
  const { [id]: old, ...others } = shared(KEY) ?? {};
  setShared(KEY, logo ? { ...others, [id]: logo } : others);
  if (old?.image && old.image !== logo?.image) exec("rm", ["-f", `${appHome()}/${old.image}`]).catch(() => null);
}

// The characters as people see them ("👨‍💻" is one, of several code points).
function glyphs(text) {
  const s = (text ?? "").trim();
  try {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
  } catch {
    return [...s];
  }
}

// The last character typed: typing another one replaces the logo.
export const lastGlyph = (text) => glyphs(text).at(-1) ?? "";

const EMOJI = (() => {
  try {
    return new RegExp("\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\u20E3", "u");
  } catch {
    return /[\u2190-\u2BFF\u{1F000}-\u{1FAFF}]/u;
  }
})();
export const isEmoji = (glyph) => EMOJI.test(glyph ?? "");

// The character picked for a space, or "".
export const glyphOf = (id) => { const l = logoOf(id); return l?.text ?? l?.emoji ?? ""; };

// Copies an image file in as the space's logo (on macOS scaled down to 128px).
// -> null, or what went wrong.
export async function importImage(id, path) {
  if (!IMAGES.test(path)) return tr("That isn't an image file.");
  const dir = `${appHome()}/${FOLDER}`;
  const name = `${id}-${Date.now()}`; // a new name each time: a picture is cached by its path
  try {
    await exec("mkdir", ["-p", dir], { timeout: 10_000 });
    const scaled = window()?.platform === "macos" && !AS_IS.test(path)
      && (await exec("sips", ["-s", "format", "png", "-Z", String(SIDE), path, "--out", `${dir}/${name}.png`], { timeout: 30_000 })).code === 0;
    const file = scaled ? `${name}.png` : `${name}${path.match(/\.[^./\\]+$/)[0].toLowerCase()}`;
    if (!scaled) {
      const r = await exec("cp", [path, `${dir}/${file}`], { timeout: 30_000 });
      if (r.code !== 0) return (r.stderr || r.stdout).trim().split("\n")[0] || tr("Couldn't copy the image.");
    }
    setLogo(id, { image: `${FOLDER}/${file}` });
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

// macOS's file dialog, for an image. -> its path, or null when cancelled or
// when this isn't macOS (drop a file on the editor instead).
export async function chooseImage() {
  if (window()?.platform !== "macos") return null;
  const script = `POSIX path of (choose file with prompt "${tr("Choose a logo image")}" of type {"public.image"})`;
  const r = await exec("osascript", ["-e", "activate", "-e", script], { timeout: 300_000 }).catch(() => null);
  return r?.code === 0 ? r.stdout.trim() || null : null;
}

// The logo of space `w`, `size` px square; `fill` is its color for the letter.
export function avatar(w, size, fill) {
  const logo = logoOf(w.id);
  const radius = Math.round(size * 0.28);
  if (logo?.image) return image(logo.image).size(size).flex_none().rounded(radius);
  const box = h_flex().size(size).flex_none().rounded(radius).items_center().justify_center();
  const glyph = logo?.text ?? logo?.emoji;
  if (glyph && isEmoji(glyph)) return box.text_size(Math.round(size * 0.83)).child(div().child(glyph));
  return box.bg(fill).text_size(Math.round(size * 0.67)).font_bold().text_color(inkOn(fill)).child(glyph ? glyph.toUpperCase() : [...w.name][0]?.toUpperCase() ?? "?");
}
