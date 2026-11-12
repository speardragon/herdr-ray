#!/bin/sh
# list-sessions.sh <folder> [limit]
# Recent Claude Code and Codex sessions started in <folder>, one per line:
#   agent <TAB> id <TAB> updated (epoch seconds) <TAB> title <TAB> branch
# title and branch are JSON string literals (so tabs, quotes and newlines in
# them can't break the line). Unsorted: the caller sorts.
set -u
dir="${1:?folder}"
limit="${2:-20}"
tab="$(printf '\t')"

# Claude Code keeps a folder's sessions in projects/<folder with every
# non-alphanumeric character turned into "-">/<session id>.jsonl.
claude() {
  base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$(printf '%s' "$dir" | sed 's/[^A-Za-z0-9]/-/g')"
  [ -d "$base" ] || return 0
  ls -t "$base"/*.jsonl 2>/dev/null | head -n "$limit" | while IFS= read -r f; do
    id=$(basename "$f" .jsonl)
    updated=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
    # Its name: /rename's title, else the generated one, else the last prompt.
    title=""
    for key in customTitle aiTitle lastPrompt; do
      title=$(grep -o "\"$key\":\"\\([^\"\\\\]\\|\\\\.\\)*\"" "$f" | tail -1 | sed "s/^\"$key\"://")
      [ -n "$title" ] && break
    done
    branch=$(tail -c 300000 "$f" | grep -o '"gitBranch":"[^"]*"' | tail -1 | sed 's/^"gitBranch"://')
    printf 'claude\t%s\t%s\t%s\t%s\n' "$id" "$updated" "${title:-\"\"}" "${branch:-\"\"}"
  done
}

# Codex lists its threads in state_<n>.sqlite; sub-agents and reviewers are
# threads too, so only the ones a person started are kept.
codex() {
  db=$(ls -t "${CODEX_HOME:-$HOME/.codex}"/state_*.sqlite 2>/dev/null | head -1)
  [ -n "$db" ] || return 0
  command -v sqlite3 >/dev/null 2>&1 || return 0
  folder=$(printf '%s' "$dir" | sed "s/'/''/g")
  sqlite3 -readonly -separator "$tab" "$db" "
    select 'codex', id, updated_at,
      json_quote(coalesce(nullif(name, ''), nullif(title, ''), first_user_message, '')),
      json_quote(coalesce(git_branch, ''))
    from threads
    where cwd = '$folder' and archived = 0
      and source not like '{%' and coalesce(thread_source, 'user') = 'user'
    order by updated_at desc limit $limit" 2>/dev/null
}

claude
codex
