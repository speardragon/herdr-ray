#!/bin/sh
# Mods can't import across folders (Herdr refuses even a symlink), so the
# ray-theme mods carry copies of the shared code kept here:
#   i18n.js + locales/  ->  <mod>/i18n/   (every mod in I18N)
#   lib/github.js       ->  <mod>/lib/    (every mod in GITHUB)
# Run this after editing them here. A mod that was deleted is skipped.
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
MODS="$(dirname "$SRC")"
NOTE="// Copied from mods/ray-locale by its sync.sh: edit it there, then run sync.sh."

I18N="agents-big spaces-big tabs-big pane-big workspace-chrome-big workspace-status-big ray-usage ray-jenkins ray-prs ray-sessions ray-notes ray-sidebar ray-chat ray-mods"
GITHUB="pane-big ray-prs ray-mods"

copy() { # copy <source file> <destination file>
  { echo "$NOTE"; cat "$1"; } >"$2"
}

for mod in $I18N; do
  [ -d "$MODS/$mod" ] || { echo "skip $mod: not found" >&2; continue; }
  dest="$MODS/$mod/i18n"
  rm -rf "$dest"
  mkdir -p "$dest/locales"
  copy "$SRC/i18n.js" "$dest/i18n.js"
  for f in "$SRC"/locales/*.js; do
    copy "$f" "$dest/locales/$(basename "$f")"
  done
  echo "synced i18n -> $mod"
done

for mod in $GITHUB; do
  [ -d "$MODS/$mod" ] || { echo "skip $mod: not found" >&2; continue; }
  [ -f "$SRC/lib/github.js" ] || break
  mkdir -p "$MODS/$mod/lib"
  copy "$SRC/lib/github.js" "$MODS/$mod/lib/github.js"
  echo "synced github -> $mod"
done
