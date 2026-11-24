// Updates the snapshot and picks what to revive. It imports nothing from Herdr, so node can test it.
//
// The signal is the shell's pid. When herdr-core loses a terminal (core restart, reboot) it gives the
// same address a new shell, so the pid changes. Same pid but no agent means the person quit it:
// it is forgotten, never revived.

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
// returns: { snapshot: the new snapshot, revive: the entries to revive }
export function plan(snapshot, live, terms, now) {
  const next = {};
  const running = new Set(live.map((a) => a.sessionId));
  for (const a of live) next[a.address] = { sessionId: a.sessionId, cwd: a.cwd, shellPid: a.shellPid, where: a.where, seenAt: now };

  const revive = [];
  for (const [address, entry] of Object.entries(snapshot ?? {})) {
    if (next[address]) continue;
    const term = terms[address];
    if (!term || term.state !== "live") continue; // the terminal was closed: forget it
    if (term.pid === entry.shellPid) continue; // same shell, agent gone: the person quit it
    if (!isSessionId(entry.sessionId) || running.has(entry.sessionId)) continue;
    if (!atPrompt(term)) {
      next[address] = entry; // the new shell is busy: look again next scan
      continue;
    }
    revive.push({ address, ...entry });
    running.add(entry.sessionId);
    // From now on the new shell is the reference: if Claude doesn't start, the next scan forgets it.
    next[address] = { ...entry, shellPid: term.pid, revivedAt: now };
  }
  return { snapshot: next, revive };
}
