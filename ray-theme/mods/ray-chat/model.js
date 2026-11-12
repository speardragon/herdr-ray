// The log as conversations: one for each top agent and the agents under it
// (those it started with `hc run`, and theirs), newest first. Pure.

// -> [{ key, root, members, items, last, unread }]
//   `read`: { [key]: ms } when each was last looked at; `outbox`: messages a
//   panel sent that the watcher hasn't written yet.
export function conversations(log, read = {}, outbox = []) {
  const have = new Set(log.items.map((i) => i.id));
  const all = [...log.items, ...outbox.filter((o) => !have.has(o.id))];
  const roots = [...new Set(Object.values(log.agents).map((a) => a.root))];
  return roots.map((key) => {
    const members = Object.values(log.agents).filter((a) => a.root === key).sort((a, b) => (a.key === key ? -1 : b.key === key ? 1 : (a.created ?? 0) - (b.created ?? 0)));
    const keys = new Set(members.map((a) => a.key));
    const items = all.filter((i) => keys.has(i.to) || keys.has(i.agent) || keys.has(i.from)).sort((a, b) => a.ts - b.ts);
    const seen = read[key] ?? 0;
    return {
      key, members, items,
      root: log.agents[key] ?? members[0] ?? null,
      last: items.at(-1) ?? null,
      unread: items.filter((i) => i.kind === "message" && i.from !== "you" && i.ts > seen).length,
    };
  }).filter((c) => c.root && c.items.length).sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
}

// Who an item is from, for showing: an agent of the log, the person, or just a name.
export function senderOf(item, log) {
  if (item.from === "you") return { you: true };
  const agent = item.from ? log.agents[item.from] : null;
  return agent ?? { label: item.fromLabel ?? "hc" };
}

// A message follows the one before closely enough to share its name line.
export const continues = (item, before) => Boolean(before) && before.kind === "message" && item.kind === "message"
  && before.from === item.from && before.fromLabel === item.fromLabel && before.to === item.to && !item.task
  && item.ts - before.ts < 5 * 60_000 && new Date(item.ts).toDateString() === new Date(before.ts).toDateString();

// The avatar background colors, and the one for a new agent: random among
// those no agent of its conversation has yet, else among the least used.
export const TINTS = ["#3B82F6", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#06B6D4", "#EF4444", "#84CC16", "#6366F1", "#14B8A6", "#F97316", "#A855F7"];
export function freshTint(agents, root) {
  const used = Object.values(agents).filter((a) => a.root === root && a.tint).map((a) => a.tint);
  const count = (c) => used.filter((u) => u === c).length;
  const least = Math.min(...TINTS.map(count));
  const free = TINTS.filter((c) => count(c) === least);
  return free[Math.floor(Math.random() * free.length)];
}
