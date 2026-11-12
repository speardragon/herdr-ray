#!/bin/sh
# File work for the Mods panel (ray-mods), one subcommand a job. Nothing is
# deleted for good: what is replaced or removed is moved under
# <home>/.install-spare/ first. Mods appear whole: a mod folder is moved in
# from the same disk, never copied in place (the app reads a new folder's
# mod.json the moment it shows up).
set -u
cmd="$1"; shift
stamp=$(date +%Y%m%d%H%M%S)

skip() { # the files the app writes, and local state, left out of a fingerprint
  find . -type f ! -name gpui-kit.d.ts ! -name jsconfig.json ! -path './.*' ! -path '*/.*/*' ! -path '*/__pycache__/*' ! -name config.js
}

case "$cmd" in
  # inventory <home>: a line a mod folder: name, KB (without the app's type file), files, newest file (s)
  inventory)
    home="$1"
    for d in "$home"/mods/*/; do
      [ -d "$d" ] || continue
      n=$(basename "$d")
      kb=$( (cd "$d" && skip | tr '\n' '\0' | xargs -0 du -ck 2>/dev/null | tail -1 | cut -f1) )
      files=$( (cd "$d" && skip | wc -l | tr -d ' ') )
      newest=$( (cd "$d" && skip | tr '\n' '\0' | xargs -0 stat -f %m 2>/dev/null || skip | tr '\n' '\0' | xargs -0 stat -c %Y 2>/dev/null) | sort -n | tail -1)
      printf '%s\t%s\t%s\t%s\n' "$n" "${kb:-0}" "${files:-0}" "${newest:-0}"
    done ;;
  # fingerprint <dir>: what its files hold, in 12 characters (to tell a mod changed since it was installed)
  fingerprint)
    cd "$1" 2>/dev/null || exit 1
    skip | LC_ALL=C sort | while IFS= read -r f; do shasum "$f"; done | shasum | cut -c1-12 ;;
  # download <out file> <owner/repo> <sha> [account...]: the repo at that commit, as a tarball (tries each account)
  download)
    out="$1"; repo="$2"; sha="$3"; shift 3
    for a in "$@" ""; do
      if [ -n "$a" ]; then
        tok=$(gh auth token --hostname github.com --user "$a" 2>/dev/null) || continue
        GH_TOKEN="$tok" gh api "repos/$repo/tarball/$sha" >"$out" 2>/dev/null && { echo "$a"; exit 0; }
      else
        gh api "repos/$repo/tarball/$sha" >"$out" 2>/dev/null && { echo "default"; exit 0; }
      fi
    done
    exit 1 ;;
  # install <home> <name> <tarball> <path in repo>: replace (or add) mods/<name> with that folder of the tarball
  install)
    home="$1"; name="$2"; tar="$3"; sub="$4"
    tmp="$home/.install-spare/tmp/$name-$stamp"
    rm -rf "$tmp"; mkdir -p "$tmp/x"
    tar -xzf "$tar" -C "$tmp/x" || { rm -rf "$tmp"; echo "can't unpack" >&2; exit 2; }
    src=$(ls -d "$tmp"/x/*/"$sub" 2>/dev/null | head -1)
    [ -n "$src" ] && [ -f "$src/mod.json" ] || { rm -rf "$tmp"; echo "no $sub/mod.json in the repo" >&2; exit 3; }
    cp -R "$src" "$tmp/new"
    cur="$home/mods/$name"
    if [ -d "$cur" ]; then
      # local-only files the repo doesn't carry are kept (a config with a secret, a local cache)
      for keep in config.js .web; do
        [ -e "$cur/$keep" ] && [ ! -e "$tmp/new/$keep" ] && cp -R "$cur/$keep" "$tmp/new/$keep"
      done
      old="$home/.install-spare/old-$stamp/mods"
      mkdir -p "$old"
      mv "$cur" "$old/$name"
      echo "$old/$name"
    fi
    mv "$tmp/new" "$cur"
    rm -rf "$tmp" ;;
  # restore <home> <name> <backup dir>: put a backup back (after an update that didn't load)
  restore)
    home="$1"; name="$2"; back="$3"
    [ -d "$back" ] || exit 1
    bad="$home/.install-spare/failed-$stamp"
    mkdir -p "$bad"
    [ -d "$home/mods/$name" ] && mv "$home/mods/$name" "$bad/$name"
    mv "$back" "$home/mods/$name" ;;
  # trash <home> <name>: move mods/<name> out of the app's sight (kept under .install-spare)
  trash)
    home="$1"; name="$2"
    [ -d "$home/mods/$name" ] || exit 1
    dest="$home/.install-spare/trash-$stamp"
    mkdir -p "$dest"
    mv "$home/mods/$name" "$dest/$name" && echo "$dest/$name" ;;
  *) echo "unknown: $cmd" >&2; exit 64 ;;
esac
