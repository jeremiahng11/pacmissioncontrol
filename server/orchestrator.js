// The CTO loop. Jay Jay ticks on an interval: for each idle worker he finds
// the next task (assigned to it -> its department -> general pool), runs it on
// Gemini, reviews the result, marks it done (or re-queues), then moves on.
// When the queue is empty and autonomous mode is on, he generates fresh work.

import {
  bus, getWorkers, getTasks, setAgent, createTask, updateTask, addEvent,
  createDocument, getMemoryText, appendMemory, createIssue, getAttachments, getTaskCredentials,
} from "./store.js";
import { runWork, runReview, generateTask, summarizeForMemory } from "./gemini.js";
import { toolsFor } from "./tools.js";
import { DEPARTMENTS } from "./agents.js";
import { TICK_MS, AUTONOMOUS_DEFAULT, GEMINI_MODEL, GEMINI_DEMO_MODEL } from "./config.js";

const MAX_ATTEMPTS = 2;
const GEN_COOLDOWN_MS = 9000; // calmer autonomous cadence when AUTO is on

const settings = { paused: false, autonomous: AUTONOMOUS_DEFAULT };
const busy = new Set(); // agent ids currently running a task
const generating = new Set(); // departments mid-generation
const lastGen = new Map(); // department -> ts

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const getSettings = () => ({ ...settings });
export function setSetting(key, value) {
  settings[key] = value;
  bus.emit("settings", getSettings());
}

function nextTaskFor(agent) {
  const queued = getTasks().filter((t) => t.status === "queued");
  const byAge = (a, b) => a.createdAt - b.createdAt;
  let pool = queued.filter((t) => t.assignedTo === agent.id).sort(byAge);
  if (!pool.length)
    pool = queued.filter((t) => !t.assignedTo && t.department === agent.department).sort(byAge);
  if (!pool.length)
    pool = queued.filter((t) => !t.assignedTo && !t.department).sort(byAge);
  return pool[0] || null;
}

