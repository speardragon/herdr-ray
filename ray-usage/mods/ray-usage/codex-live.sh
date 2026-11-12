#!/bin/sh
# Prints Codex's limits as they are now: asks `codex app-server` (JSON-RPC on
# stdin/stdout) for account/rateLimits/read and prints its answer line, or
# nothing. Codex signs in by itself; no token is read here. The session log
# (codex-limits.sh) only has the limits as of Codex's last turn on this computer.
set -u
command -v codex >/dev/null 2>&1 || exit 0
out=$(mktemp "${TMPDIR:-/tmp}/codex-limits.XXXXXX") || exit 0
trap 'rm -f "$out"' EXIT
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"usage-reader","version":"1.0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"account/rateLimits/read"}'
  # The server ends when its input does: hold it open until the answer is in
  # (or 10 seconds have passed).
  i=0
  while [ ! -s "$out" ] && [ "$i" -lt 40 ]; do
    sleep 0.25
    i=$((i + 1))
  done
} | codex app-server 2>/dev/null | grep -m1 '^{"id":2,' >"$out"
cat "$out"
