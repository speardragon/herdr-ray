// The VS Code look: Dark Modern's colors (fixed, whatever the app's theme) and
// Material Icon Theme's icon for a name. Colors are from VS Code's
// dark_modern.json / dark_plus.json / dark_vs.json and its default list and
// git decoration colors.

import { EXT, NAME, FOLDER } from "./icon-map.js";

export const C = {
  side: "#181818", editor: "#1F1F1F", border: "#2B2B2B",
  text: "#CCCCCC", dim: "#9D9D9D", bright: "#FFFFFF",
  hover: "#2A2D2E", selected: "#37373D", accent: "#0078D4",
};

// Git marks as VS Code's explorer shows them: letter and color.
export const GIT = {
  M: "#E2C08D", // modified
  U: "#73C991", // untracked
  A: "#81B88B", // added
  D: "#C74E39", // deleted
  "!": "#E4676B", // conflict
};

// Dark+ token colors on the editor's syntax keys. The editor has one keyword
// color; VS Code has two (blue for const/function/class, purple for
// if/return/import). Blue is used for both.
export const SYNTAX = {
  keyword: "#569CD6", string: "#CE9178", "string.escape": "#D7BA7D", comment: "#6A9955",
  function: "#DCDCAA", type: "#4EC9B0", number: "#B5CEA8", constant: "#4FC1FF", boolean: "#569CD6",
  variable: "#9CDCFE", operator: "#D4D4D4", punctuation: "#D4D4D4",
};

const icon = (name) => `mods/ray-files/icons/${name}.svg`;

export function folderIcon(name, open) {
  const known = FOLDER[name.toLowerCase()] ?? "folder";
  return icon(open ? `${known}-open` : known);
}

// A file's icon: its whole name, else its longest known ending (d.ts before ts).
export function fileIcon(name) {
  const lower = name.toLowerCase();
  if (NAME[lower]) return icon(NAME[lower]);
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const known = EXT[lower.slice(dot + 1)];
    if (known) return icon(known);
  }
  return icon("file");
}
