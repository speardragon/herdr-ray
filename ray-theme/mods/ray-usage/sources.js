// Where each provider's usage comes from. A provider whose tool isn't on this
// computer is left out; one that is there but hasn't reported says so.
//   Claude: Anthropic's usage API (claude-usage.sh), which has the per-model
//     weekly limits (Fable); without it, rate_limits from
//     ~/.claude/.last-statusline.json, which Claude Code's status line command
//     has to save (see the RECIPE).
//   Codex: `codex app-server`'s account/rateLimits/read (codex-live.sh), the
//     limits as they are now; without it, the newest session log's
//     rate_limits (codex-limits.sh), as of Codex's last turn here.
//   Antigravity: the quota in ~/.gemini/antigravity-cli/.last-statusline.json
//     (its status line command has to save its input there, as Claude's does),
//     else the agy-hud plugin's quota cache.
//   Grok: the plan usage it last fetched, from its log (a snapshot from when
//     Grok last started), and the last 7 days' sessions, tokens and cost from
//     its session records.
// A provider: { id, name, icon, tint, plan?, asOf?, rows, stats?, note? }
//   rows: [{ key, label?, group?, used: percent | null, resets: ms | null }]
//   (used null: the window's reset time has passed and nothing reported since)

import { exec, home, appHome, readTextFile, shared, setShared } from "herdr";

const SLOW_MS = 5 * 60_000; // how often the API and Grok's records are asked
const WEEK_MS = 7 * 24 * 3600_000;
const TICKS_PER_USD = 1e10; // xAI counts cost in ticks

const here = () => `${appHome()}/mods/ray-usage`;

async function readJson(path) {
  const text = await readTextFile(path);
  return text ? JSON.parse(text) : null;
}

// A failing source (unreadable file, a format that changed) stays out
// instead of breaking the others.
async function quietly(read) {
  try {
    return await read();
  } catch {
    return null;
  }
}

// What `read` gave, kept in shared `key` for SLOW_MS; `force` asks again.
// A read that fails (the API refusing for a while, say) keeps what the last
// good one gave and is tried again in a minute, so a provider doesn't drop
// out of the bar over one bad answer.
const RETRY_MS = 60_000;
async function kept(key, force, read) {
  const old = shared(key);
  if (!force && old && Date.now() - old.at < SLOW_MS) return old.value;
  const value = await quietly(read);
  if (value !== null) setShared(key, { at: Date.now(), value });
  else setShared(key, { at: Date.now() - SLOW_MS + RETRY_MS, value: old?.value ?? null });
  return value ?? old?.value ?? null;
}

// A window whose reset time has passed reads "–": what was used since isn't
// known (it may have been used elsewhere), only that the report is too old.
function row(key, label, group, used, resets) {
  const live = typeof used === "number" && (resets === null || resets > Date.now());
  return { key, label, group, used: live ? Math.round(used) : null, resets: live ? resets : null };
}

const time = (text) => (text && !Number.isNaN(Date.parse(text)) ? Date.parse(text) : null);

// ---- Claude ---------------------------------------------------------------

function apiRows(d) {
  if (Array.isArray(d?.limits)) {
    return d.limits.flatMap((l, i) => {
      if (l.kind === "session") return [row("short", "5-hour window", null, l.percent, time(l.resets_at))];
      if (l.kind === "weekly_all") return [row("week", "Week", null, l.percent, time(l.resets_at))];
      const model = l.scope?.model?.display_name;
      return model ? [row(`model-${i}`, "Week", model, l.percent, time(l.resets_at))] : [];
    });
  }
  const old = [["five_hour", "short", "5-hour window", null], ["seven_day", "week", "Week", null], ["seven_day_opus", "opus", "Week", "Opus"], ["seven_day_sonnet", "sonnet", "Week", "Sonnet"]];
  return old.flatMap(([field, key, label, group]) => (d?.[field] ? [row(key, label, group, d[field].utilization, time(d[field].resets_at))] : []));
}

async function claudeApi() {
  const r = await exec("/bin/sh", [`${here()}/claude-usage.sh`], { timeout: 20_000 });
  const rows = r.code === 0 && r.stdout.trim() ? apiRows(JSON.parse(r.stdout)) : [];
  return rows.length ? rows : null;
}

