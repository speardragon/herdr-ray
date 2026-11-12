// A website's icon as a space's logo: reads the page at an address, picks the
// biggest icon it names (else /favicon.ico), downloads it with curl and hands
// it to importImage. The request goes straight to that site, nowhere else.

import { appHome, exec } from "herdr";
import { importImage } from "./logo.js";
import { tr } from "./i18n/i18n.js";

const AGENT = "Mozilla/5.0";
const CURL = ["-fsSL", "--max-time", "15", "--max-filesize", "5000000", "--proto", "=http,https", "--proto-redir", "=http,https", "-A", AGENT];
const TRIES = 4;
const EXT = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
  "image/vnd.microsoft.icon": ".ico", "image/x-icon": ".ico", "image/bmp": ".bmp", "image/tiff": ".tiff",
};

// What was typed as an http(s) address ("github.com" works), or null.
export function address(text) {
  const s = (text ?? "").trim();
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https?:\/\/[^\s"'<>/]+\.[^\s"'<>]+$|^https?:\/\/localhost(:\d+)?(\/[^\s"'<>]*)?$/i.test(url) ? url : null;
}

const originOf = (url) => url.match(/^https?:\/\/[^/?#]+/i)?.[0] ?? null;

// `href` as written in the page at `base`, made absolute; null when it can't be fetched.
export function resolve(href, base) {
  const h = (href ?? "").trim().replace(/&amp;/g, "&");
  const origin = originOf(base);
  if (!h || !origin || /^(data|javascript|about):/i.test(h)) return null;
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("//")) return `${origin.split("//")[0]}${h}`;
  if (h.startsWith("/")) return `${origin}${h}`;
  const path = base.slice(origin.length).replace(/[?#].*$/, "");
  return `${origin}${path.slice(0, path.lastIndexOf("/") + 1) || "/"}${h}`;
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find((v) => v !== undefined) ?? "";

// How good an icon a <link> names: its pixel size, so the biggest wins.
// A vector comes last (after /favicon.ico, 1): it may not draw.
function score(rel, tag, href) {
  if (/svg/i.test(attr(tag, "type")) || /\.svg([?#]|$)/i.test(href)) return 0;
  const size = Math.max(0, ...[...attr(tag, "sizes").matchAll(/(\d+)x\d+/gi)].map((m) => Number(m[1])));
  return size || (rel.some((r) => r.startsWith("apple-touch-icon")) ? 180 : 32);
}

// The icon addresses for the page `html` at `base`, best first.
export function candidates(html, base) {
  const origin = originOf(base);
  const named = [...(html ?? "").matchAll(/<link\b[^>]*>/gi)].flatMap(([tag]) => {
    const rel = attr(tag, "rel").toLowerCase().split(/\s+/);
    if (!rel.some((r) => r === "icon" || r.startsWith("apple-touch-icon"))) return [];
    const url = resolve(attr(tag, "href"), base);
    return url ? [{ url, score: score(rel, tag, url) }] : [];
  });
  const all = [...named, ...(origin ? [{ url: `${origin}/favicon.ico`, score: 1 }] : [])];
  const sorted = [...all].sort((a, b) => b.score - a.score).map((c) => c.url);
  return sorted.filter((url, i) => sorted.indexOf(url) === i);
}

// Downloads `url` to `file` and says what it is: an extension like ".png",
// or null when it isn't a picture. Without `file` (Windows) the address's
// own extension is trusted.
async function download(url, file) {
  const got = await exec("curl", [...CURL, "-o", file, url], { timeout: 25_000 }).catch(() => null);
  if (got?.code !== 0) return null;
  const kind = await exec("file", ["--mime-type", "-b", file], { timeout: 10_000 }).catch(() => null);
  if (kind?.code !== 0) return url.match(/\.(png|jpe?g|gif|webp|svg|ico)(?=[?#]|$)/i)?.[0].toLowerCase() ?? null;
  return EXT[kind.stdout.trim()] ?? null;
}

// Makes the icon of the site at `text` the space's logo. -> null, or what went wrong.
export async function importFavicon(id, text) {
  const url = address(text);
  if (!url) return tr("Enter a website address.");
  const dir = `${appHome()}/ray-sidebar/logos`;
  const temp = `${dir}/download-${Date.now()}`;
  try {
    await exec("mkdir", ["-p", dir], { timeout: 10_000 });
    const page = await exec("curl", [...CURL, "-w", "\n%{url_effective}", url], { timeout: 25_000 }).catch(() => null);
    const out = page?.code === 0 ? page.stdout : "";
    const cut = out.lastIndexOf("\n");
    const list = candidates(out.slice(0, Math.max(cut, 0)), (cut >= 0 && originOf(out.slice(cut + 1).trim())) ? out.slice(cut + 1).trim() : url);
    for (const icon of list.slice(0, TRIES)) {
      const ext = await download(icon, temp);
      if (!ext) continue;
      const file = `${temp}${ext}`;
      await exec("mv", [temp, file], { timeout: 10_000 });
      const error = await importImage(id, file);
      await exec("rm", ["-f", file]).catch(() => null);
      return error;
    }
    return tr("Couldn't find an icon at that address.");
  } catch (error) {
    return String(error?.message ?? error);
  } finally {
    exec("rm", ["-f", temp]).catch(() => null);
  }
}
