// The CTO loop. Jay Jay ticks on an interval: for each idle worker he finds
// the next task (assigned to it -> its department -> general pool), runs it on
// Gemini, reviews the result, marks it done (or re-queues), then moves on.
// When the queue is empty and autonomous mode is on, he generates fresh work.

import {
  bus, getWorkers, getTasks, getTask, setAgent, createTask, updateTask, addEvent,
  upsertDocument, recallMemory, appendMemory, addMemoryNote, createIssue, getAttachments, getTaskCredentials, deleteIssuesForTask,
  recordOutcome, getStats,
} from "./store.js";
import { runWork, runReview, generateTask, summarizeForMemory, planTask, synthesize, embed, consultAgent, classifyDepartment } from "./gemini.js";
import { toolsFor } from "./tools.js";
import { DEPARTMENTS } from "./agents.js";
import { TICK_MS, AUTONOMOUS_DEFAULT, GEMINI_MODEL, GEMINI_DEMO_MODEL, GEMINI_FLASH_MODEL, GEMINI_DAILY_BUDGET_USD } from "./config.js";

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

const deptAgentBusy = (dept) => {
  const w = getWorkers().find((a) => a.department === dept);
  return w ? busy.has(w.id) : false;
};

// A task is ready only when all its dependencies are done (missing deps count
// as met so a deleted upstream can't deadlock it).
const depsMet = (t) => !(t.dependsOn || []).some((id) => { const d = getTask(id); return d && d.status !== "done"; });

