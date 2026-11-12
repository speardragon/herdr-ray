// Reads what agents said to each other through hc. hc keeps no record: a
// message is typed into the receiver's terminal as
//   <hc from="t7 review">text</hc>            a report, or a message
//   <hc from="t3 lead" reach="...">task</hc>  the task a parent gave
//   <hc>text</hc>                              hc's own note (a child exited...)
// (a task given on the command line, `hc run claude "task"`, isn't a message:
// launchTask() takes it from how the terminal was started)
// so it is in the receiver's session record, and read back from there:
//   Claude Code: ~/.claude/sessions/<pid>.json names the session of the
//     process in the terminal; its record is under ~/.claude/projects.
//   Codex: the newest thread for the terminal's folder in Codex's state database.
// Other programs' records aren't known, so messages to them don't show.

import { exec, hc, home, readTextFile } from "herdr";
import { MAX_TEXT } from "./store.js";

export const keyOf = (t) => `${t.address}@${t.created_ms ?? 0}`;

const TAG = /<hc(?:\s+from="([^"]*)")?([^>]*)>([\s\S]*?)<\/hc>/g;
// A user-side line whose text starts with an hc tag (not a tool result that quotes one).
// A message of several lines arrives as a paste: <pasted_content id="..">, the tag, </pasted_content>.
const LINES = '"(content|text)":"(\\\\n)*(<pasted_content[^>]*>(\\\\n)*)?<hc[ >]';
const STARTS = /^\s*(?:<pasted_content[^>]*>\s*)?<hc[\s>]/;

// The terminals in a parent-child relation: started by `hc run` from another
// terminal, or having started one. -> Map address -> terminal
export function family(terminals) {
  const by = new Map(terminals.map((t) => [t.address, t]));
  const parents = new Set(terminals.map((t) => t.parent).filter((p) => p && by.has(p)));
  return new Map(terminals.filter((t) => (t.parent && by.has(t.parent)) || parents.has(t.address)).map((t) => [t.address, t]));
}

// The topmost terminal above `t` that is still known.
export function rootOf(t, by) {
  let top = t;
  for (let n = 0; n < 20 && top.parent && by.has(top.parent); n++) top = by.get(top.parent);
  return top;
}

// The process in the terminal: { pid, cwd } (from the app's list when it has it, else `hc get`).
async function foreground(t) {
  if (t.foreground?.pid) return t.foreground;
  const r = await hc(["get", t.address, "--json"]);
  return r.code === 0 ? JSON.parse(r.stdout).foreground ?? null : null;
}

const exists = async (path) => (await exec("test", ["-f", path], { timeout: 5000 })).code === 0;

async function claudeRecord(pid) {
  const text = await readTextFile(`${home()}/.claude/sessions/${pid}.json`);
  const s = text ? JSON.parse(text) : null;
  if (!s?.sessionId) return null;
  const guess = `${home()}/.claude/projects/${String(s.cwd ?? "").replace(/[^A-Za-z0-9]/g, "-")}/${s.sessionId}.jsonl`;
  if (await exists(guess)) return guess;
  const r = await exec("find", [`${home()}/.claude/projects`, "-maxdepth", "2", "-name", `${s.sessionId}.jsonl`], { timeout: 10_000 });
  return r.stdout.split("\n").find(Boolean) ?? null;
}

async function codexRecord(cwd) {
  if (!cwd) return null;
  const script = 'db=$(ls -t "${CODEX_HOME:-$HOME/.codex}"/state_*.sqlite 2>/dev/null | head -1); [ -n "$db" ] && sqlite3 -readonly "$db" "select rollout_path from threads where cwd=\'$1\' order by updated_at desc limit 1"';
  const r = await exec("/bin/sh", ["-c", script, "sh", cwd.replace(/'/g, "''")], { timeout: 10_000 });
  return r.stdout.trim().split("\n")[0] || null;
}

// The session record of the agent in terminal `t`, or null.
export async function recordOf(t) {
  const program = t.program?.key ?? "";
  if (program !== "claude" && program !== "codex") return null;
  const fg = await foreground(t);
  if (!fg) return null;
  return program === "claude" ? claudeRecord(fg.pid) : codexRecord(fg.cwd ?? t.cwd);
}

// The user-side texts of a record line. A message that arrives while Claude
// Code is busy is queued, and recorded as a "queue-operation" (its "enqueue"
// is when it arrived) instead of, or before, a user message.
function textsOf(entry) {
  if (entry.type === "queue-operation") return entry.operation === "enqueue" && typeof entry.content === "string" ? [entry.content] : [];
  const content = entry.type === "user" ? entry.message?.content : entry.payload?.role === "user" ? entry.payload.content : null;
  if (typeof content === "string") return [content];
  return Array.isArray(content) ? content.map((b) => b?.text).filter((x) => typeof x === "string") : [];
}

// The hc messages in one line of a record: [{ id, ts, address, name, task, text }]
// (address null: hc's own note).
export function messagesIn(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  const ts = Date.parse(entry.timestamp ?? "") || null;
  const base = entry.uuid ?? entry.payload?.id ?? `${ts}`;
  return textsOf(entry).filter((text) => STARTS.test(text)).flatMap((text, n) => [...text.matchAll(TAG)].map((m, i) => {
    const [address, ...name] = (m[1] ?? "").trim().split(/\s+/);
    const body = m[3].trim();
    return {
      id: `${base}:${n}:${i}`, ts,
      address: address || null, name: name.join(" ") || null,
      task: /\breach=/.test(m[2]),
      text: body.length > MAX_TEXT ? `${body.slice(0, MAX_TEXT)}…` : body,
    };
  }));
}

// Every hc message in a record file.
export async function messagesOf(file) {
  const r = await exec("grep", ["-E", LINES, file], { timeout: 20_000 });
  return r.stdout.split("\n").filter(Boolean).flatMap(messagesIn);
}

// The task a terminal was started with, when it was given on the command line
// (`hc run --bg claude "Fix x"`): the last argument, if it reads like a sentence.
export function launchTask(t) {
  const last = Array.isArray(t.argv) ? t.argv.at(-1) : null;
  if (typeof last !== "string" || t.argv.length < 2 || last.startsWith("-") || !/\s/.test(last.trim()) || last.length < 12) return null;
  return last.length > MAX_TEXT ? `${last.slice(0, MAX_TEXT)}…` : last;
}