async function claudeStatusLine() {
  const limits = (await readJson(`${home()}/.claude/.last-statusline.json`))?.rate_limits;
  if (!limits) return null;
  const ms = (s) => (typeof s === "number" ? s * 1000 : null);
  return [
    row("short", "5-hour window", null, limits.five_hour?.used_percentage, ms(limits.five_hour?.resets_at)),
    row("week", "Week", null, limits.seven_day?.used_percentage, ms(limits.seven_day?.resets_at)),
  ];
}

async function claude(force) {
  const rows = (await kept("ray.usage.claude", force, claudeApi)) ?? (await quietly(claudeStatusLine));
  return rows ? { id: "claude", name: "Claude", icon: "icons/claude.svg", rows } : null;
}

// ---- Codex ----------------------------------------------------------------

function findLimits(node) {
  if (!node || typeof node !== "object") return null;
  if (node.rate_limits && typeof node.rate_limits === "object") return node.rate_limits;
  for (const value of Object.values(node)) {
    const found = findLimits(value);
    if (found) return found;
  }
  return null;
}

// Codex's limits object, from the app server (camelCase) or a session log
// (snake_case) -> { plan, rows }.
function codexRows(limits) {
  const pick = (w) => (w ? { used: w.usedPercent ?? w.used_percent, minutes: w.windowDurationMins ?? w.window_minutes, resets: w.resetsAt ?? w.resets_at } : null);
  // primary/secondary are named by length, not order: pick by the window's length.
  const all = [pick(limits.primary), pick(limits.secondary)].filter(Boolean);
  const shortest = all.find((w) => w.minutes <= 300) ?? all[0];
  const longest = all.find((w) => w.minutes >= 10080) ?? all[1];
  const ms = (sec) => (typeof sec === "number" ? sec * 1000 : null);
  const plan = limits.planType ?? limits.plan_type;
  return {
    plan: typeof plan === "string" ? plan.replace(/^./, (c) => c.toUpperCase()) : null,
    rows: [
      row("short", "5-hour window", null, shortest?.used, ms(shortest?.resets)),
      row("week", "Week", null, longest?.used, ms(longest?.resets)),
    ],
  };
}

// As they are now, from `codex app-server` (it takes a few seconds to start).
async function codexLive() {
  const r = await exec("/bin/sh", [`${here()}/codex-live.sh`], { timeout: 30_000 });
  const limits = r.stdout.trim() ? JSON.parse(r.stdout.trim()).result?.rateLimits : null;
  return limits ? codexRows(limits) : null;
}

// As of Codex's last turn on this computer, from its session log.
async function codexLog() {
  const r = await exec("/bin/sh", [`${here()}/codex-limits.sh`], { timeout: 10_000 });
  const entry = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null;
  const limits = findLimits(entry);
  return limits ? { ...codexRows(limits), asOf: time(entry.timestamp) } : null;
}

async function codex(force) {
  const found = (await kept("ray.usage.codex", force, codexLive)) ?? (await quietly(codexLog));
  return found ? { id: "codex", name: "Codex", icon: "icons/codex.svg", ...found } : null;
}

// ---- Antigravity ----------------------------------------------------------

const BUCKETS = [["gemini-5h", "5-hour window", "Gemini"], ["gemini-weekly", "Week", "Gemini"], ["3p-5h", "5-hour window", "Claude · GPT"], ["3p-weekly", "Week", "Claude · GPT"]];
const used = (fraction) => (typeof fraction === "number" ? (1 - fraction) * 100 : null);

// agy-hud's cache lists every model; models of a family share a quota, so one
// row a family, with the most used of them.
function family(model) {
  if (/flash/i.test(model)) return "Gemini Flash";
  if (/gemini/i.test(model)) return "Gemini Pro";
  if (/claude/i.test(model)) return "Claude";
  return model.replace(/\s*\(.*\)$/, "");
}

function cacheRows(models) {
  const worst = Object.entries(models ?? {}).reduce((m, [name, q]) => {
    const f = family(name);
    return !m[f] || (q.remainingFraction ?? 1) < (m[f].remainingFraction ?? 1) ? { ...m, [f]: q } : m;
  }, {});
  return Object.entries(worst).map(([f, q]) => row(`family-${f}`, null, f, used(q.remainingFraction), time(q.resetTime)));
}