async function runTask(agent, task) {
  busy.add(agent.id);
  try {
    updateTask(task.id, { status: "in_progress", assignedTo: agent.id, startedAt: Date.now() });
    setAgent(agent.id, { status: "thinking", task: `picking up: ${task.title}`, currentTaskId: task.id });
    addEvent({ kind: "assign", text: `Jay Jay → ${agent.name}: ${task.title}`, agentId: agent.id, taskId: task.id });
    await wait(800 + Math.random() * 700);

    // Real work (your tasks + scheduled routines) runs on GEMINI_MODEL and
    // produces docs/memory. Only the AUTO demo (createdBy 'cto') is simulated
    // (model=null) or runs on the free demo model.
    const isUser = task.createdBy !== "cto";
    const model = isUser ? GEMINI_MODEL : (GEMINI_DEMO_MODEL || null);

    setAgent(agent.id, { status: "working", task: task.title });
    const memoryText = isUser ? getMemoryText(agent.department) : "";
    // Any output from a prior attempt becomes context so the agent CONTINUES
    // the work instead of starting cold (re-queues and manual "Continue").
    const priorWork = isUser ? (task.result || null) : null;
    // Attached files the agent can read (images / PDF / text). Gemini-supported types only.
    const media = isUser
      ? getAttachments(task.id)
          .filter((a) => /^image\//.test(a.mime) || a.mime === "application/pdf" || /^text\//.test(a.mime))
          .map((a) => ({ mimeType: a.mime, data: a.data }))
      : [];
    // Tools (least-privilege per department): Development can call APIs.
    const tools = isUser ? toolsFor(agent.department) : null;
    const toolCtx = tools ? { taskId: task.id, agentId: agent.id, agentName: agent.name, credentials: getTaskCredentials(task.id) } : null;
    let result;
    try {
      result = await runWork(agent, task, memoryText, model, priorWork, media, tools, toolCtx);
    } catch (err) { handleError(agent, task, err); return; }
    updateTask(task.id, { status: "review", result });

    setAgent(agent.id, { status: "thinking", task: `wrapping up: ${task.title}` });
    addEvent({ kind: "review", text: `${agent.name} submitted: ${task.title}`, agentId: agent.id, taskId: task.id });
    let verdict;
    try {
      verdict = await runReview(task, result, model);
    } catch (err) { handleError(agent, task, err); return; }

    if (verdict.complete) {
      updateTask(task.id, { status: "done", completedAt: Date.now(), reviewNotes: verdict.note });
      if (isUser) {
        // Real work only: save the deliverable as a document and fold a note
        // into the department's memory so future tasks continue the work.
        createDocument({ taskId: task.id, title: task.title, prompt: task.prompt, department: agent.department, agentId: agent.id, content: result });
        const note = await summarizeForMemory(agent, task, result, model).catch(() => `${task.title} — completed.`);
        const label = `${(DEPARTMENTS[agent.department]?.label) || agent.department} memory`;
        appendMemory(agent.department, `- ${note}`, label, agent.name);
      }
      addEvent({ kind: "done", text: `Jay Jay ✓ ${agent.name}: ${task.title} — ${verdict.note}`, agentId: agent.id, taskId: task.id });
    } else if ((task.attempts || 0) + 1 < MAX_ATTEMPTS) {
      updateTask(task.id, { status: "queued", attempts: (task.attempts || 0) + 1, assignedTo: agent.id, startedAt: null, reviewNotes: verdict.note });
      addEvent({ kind: "redo", text: `Jay Jay ↺ ${agent.name}: redo ${task.title} (${verdict.note})`, agentId: agent.id, taskId: task.id });
    } else {
      updateTask(task.id, { status: "failed", completedAt: Date.now(), reviewNotes: verdict.note });
      createIssue({ kind: "review", title: `"${task.title}" failed review`, detail: `${agent.name} could not satisfy the task after ${MAX_ATTEMPTS} attempts. Last review note: ${verdict.note}`, taskId: task.id, agentId: agent.id });
      addEvent({ kind: "fail", text: `Jay Jay ✗ ${agent.name}: ${task.title} failed review`, agentId: agent.id, taskId: task.id });
    }
  } catch (e) {
    handleError(agent, task, e);
  } finally {
    setAgent(agent.id, { status: "idle", task: "standing by", currentTaskId: null, lastRunAt: Date.now() });
    busy.delete(agent.id);
  }
}

// Turn a thrown error into the right outcome: a blocking system error (quota/
// auth) -> task blocked + Issue raised + AUTO paused (no re-queue, no burning
// the API); a transient error -> re-queue a couple times, then fail + Issue.
function classify(err) {
  const msg = (err && err.message) || String(err);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return { kind: "quota", blocking: true, msg };
  // Bad/unknown model name or other invalid-argument config — retrying won't help.
  if (/unexpected model name|INVALID_ARGUMENT|model.*not found|not found.*model|unsupported model/i.test(msg)) return { kind: "config", blocking: true, msg };
  if (/\b40[13]\b|api key|permission|unauthenticat|invalid.*key/i.test(msg)) return { kind: "auth", blocking: true, msg };
  return { kind: "error", blocking: false, msg };
}

function handleError(agent, task, err) {
  const c = classify(err);
  if (c.blocking) {
    updateTask(task.id, { status: "blocked", startedAt: null, reviewNotes: c.msg.slice(0, 200) });
    const title = c.kind === "quota" ? `Gemini quota exceeded (${GEMINI_MODEL})`
      : c.kind === "config" ? `Invalid GEMINI_MODEL: "${GEMINI_MODEL}"`
      : `Gemini ${c.kind} error (${GEMINI_MODEL})`;
    const hint = c.kind === "quota"
      ? "Set GEMINI_MODEL=gemini-2.5-flash (free tier) or enable billing for Pro."
      : c.kind === "config"
      ? "The model name is malformed or unknown. Set GEMINI_MODEL to a valid id — exactly 'gemini-2.5-pro' or 'gemini-2.5-flash' (lowercase, hyphens, no quotes or spaces)."
      : "Check GEMINI_API_KEY and that the model is enabled for your project.";
    createIssue({ kind: c.kind, title, detail: `${hint}\n\n${c.msg.slice(0, 400)}`, taskId: task.id, agentId: agent.id });
    addEvent({ kind: "issue", text: `⚠️ ${c.kind} issue — ${agent.name} blocked on "${task.title}"`, agentId: agent.id, taskId: task.id });
    // Stop the office so queued tasks don't keep failing and spawning new
    // issues. The user fixes the cause (billing/model), then presses ALL HANDS.
    settings.autonomous = false;
    if (!settings.paused) {
      settings.paused = true;
      bus.emit("settings", getSettings());
      addEvent({ kind: "system", text: `Jay Jay paused the office — fix the ${c.kind} (billing / GEMINI_MODEL), then press ALL HANDS` });
    } else {
      bus.emit("settings", getSettings());
    }
  } else if ((task.attempts || 0) + 1 < MAX_ATTEMPTS) {
    updateTask(task.id, { status: "queued", attempts: (task.attempts || 0) + 1, startedAt: null, reviewNotes: c.msg.slice(0, 200) });
    addEvent({ kind: "redo", text: `Jay Jay ↺ ${agent.name}: retry "${task.title}" (error)`, agentId: agent.id, taskId: task.id });
  } else {
    updateTask(task.id, { status: "failed", completedAt: Date.now(), reviewNotes: c.msg.slice(0, 200) });
    createIssue({ kind: "error", title: `"${task.title}" failed after retries`, detail: c.msg.slice(0, 400), taskId: task.id, agentId: agent.id });
    addEvent({ kind: "fail", text: `Jay Jay ✗ ${agent.name}: "${task.title}" failed`, agentId: agent.id, taskId: task.id });
  }
}

function maybeGenerate(agent) {
  if (generating.has(agent.department)) return;
  if (Date.now() - (lastGen.get(agent.department) || 0) < GEN_COOLDOWN_MS) return;
  generating.add(agent.department);
  lastGen.set(agent.department, Date.now());
  generateTask(agent, GEMINI_DEMO_MODEL || null) // null => canned title, no API call
    .then((t) => createTask({ ...t, department: agent.department, createdBy: "cto" }))
    .catch((e) => console.error("[orch] generateTask", e.message))
    .finally(() => generating.delete(agent.department));
}

async function tick() {
  if (settings.paused) return;
  for (const agent of getWorkers()) {
    if (agent.status !== "idle" || busy.has(agent.id)) continue;
    const task = nextTaskFor(agent);
    if (task) {
      runTask(agent, task); // fire-and-forget; busy set prevents double assignment
    } else if (settings.autonomous) {
      maybeGenerate(agent);
    }
  }
}

let timer = null;
export function startOrchestrator() {
  if (timer) return;
  timer = setInterval(() => tick().catch((e) => console.error("[orch] tick", e.message)), TICK_MS);
  addEvent({ kind: "system", text: "Mission Control online — Jay Jay on duty" });
  console.log("[orch] started");
}

export const dispatchNow = () => tick();
export function clockOut() {
  setSetting("paused", true);
  addEvent({ kind: "system", text: "Jay Jay: clock out — workers standing down" });
}
export function allHands() {
  // Resume the office (the opposite of CLOCK OUT). Does NOT touch AUTO — the
  // demo is controlled only by the AUTO toggle.
  settings.paused = false;
  bus.emit("settings", getSettings());
  addEvent({ kind: "system", text: "Jay Jay: all hands — back to work" });
  return tick();
}
