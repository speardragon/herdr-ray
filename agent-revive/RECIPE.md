# Agent Revive

When herdr-core loses your terminals (a core restart, a reboot), Herdr brings back every pane with a plain shell at the same address, but the coding agent that ran there is gone. Agent Revive puts it back: the same Claude Code session, resumed in the same terminal, in the folder it started in.

## What you see

- Nothing, most of the time. It is a 1px block in the status bar.
- After a lost terminal comes back: a toast "Revived 3 agents" listing each address and where it is ("t7b ray-brain / dl-e2e"), and each of those terminals running `cd '<folder>' && claude --resume <id>`.

## How it behaves

- Every 20 seconds it reads each local Claude Code terminal: `hc get <t>` gives the shell's pid and the foreground pid; Claude's own `~/.claude/sessions/<pid>.json` gives the session ID and the folder it started in (its `procStart` must match `ps -o lstart` for that pid, so a reused pid's stale record is ignored). These go in `~/.config/herdr-app/agent-revive/snapshot.json`.
- A remembered terminal whose shell pid changed, and whose new shell waits at its prompt, gets the resume command (`hc send`). A session with no transcript yet (`~/.claude/projects/*/<id>.jsonl` missing) gets a new `claude` instead.
- Left alone: a terminal whose shell is the same one but Claude is gone (you quit it; it is forgotten), a closed terminal, a session already running in another terminal, a new shell still busy with something else (looked at again next scan).
- The snapshot is saved before anything is sent, so a reload mid-send never sends twice.
- Closing and opening only the app window changes nothing: herdr-core keeps the terminals running, so there is nothing to revive.

## Add it

1. Copy `mods/agent-revive` into `~/.config/herdr-app/mods/`.
2. Add a block to your layout's status bar (a `row`), next to the others: `{ "id": "agent-revive", "type": "block", "content": { "mod": "agent-revive" }, "size": { "px": 1 } }`. It runs only while a layout holds it.
3. `herdr-app check ~/.config/herdr-app/mods/agent-revive`.

## Built from

- `mods/agent-revive/`: `main.js` (the scan: `hc ls`/`hc get`, Claude's session records, `hc send`, the toast), `plan.js` (the decisions, with no Herdr import: node can test it).

## Watch out

- Claude Code only. Codex, Grok and the rest are not remembered.
- Local terminals only (an address with `machine/` is skipped).
- A session changed within the last 20 seconds (a new one, `/clear`) may be remembered as the one before.
- What gets typed into a resumed agent's input box before the loss is not brought back.

## Done when

- `snapshot.json` lists every Claude Code terminal within 20 seconds.
- After `hc server restart` (or a reboot), each of those terminals is running its old session again, and a toast says so.
- Quitting Claude with `/exit` and waiting a scan removes that terminal from `snapshot.json`.
