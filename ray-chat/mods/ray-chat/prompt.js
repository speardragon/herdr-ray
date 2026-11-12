// The instruction an agent gets when it is asked, from the Chat panel, to
// consult another agent: the person writes only the question, and the rest
// (how to start or reach the other agent, how the answer comes back, what to
// do with it) is written here, in the app's language. Pure but for tr().

import { tr } from "./i18n/i18n.js";

// What can be asked for. `needs`: the text can't be empty.
export const KINDS = [
  { id: "ask", label: "Ask", needs: true, hint: "What should it ask?" },
  { id: "review", label: "Get a review", needs: false, hint: "What to review (empty: the work in progress)" },
  { id: "opinion", label: "Get a second opinion", needs: false, hint: "What to focus on (empty: the current plan)" },
  { id: "delegate", label: "Delegate a task", needs: true, hint: "What should it do?" },
];

const slug = (text) => `ask-${String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "agent"}`;

// How to reach the other agent. target: { kind: "run", name, run: argv } |
// { kind: "template", name } | { kind: "agent", name, address }
function reach(target, what) {
  if (target.kind === "agent") {
    return tr("Who: {name}, already running at {address}. Send it with: hc send {address} \"{what}\"", { name: target.name, address: target.address, what });
  }
  const command = target.kind === "template" ? target.name : target.run.join(" ");
  return tr("Who: a new {name}. Start it with: hc run --bg --name {slug} {command} \"{what}\"", { name: target.name, slug: slug(target.name), command, what });
}

const LEAD = {
  ask: "Ask another agent the question below and bring back its answer.",
  review: "Have another agent review the work below and bring back what it finds.",
  opinion: "Explain your current plan and conclusions to another agent, ask where they are weak, and bring back its view.",
  delegate: "Hand the task below to another agent, see it through, and check what it did.",
};
const SUBJECT = { ask: "Question:", review: "What to review:", opinion: "What to focus on:", delegate: "Task:" };
const WHAT = { delegate: "<the task>" }; // what stands in the command for the text sent (default: "<what to ask>")
const EMPTY = { review: "The changes you are working on now.", opinion: "The plan you are following now." };
const LAST = {
  ask: "When the answer is in, tell me what it said, in short, and what you make of it.",
  review: "When the review is in, tell me the findings by importance, and which you agree with.",
  opinion: "When its view is in, tell me which points you take and which you don't, and why.",
  delegate: "When it reports, check the result yourself (read what changed, run the tests) before telling me what was done, what is left, and what you are unsure of.",
};
// Handing over work differs from asking: the other agent may change files, so it is told where and what, not "don't".
const BRIEF = {
  delegate: "In what you send, add what it needs to do the work: the folder (start it there with --cwd), the paths involved, what has been decided, and how to tell it is done.",
};
const LIMITS = {
  delegate: "Tell it what it may change and what it must not touch, not to start other agents, and to report with hc send $HC_TERMINAL_ID when done or stuck, saying what it changed.",
};

// -> the text to send to the agent that does the asking.
export function request(kind, target, text) {
  const subject = text.trim() || tr(EMPTY[kind] ?? "");
  return [
    tr(LEAD[kind]),
    "",
    `- ${reach(target, tr(WHAT[kind] ?? "<what to ask>"))}`,
    `- ${tr(BRIEF[kind] ?? "In what you send, add what it needs to answer: the paths involved and what has been decided so far.")}`,
    `- ${tr(LIMITS[kind] ?? "Tell it not to change files or start other agents, and to report with hc send $HC_TERMINAL_ID when done or stuck.")}`,
    `- ${tr("Ask it to write its report in Markdown: the conclusion first in bold, files, commands and names in backticks, a list when there are several points, and bold at most once or twice.")}`,
    `- ${tr("Wait with hc wait --children all (or for its message), not by sleeping.")}`,
    `- ${tr(LAST[kind])}`,
    "",
    tr(SUBJECT[kind]),
    subject,
  ].join("\n");
}