async function antigravity() {
  const dir = `${home()}/.gemini/antigravity-cli`;
  const base = { id: "antigravity", name: "Antigravity", icon: "icons/antigravity.svg" };
  const live = await quietly(() => readJson(`${dir}/.last-statusline.json`));
  if (live?.quota) {
    const rows = BUCKETS.flatMap(([key, label, group]) => (live.quota[key] ? [row(key, label, group, used(live.quota[key].remaining_fraction), time(live.quota[key].reset_time))] : []));
    return { ...base, plan: live.plan_tier || null, rows };
  }
  const cache = await quietly(() => readJson(`${home()}/.cache/agy-hud/quota_cache.json`));
  if (cache?.models) return { ...base, plan: cache.plan_name ?? null, asOf: time(cache.timestamp), rows: cacheRows(cache.models) };
  const installed = await quietly(() => readTextFile(`${dir}/settings.json`));
  return installed ? { ...base, rows: [], note: "No report yet. It shows up once it has been used." } : null;
}

// ---- Grok -----------------------------------------------------------------

function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

async function grokWeek() {
  const r = await exec("/bin/sh", ["-c", 'find "$HOME/.grok/sessions" -name usage.json -mtime -7 2>/dev/null | head -200'], { timeout: 15_000 });
  const files = r.stdout.split("\n").filter(Boolean);
  const all = await Promise.all(files.map((f) => quietly(() => readJson(f))));
  const recent = all.filter((u) => u?.session && (time(u.updatedAt) ?? 0) > Date.now() - WEEK_MS);
  return recent.reduce((sum, u) => ({
    sessions: sum.sessions + 1,
    tokens: sum.tokens + (u.session.totalTokens ?? 0),
    ticks: sum.ticks + (u.session.costUsdTicks ?? 0),
  }), { sessions: 0, tokens: 0, ticks: 0 });
}

// The plan's usage as Grok last fetched it: it logs "billing: fetched credits
// config" to ~/.grok/logs/unified.jsonl when it starts and when /usage opens,
// so this is a snapshot from then (shown with its time), not live.
async function grokPlan() {
  const r = await exec("/bin/sh", ["-c", 'tail -c 8000000 "$HOME/.grok/logs/unified.jsonl" 2>/dev/null | grep "billing: fetched credits config" | tail -1'], { timeout: 15_000 });
  const line = r.stdout.trim();
  const entry = line ? JSON.parse(line) : null;
  const config = entry?.ctx?.config;
  if (typeof config?.creditUsagePercent !== "number") return null;
  const weekly = /WEEKLY/i.test(config.currentPeriod?.type ?? "");
  return {
    plan: entry.ctx.subscriptionTier ?? null,
    asOf: time(entry.ts),
    rows: [row("period", weekly ? "Week" : "This period", null, config.creditUsagePercent, time(config.currentPeriod?.end))],
  };
}

async function grok(force) {
  const installed = await quietly(() => readTextFile(`${home()}/.grok/version.json`));
  if (!installed) return null;
  const plan = await quietly(grokPlan);
  const week = (await kept("ray.usage.grok", force, grokWeek)) ?? { sessions: 0, tokens: 0, ticks: 0 };
  return {
    id: "grok", name: "Grok", icon: "icons/grok.svg", tint: true,
    plan: plan?.plan ?? null, asOf: plan?.asOf ?? null, rows: plan?.rows ?? [],
    stats: [["Sessions", String(week.sessions)], ["Tokens", compact(week.tokens)], ["Cost", `$${(week.ticks / TICKS_PER_USD).toFixed(2)}`]],
    note: plan ? "Sessions, tokens and cost are the last 7 days'." : "Last 7 days. Open Grok once to see its plan usage.",
  };
}

// Every provider found on this computer, in the order shown.
export async function readAll(force = false) {
  const found = await Promise.all([quietly(() => claude(force)), quietly(() => codex(force)), quietly(antigravity), quietly(() => grok(force))]);
  return found.filter(Boolean);
}
