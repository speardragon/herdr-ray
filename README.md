# herdr-ray

Layouts and mods for the [Herdr](https://herdr.dev) app. Each folder is one entry in the [Herdr gallery](https://herdr.dev/gallery/): add one by telling your agent its address.

| Folder | What it is | Add it |
|---|---|---|
| [`ray-theme`](ray-theme) | Layout: spaces with nested agents, side panels, PR and Jira in pane headers, usage in the status bar | `herdr.dev/layouts/speardragon/ray-theme` |
| [`ray-chat`](ray-chat) | Mod: your agents' `hc` messages as a chat, and a builder to have one agent ask another | `herdr.dev/mods/speardragon/ray-chat` |
| [`ray-usage`](ray-usage) | Mod: Claude (with Fable), Codex, Antigravity and Grok usage limits | `herdr.dev/mods/speardragon/ray-usage` |
| [`ray-mods`](ray-mods) | Mod: see, update, turn off and remove your installed mods | `herdr.dev/mods/speardragon/ray-mods` |

Each folder has a `RECIPE.md`: the brief an agent can build the entry from with an empty folder. Your agent reads every file before it adds one; these mods run programs (`gh`, `git`, `hc`, `curl`) and read your agents' own session files, as each recipe says.

The pictures (`preview.png`) are drawn with made-up data. The people in them are [DiceBear Notionists](https://www.dicebear.com/styles/notionists/) avatars (CC0 1.0).
