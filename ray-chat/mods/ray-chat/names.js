// The name an agent has in the sidebar, so a list here says the same thing: a
// tab someone named, or the agent's own title when nobody named the tab; for
// an automatic tab number, the program. (Copied from ray-sidebar/agents.js: a
// mod can't import from another folder.)

import { panes } from "herdr";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

// address -> the sidebar's name for each agent of `list`; `tabs`: every tab of every space.
export function agentNames(list, tabs) {
  const all = panes();
  const label = (a) => {
    const tab = tabs.find((x) => x.id === a.tab);
    return tab ? title(tab, lead(tab, all)) : a.title || a.program?.name || "";
  };
  return new Map(list.map((a) => {
    const l = label(a);
    return [a.address, /^\d+$/.test(l) ? a.program?.name || l : l];
  }));
}
