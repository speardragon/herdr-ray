// Updates the snapshot and finds what can be revived. It imports nothing from Herdr, so node can test it.
//
// The signal is the shell's pid. When herdr-core loses a terminal (core restart, reboot) it gives the
// same address a new shell, so the pid changes. Same pid but no agent means the person quit it: it is
// forgotten.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "tcsh", "csh", "nu"]);

export function isShell(path) {
  const base = String(path ?? "").split("/").pop().replace(/^-/, "");
  return SHELLS.has(base);
}

export function isSessionId(value) {
  return typeof value === "string" && UUID.test(value);
}

// The shell waits at its prompt: nothing runs in front of it.
export function atPrompt(term) {
  return term?.state === "live" && isShell(term.argv?.[0]) && term.foreground?.pid === term.pid;
}

// Single quotes keep a folder with spaces or symbols intact on the command line.
export function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

export function resumeCommand(entry, hasLog) {
  const run = hasLog ? `claude --resume ${entry.sessionId}` : "claude";
  return `cd ${shellQuote(entry.cwd)} && ${run}`;
}

// snapshot: { [address]: { sessionId, cwd, shellPid, where, seenAt } }
// live: terminals running Claude now { address, sessionId, cwd, shellPid, where }
// terms: `hc get` of each address in the snapshot { [address]: term | null }
// returns: { snapshot, candidates }. Candidates stay as they are in the snapshot until chosen (applyChoice).
export function plan(snapshot, live, terms, now) {
  const next = {};
  const running = new Set(live.map((a) => a.sessionId));
  for (const a of live) next[a.address] = { sessionId: a.sessionId, cwd: a.cwd, shellPid: a.shellPid, where: a.where, seenAt: now };

  const candidates = [];
  for (const [address, entry] of Object.entries(snapshot ?? {})) {
    if (next[address]) continue;
    const term = terms[address];
    if (!term || term.state !== "live") continue; // the terminal was closed: forget it
    if (term.pid === entry.shellPid) continue; // same shell, agent gone: the person quit it
    if (!isSessionId(entry.sessionId) || running.has(entry.sessionId)) continue;
    next[address] = entry;
    // A new shell busy with something else is no candidate yet: look again next scan
    if (!atPrompt(term)) continue;
    candidates.push({ address, ...entry, newShellPid: term.pid });
    running.add(entry.sessionId);
  }
  return { snapshot: next, candidates };
}

// What the popup chose: chosen ones take the new shell as theirs (so they are no candidate again), the rest are forgotten.
export function applyChoice(snapshot, candidates, chosen, now) {
  const next = { ...snapshot };
  for (const c of candidates) {
    if (!chosen.has(c.address)) {
      delete next[c.address];
      continue;
    }
    const { newShellPid, address, ...entry } = c;
    next[address] = { ...entry, shellPid: newShellPid, revivedAt: now };
  }
  return next;
}
