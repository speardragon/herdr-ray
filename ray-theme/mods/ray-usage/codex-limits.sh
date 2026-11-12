#!/bin/sh
# Prints the newest Codex session log line that carries "rate_limits" (Codex
# writes them with every token count), or nothing. The newest sessions come
# from Codex's state database when sqlite3 is there, else from file times.
set -u
codex="${CODEX_HOME:-$HOME/.codex}"

recent() {
  db=$(ls -t "$codex"/state_*.sqlite 2>/dev/null | head -1)
  if [ -n "$db" ] && command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 -readonly "$db" "select rollout_path from threads order by updated_at desc limit 5" 2>/dev/null && return
  fi
  ls -t "$codex"/sessions/*/*/*/*.jsonl 2>/dev/null | head -5
}

recent | while IFS= read -r f; do
  [ -f "$f" ] || continue
  line=$(tail -c 4000000 "$f" | grep '"rate_limits":{' | tail -1)
  if [ -n "$line" ]; then
    printf '%s\n' "$line"
    break
  fi
done
