# herdr-ray

Layouts and mods for the [Herdr](https://herdr.dev) app. Each folder is one entry in the [Herdr gallery](https://herdr.dev/gallery/): add one by telling your agent its address.

| Folder | What it is | Add it |
|---|---|---|
| [`ray-theme`](ray-theme) | Layout: spaces with nested agents, side panels, PR and Jira in pane headers, usage in the status bar | `herdr.dev/layouts/speardragon/ray-theme` |
| [`ray-chat`](ray-chat) | Mod: your agents' `hc` messages as a chat, and a builder to have one agent ask another | `herdr.dev/mods/speardragon/ray-chat` |
| [`ray-usage`](ray-usage) | Mod: Claude (with Fable), Codex, Antigravity and Grok usage limits | `herdr.dev/mods/speardragon/ray-usage` |
| [`ray-mods`](ray-mods) | Mod: see, update, turn off and remove your installed mods | `herdr.dev/mods/speardragon/ray-mods` |
| [`ray-sidebar`](ray-sidebar) | Mod (sidebar block): spaces with their agents nested under them, logos, drag to reorder | `herdr.dev/mods/speardragon/ray-sidebar` |
| [`ray-picker`](ray-picker) | Mod: Herdr's picker (`cmd-p`) with space logos and agent icons | `herdr.dev/mods/speardragon/ray-picker` |
| [`ray-prs`](ray-prs) | Mod: pull requests for this repo, yours and the ones waiting on your review | `herdr.dev/mods/speardragon/ray-prs` |
| [`ray-notes`](ray-notes) | Mod: a Markdown note for each space | `herdr.dev/mods/speardragon/ray-notes` |
| [`ray-files`](ray-files) | Mod: the file panel in VS Code's look, with Material Icon Theme icons, Dark Modern colors and picture previews | `herdr.dev/mods/speardragon/ray-files` |
| [`ray-changes`](ray-changes) | Mod: the Changes panel in VS Code's Source Control look, with a commit graph, each commit's files and diffs in a dialog (uses `ray-files`' icons) | `herdr.dev/mods/speardragon/ray-changes` |
| [`ray-sessions`](ray-sessions) | Mod: past Claude Code and Codex sessions in this folder, resumed in a new tab | `herdr.dev/mods/speardragon/ray-sessions` |
| [`agent-revive`](agent-revive) | Mod (status-bar block): when herdr-core loses your terminals, a button to resume each Claude Code session in the same terminal | `herdr.dev/mods/speardragon/agent-revive` |

Each folder has a `RECIPE.md`: the brief an agent can build the entry from with an empty folder. Your agent reads every file before it adds one; these mods run programs (`gh`, `git`, `hc`, `curl`) and read your agents' own session files, as each recipe says.

The pictures (`preview.png`) are drawn with made-up data. The people in them are [DiceBear Notionists](https://www.dicebear.com/styles/notionists/) avatars (CC0 1.0). The file icons in `ray-files` (also used by `ray-changes`) are from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT; its license is in `mods/ray-files/icons/LICENSE`).
