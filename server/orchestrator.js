// The CTO loop. Jeremiah ticks on an interval: for each idle worker he finds
// the next task (assigned to it -> its department -> general pool), runs it on
// Gemini, reviews the result, marks it done (or re-queues), then moves on.
// When the queue is empty and autonomous mode is on, he generates fresh work.

import {
  bus, getWorkers, getTasks, setAgent, createTask, updateTask, addEvent,
} from "./store.js";
import { runWork, runReview, generateTask } from "./gemini.js";
import { TICK_MS, AUTONOMOUS_DEFAULT } from "./config.js";

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
    addEvent({ kind: "assign", text: `Jeremiah → ${agent.name}: ${task.title}`, agentId: agent.id, taskId: task.id });
    await wait(800 + Math.random() * 700);

    setAgent(agent.id, { status: "working", task: task.title });
    const result = await runWork(agent, task);
    updateTask(task.id, { status: "review", result });

    setAgent(agent.id, { status: "thinking", task: `wrapping up: ${task.title}` });
    addEvent({ kind: "review", text: `${agent.name} submitted: ${task.title}`, agentId: agent.id, taskId: task.id });
    const verdict = await runReview(task, result);

    if (verdict.complete) {
      updateTask(task.id, { status: "done", completedAt: Date.now(), reviewNotes: verdict.note });
      addEvent({ kind: "done", text: `Jeremiah ✓ ${agent.name}: ${task.title} — ${verdict.note}`, agentId: agent.id, taskId: task.id });
    } else if ((task.attempts || 0) + 1 < MAX_ATTEMPTS) {
      updateTask(task.id, { status: "queued", attempts: (task.attempts || 0) + 1, assignedTo: agent.id, startedAt: null, reviewNotes: verdict.note });
      addEvent({ kind: "redo", text: `Jeremiah ↺ ${agent.name}: redo ${task.title} (${verdict.note})`, agentId: agent.id, taskId: task.id });
    } else {
      updateTask(task.id, { status: "failed", completedAt: Date.now(), reviewNotes: verdict.note });
      addEvent({ kind: "fail", text: `Jeremiah ✗ ${agent.name}: ${task.title} failed review`, agentId: agent.id, taskId: task.id });
    }
  } catch (e) {
    addEvent({ kind: "error", text: `${agent.name} error: ${e.message}`, agentId: agent.id, taskId: task.id });
    updateTask(task.id, { status: "queued", startedAt: null });
  } finally {
    setAgent(agent.id, { status: "idle", task: "standing by", currentTaskId: null, lastRunAt: Date.now() });
    busy.delete(agent.id);
  }
}

function maybeGenerate(agent) {
  if (generating.has(agent.department)) return;
  if (Date.now() - (lastGen.get(agent.department) || 0) < GEN_COOLDOWN_MS) return;
  generating.add(agent.department);
  lastGen.set(agent.department, Date.now());
  generateTask(agent)
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
  addEvent({ kind: "system", text: "Mission Control online — Jeremiah on duty" });
  console.log("[orch] started");
}

export const dispatchNow = () => tick();
export function clockOut() {
  setSetting("paused", true);
  addEvent({ kind: "system", text: "Jeremiah: clock out — workers standing down" });
}
export function allHands() {
  settings.paused = false;
  settings.autonomous = true;
  bus.emit("settings", getSettings());
  addEvent({ kind: "system", text: "Jeremiah: all hands — back to work" });
  return tick();
}
