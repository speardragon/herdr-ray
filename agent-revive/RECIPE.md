# Agent Revive

When herdr-core loses your terminals (a core restart, a reboot), Herdr brings back every pane with a plain shell at the same address, but the coding agent that ran there is gone. Agent Revive offers to put it back: one button, then the same Claude Code session resumes in the same terminal, in the folder it started in. Nothing is sent until you press it.

## What you see

- Nothing, most of the time: a 1px block in the status bar.
- After a lost terminal comes back: the block widens to 180px and shows "↻ Revive 3 agents" in the theme's working color.
- Pressing it opens a popup above it (420px wide): "Revive agents", a line "Terminals herdr-core lost. Unchecked ones are forgotten.", then a row per terminal (44px): a checkbox, the address in bold, where it is ("ray-brain / dl-e2e"), and below it, dim, the folder and the session ID's first 8 characters. All are checked. Buttons: "Close (Esc)" and "Revive 3 (Enter)" (or "Forget all" with none checked). More than 7 rows scroll.
- After Enter: each chosen terminal runs `cd '<folder>' && claude --resume <id>`, a toast "Revived 3 agents" lists them, and the button goes away.

## How it behaves

- Every 20 seconds the status-bar copy reads each local Claude Code terminal: `hc get <t>` gives the shell's pid and the foreground pid; Claude's own `~/.claude/sessions/<pid>.json` gives the session ID and the folder it started in (its `procStart` must match `ps -o lstart` for that pid, so a reused pid's stale record is ignored). These go in `~/.config/herdr-app/agent-revive/snapshot.json`.
- A remembered terminal whose shell pid changed, and whose new shell waits at its prompt, is a candidate. Candidates go to the popup through shared state (`agent-revive.candidates`); the block's width follows them with `layout.resize` (so the block's id must be `agent-revive`).
- Left alone: a terminal whose shell is the same one but Claude is gone (you quit it; it is forgotten), a closed terminal, a session already running in another terminal, a new shell busy with something else (looked at again next scan).
- On Enter the popup saves the snapshot first (chosen ones take the new shell as theirs, unchecked ones are forgotten), then checks each terminal again: if something started in that shell meanwhile, it is skipped. A session with no transcript yet (`~/.claude/projects/*/<id>.jsonl` missing) gets a new `claude`.
- Both copies write the snapshot with `writeTextFile`'s expected text, so neither overwrites the other; a stale write is dropped and read again.
- Closing and opening only the app window changes nothing: herdr-core keeps the terminals running, so no button shows.

## Add it

1. Copy `mods/agent-revive` into `~/.config/herdr-app/mods/`.
2. Add a block to your layout's status bar (a `row`): `{ "id": "agent-revive", "type": "block", "content": { "mod": "agent-revive" }, "size": { "px": 1 } }`. It scans only while a layout holds it.
3. `herdr-app check ~/.config/herdr-app/mods/agent-revive`.

## Built from

- `mods/agent-revive/`: `main.js` (the status-bar scan and button, the popup, `hc send`, the toast), `plan.js` (the decisions, with no Herdr import: node can test it).

## Watch out

- Claude Code only. Codex, Grok and the rest are not remembered.
- Local terminals only (an address with `machine/` is skipped).
- A session changed within the last 20 seconds (a new one, `/clear`) may be remembered as the one before.
- What was typed into an agent's input box before the loss is not brought back.

## Done when

- `snapshot.json` lists every Claude Code terminal within 20 seconds.
- After `hc server restart` (or a reboot), the button shows the lost terminals; Enter resumes each old session and a toast says so; the button goes away.
- Quitting Claude with `/exit` and waiting a scan removes that terminal from `snapshot.json`, and no button shows.
