#!/bin/sh
# Prints Claude's usage limits as Anthropic reports them (the numbers behind
# Claude Code's /usage, with the per-model weekly limits the status line
# doesn't get), or nothing. Asks api.anthropic.com with Claude Code's own
# sign-in: from the macOS keychain, else its .credentials.json. The token goes
# to curl on stdin (not on the command line, where `ps` would show it) and
# nowhere else; it is never printed or stored.
set -u
creds=""
if command -v security >/dev/null 2>&1; then
  creds=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
fi
[ -n "$creds" ] || creds=$(cat "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" 2>/dev/null)
# Only the token inside "claudeAiOauth": the file holds other services' too.
token=$(printf '%s' "$creds" | tr -d '\n' | sed -n 's/.*"claudeAiOauth"[^{]*{[^}]*"accessToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$token" ] || exit 0
printf 'header = "Authorization: Bearer %s"\n' "$token" |
  curl -sS --fail --max-time 15 -K - \
    -H "anthropic-beta: oauth-2025-04-20" -H "User-Agent: claude-code" \
    https://api.anthropic.com/api/oauth/usage