function nextTaskFor(agent) {
  // Plan tasks are orchestrated by processPlans (decompose -> synthesize), not
  // worked directly by an agent. Tasks waiting on dependencies are held.
  const queued = getTasks().filter((t) => t.status === "queued" && !t.isPlan && depsMet(t));
  // Higher priority first, then oldest first.
  const RANK = { high: 0, normal: 1, low: 2 };
  const byAge = (a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || a.createdAt - b.createdAt;
  let pool = queued.filter((t) => t.assignedTo === agent.id).sort(byAge);
  if (!pool.length)
    pool = queued.filter((t) => !t.assignedTo && t.department === agent.department).sort(byAge);
  if (!pool.length)
    // General pool is only for demo/auto tasks; user "Any" tasks are routed to a
    // department first (routeTasks), so they reach the right specialist.
    pool = queued.filter((t) => !t.assignedTo && !t.department && t.createdBy === "cto").sort(byAge);
  // Overflow assist: a free worker helps another department whose own agent is
  // busy. Security is excluded both ways — Warden never leaves security duty,
  // and security tasks are only ever done by Warden.
  if (!pool.length && agent.department !== "security")
    pool = queued.filter((t) => !t.assignedTo && t.department && t.department !== "security" && t.department !== agent.department && deptAgentBusy(t.department)).sort(byAge);
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
    // Light model (Flash) for the cheap, frequent orchestration calls.
    const lightModel = isUser ? (GEMINI_FLASH_MODEL || model) : model;

    setAgent(agent.id, { status: "working", task: task.title });
    // Semantic recall: embed the task, pull the most relevant memory notes
    // (keeps prompts lean + on-point as a department's memory grows).
    let memoryText = "";
    if (isUser) {
      const qvec = await embed(`${task.title} ${task.prompt}`).catch(() => null);
      memoryText = recallMemory(agent.department, `${task.title} ${task.prompt}`, qvec, 8);
    }
    // Any output from a prior attempt becomes context so the agent CONTINUES
    // the work instead of starting cold (re-queues and manual "Continue").
    const priorWork = isUser ? (task.result || task.priorWork || null) : null;
    // Attached files the agent can read (images / PDF / text). Gemini-supported types only.
    const media = isUser
      ? getAttachments(task.id)
          .filter((a) => /^image\//.test(a.mime) || a.mime === "application/pdf" || /^text\//.test(a.mime))
          .map((a) => ({ mimeType: a.mime, data: a.data }))
      : [];
    // Tools: every agent can hand off (request_help); Development also gets the
    // API/credential tools. consult() runs a peer department's specialist (Flash).
    const tools = isUser ? toolsFor(agent.department) : null;
    const toolCtx = tools ? {
      taskId: task.id, agentId: agent.id, agentName: agent.name,
      credentials: getTaskCredentials(task.id),
      consult: (dept, q) => consultAgent(dept, q, lightModel),
    } : null;
    // Upstream: deliverables from completed dependencies, so this step builds on them.
    const upstream = isUser
      ? (task.dependsOn || []).map((id) => getTask(id)).filter((d) => d && d.status === "done" && d.result).map((d) => ({ title: d.title, result: d.result }))
      : [];
    let result;
    try {
      result = await runWork(agent, task, memoryText, model, priorWork, media, tools, toolCtx, upstream);
    } catch (err) { handleError(agent, task, err); return; }
    updateTask(task.id, { status: "review", result });

    setAgent(agent.id, { status: "thinking", task: `wrapping up: ${task.title}` });
    addEvent({ kind: "review", text: `${agent.name} submitted: ${task.title}`, agentId: agent.id, taskId: task.id });
    let verdict;
    try {
      verdict = await runReview(task, result, lightModel);
    } catch (err) { handleError(agent, task, err); return; }

    if (verdict.complete) {
      updateTask(task.id, { status: "done", completedAt: Date.now(), reviewNotes: verdict.note });
      recordOutcome(true);
      deleteIssuesForTask(task.id); // it succeeded — clear any prior issues for it
      if (isUser) {
        // Sub-tasks of a plan don't make their own document (the plan's synthesis
        // is the single output) — but they DO still contribute to memory.
        const parent = task.parentId ? getTasks().find((x) => x.id === task.parentId) : null;
        const isPlanChild = !!(parent && parent.isPlan);
        if (!isPlanChild) upsertDocument({ taskId: task.id, title: task.title, prompt: task.prompt, department: agent.department, agentId: agent.id, content: result });
        // Fold a note into the department's memory (blob + embedded note) so
        // future related tasks build on it via semantic recall.
        const note = await summarizeForMemory(agent, task, result, lightModel).catch(() => `${task.title} — completed.`);
        const label = `${(DEPARTMENTS[agent.department]?.label) || agent.department} memory`;
        appendMemory(agent.department, `- ${note}`, label, agent.name);
        embed(note).then((vec) => addMemoryNote(agent.department, note, task.id, vec)).catch(() => {});
      }
      addEvent({ kind: "done", text: `Jay Jay ✓ ${agent.name}: ${task.title} — ${verdict.note}`, agentId: agent.id, taskId: task.id });
    } else if ((task.attempts || 0) + 1 < MAX_ATTEMPTS) {
      updateTask(task.id, { status: "queued", attempts: (task.attempts || 0) + 1, assignedTo: agent.id, startedAt: null, reviewNotes: verdict.note });
      addEvent({ kind: "redo", text: `Jay Jay ↺ ${agent.name}: redo ${task.title} (${verdict.note})`, agentId: agent.id, taskId: task.id });
    } else {
      updateTask(task.id, { status: "failed", completedAt: Date.now(), reviewNotes: verdict.note });
      recordOutcome(false);
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

// ---- Smart routing: send "Any department" tasks to the best specialist ----
const routing = new Set();
function routeTasks() {
  for (const t of getTasks()) {
    if (t.status !== "queued" || t.department || t.assignedTo || t.isPlan || t.parentId || t.createdBy === "cto") continue;
    if (routing.has(t.id)) continue;
    routing.add(t.id);
    classifyDepartment(t, GEMINI_FLASH_MODEL || GEMINI_MODEL)
      .then((dept) => {
        const d = dept || "research_lab"; // default to a generalist so nothing stalls
        updateTask(t.id, { department: d });
        addEvent({ kind: "system", text: `Jay Jay routed "${t.title}" → ${DEPARTMENTS[d]?.label || d}`, agentId: "jeremiah", taskId: t.id });
      })
      .catch(() => updateTask(t.id, { department: "research_lab" }))
      .finally(() => routing.delete(t.id));
  }
}

// ---- Planning (orchestrator-worker): decompose a goal -> sub-tasks -> synthesize ----
const planning = new Set();

function processPlans() {
  for (const t of getTasks()) {
    if (!t.isPlan || planning.has(t.id)) continue;
    if (t.status === "queued") {
      planning.add(t.id);
      makePlan(t).catch((e) => console.error("[orch] makePlan", e.message)).finally(() => planning.delete(t.id));
    } else if (t.status === "planning") {
      const kids = getTasks().filter((c) => c.parentId === t.id);
      if (kids.length && kids.every((c) => c.status === "done" || c.status === "failed")) {
        planning.add(t.id);
        synthesizePlan(t, kids).catch((e) => console.error("[orch] synthesizePlan", e.message)).finally(() => planning.delete(t.id));
      }
    }
  }
}

async function makePlan(t) {
  updateTask(t.id, { status: "planning", startedAt: Date.now() });
  setAgent("jeremiah", { status: "thinking", task: `planning: ${t.title}` });
  addEvent({ kind: "system", text: `Jay Jay is planning "${t.title}"…`, agentId: "jeremiah", taskId: t.id });
  const subs = await planTask(t, GEMINI_MODEL);
  // Create children in order, wiring each step's "after" into a real dependency
  // so the plan runs as a pipeline (later steps get earlier steps' deliverables).
  const created = [];
  for (const s of subs) {
    const deps = (typeof s.after === "number" && created[s.after]) ? [created[s.after].id] : [];
    created.push(createTask({ title: s.title, prompt: s.prompt, department: s.department, createdBy: "user", parentId: t.id, dependsOn: deps }));
  }
  const chained = created.filter((c) => c.dependsOn && c.dependsOn.length).length;
  setAgent("jeremiah", { status: "command", task: "on duty" });
  addEvent({ kind: "assign", text: `Jay Jay split "${t.title}" into ${subs.length} sub-tasks${chained ? ` (${chained} chained)` : ""}`, agentId: "jeremiah", taskId: t.id });
}

async function synthesizePlan(t, kids) {
  const done = kids.filter((c) => c.status === "done");
  if (!done.length) {
    updateTask(t.id, { status: "failed", completedAt: Date.now(), reviewNotes: "all sub-tasks failed" });
    createIssue({ kind: "review", title: `Plan "${t.title}" — all sub-tasks failed`, detail: "None of the sub-tasks produced a deliverable; check the sub-tasks for the cause.", taskId: t.id });
    addEvent({ kind: "fail", text: `Jay Jay ✗ "${t.title}" — sub-tasks failed`, taskId: t.id });
    return;
  }
  setAgent("jeremiah", { status: "thinking", task: `assembling: ${t.title}` });
  addEvent({ kind: "review", text: `Jay Jay is assembling "${t.title}" from ${done.length} sub-tasks…`, agentId: "jeremiah", taskId: t.id });
  const parts = done.map((c) => ({ title: c.title, department: c.department, result: c.result }));
  const final = await synthesize(t, parts, GEMINI_MODEL);
  updateTask(t.id, { status: "done", result: final, completedAt: Date.now(), reviewNotes: `assembled from ${done.length} sub-tasks` });
  upsertDocument({ taskId: t.id, title: t.title, prompt: t.prompt, department: t.department || "command", agentId: "jeremiah", content: final });
  setAgent("jeremiah", { status: "command", task: "on duty" });
  addEvent({ kind: "done", text: `Jay Jay ✓ assembled "${t.title}" from ${done.length} sub-tasks`, agentId: "jeremiah", taskId: t.id });
}

async function tick() {
  if (settings.paused) return;
  routeTasks();
  // Daily spend ceiling: pause the office when the estimated cost crosses it.
  if (GEMINI_DAILY_BUDGET_USD > 0 && getStats().estCostTotal >= GEMINI_DAILY_BUDGET_USD) {
    settings.paused = true;
    bus.emit("settings", getSettings());
    addEvent({ kind: "system", text: `💸 Daily budget ~$${GEMINI_DAILY_BUDGET_USD} reached — office paused. Raise GEMINI_DAILY_BUDGET_USD or press ALL HANDS (resets at UTC midnight).` });
    return;
  }
  processPlans();
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
