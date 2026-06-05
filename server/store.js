// Runtime state store. In-memory maps are the source of truth for the live
// loop; Postgres (when DATABASE_URL is set) is the durable backing store:
// loaded on boot, written through on every change. Mutations emit on `bus`
// so the WebSocket layer can broadcast them.

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { AGENT_DEFS } from "./agents.js";
import { DATABASE_URL } from "./config.js";

const { Pool } = pg;
export const bus = new EventEmitter();
bus.setMaxListeners(50);

const MAX_EVENTS = 200;
const state = {
  agents: new Map(), // id -> agent (includes persona/department; not serialized)
  tasks: new Map(), // id -> task
  events: [], // newest-first, capped
};
let eventSeq = 1;
let pool = null;

function needsSsl(url) {
  return /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
}

function timeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ---------- serialization (what clients see) ---------- */
export function serializeAgent(a) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    room: a.room,
    department: a.department,
    color: a.color,
    cto: a.cto,
    status: a.status,
    task: a.task,
    currentTaskId: a.currentTaskId || null,
    last: a.cto ? "" : timeAgo(a.lastRunAt),
  };
}
export function serializeTask(t) {
  return { ...t };
}

/* ---------- boot ---------- */
const SCHEMA = process.env.DB_SCHEMA || "mission_control";

export async function initStore() {
  if (DATABASE_URL) {
    // Keep our tables in their own schema so the DB can be safely shared with
    // another app (Render free tier allows only one Postgres per account).
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: needsSsl(DATABASE_URL),
      max: 5,
      options: `-c search_path=${SCHEMA}`,
    });
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await migrate();
  }
  await loadAgents();
  if (pool) await loadTasks();
  console.log(`[store] ready (${pool ? "postgres" : "in-memory"})`);
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id text PRIMARY KEY, name text, role text, room text, department text,
      color text, cto boolean, status text, task text,
      current_task_id text, last_run_at timestamptz, updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY, title text NOT NULL, prompt text NOT NULL,
      department text, assigned_to text, status text NOT NULL DEFAULT 'queued',
      result text, review_notes text, attempts int NOT NULL DEFAULT 0,
      created_by text DEFAULT 'user',
      created_at timestamptz DEFAULT now(), started_at timestamptz, completed_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS events (
      id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(),
      kind text, text text, agent_id text, task_id text
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
  `);
}

async function loadAgents() {
  let rows = [];
  if (pool) rows = (await pool.query("SELECT * FROM agents")).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const def of AGENT_DEFS) {
    const row = byId.get(def.id);
    const agent = {
      ...def,
      status: row?.status || (def.cto ? "command" : "idle"),
      task: row?.task || (def.cto ? "running the office" : "standing by"),
      currentTaskId: row?.current_task_id || null,
      lastRunAt: row?.last_run_at ? new Date(row.last_run_at).getTime() : null,
    };
    state.agents.set(def.id, agent);
    if (pool && !row) await persistAgent(agent);
  }
}

async function loadTasks() {
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE status <> 'done' OR completed_at > now() - interval '1 day' ORDER BY created_at"
  );
  for (const r of rows) {
    state.tasks.set(r.id, {
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      department: r.department,
      assignedTo: r.assigned_to,
      status: r.status === "in_progress" || r.status === "review" ? "queued" : r.status,
      result: r.result,
      reviewNotes: r.review_notes,
      attempts: r.attempts,
      createdBy: r.created_by,
      createdAt: new Date(r.created_at).getTime(),
      startedAt: r.started_at ? new Date(r.started_at).getTime() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).getTime() : null,
    });
  }
}

/* ---------- persistence helpers (no-ops without pg) ---------- */
async function persistAgent(a) {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO agents (id,name,role,room,department,color,cto,status,task,current_task_id,last_run_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (id) DO UPDATE SET status=$8, task=$9, current_task_id=$10, last_run_at=$11, updated_at=now()`,
      [a.id, a.name, a.role, a.room, a.department, a.color, a.cto, a.status, a.task,
       a.currentTaskId, a.lastRunAt ? new Date(a.lastRunAt) : null]
    )
    .catch((e) => console.error("[store] persistAgent", e.message));
}
async function persistTask(t) {
  if (!pool) return;
  await pool
    .query(
      `INSERT INTO tasks (id,title,prompt,department,assigned_to,status,result,review_notes,attempts,created_by,created_at,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET title=$2,prompt=$3,department=$4,assigned_to=$5,status=$6,result=$7,review_notes=$8,attempts=$9,started_at=$12,completed_at=$13`,
      [t.id, t.title, t.prompt, t.department, t.assignedTo, t.status, t.result,
       t.reviewNotes, t.attempts, t.createdBy,
       new Date(t.createdAt), t.startedAt ? new Date(t.startedAt) : null,
       t.completedAt ? new Date(t.completedAt) : null]
    )
    .catch((e) => console.error("[store] persistTask", e.message));
}
async function persistEvent(e) {
  if (!pool) return;
  await pool
    .query("INSERT INTO events (kind,text,agent_id,task_id) VALUES ($1,$2,$3,$4)",
      [e.kind, e.text, e.agentId || null, e.taskId || null])
    .catch((err) => console.error("[store] persistEvent", err.message));
}

/* ---------- reads ---------- */
export const getAgent = (id) => state.agents.get(id);
export const getAgents = () => [...state.agents.values()];
export const getWorkers = () => getAgents().filter((a) => !a.cto);
export const getTasks = () => [...state.tasks.values()];
export const getTask = (id) => state.tasks.get(id);

export function snapshot() {
  return {
    agents: getAgents().map(serializeAgent),
    tasks: getTasks().map(serializeTask),
    events: state.events.slice(0, 60),
  };
}

/* ---------- mutations (memory + persist + emit) ---------- */
export function setAgent(id, patch) {
  const a = state.agents.get(id);
  if (!a) return;
  Object.assign(a, patch);
  persistAgent(a);
  bus.emit("agent", serializeAgent(a));
  return a;
}

export function addEvent({ kind, text, agentId = null, taskId = null }) {
  const ev = { id: eventSeq++, ts: Date.now(), kind, text, agentId, taskId };
  state.events.unshift(ev);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  persistEvent(ev);
  bus.emit("event", ev);
  return ev;
}

export function createTask({ title, prompt, department = null, assignedTo = null, createdBy = "user" }) {
  const task = {
    id: randomUUID(),
    title: String(title).slice(0, 120),
    prompt: String(prompt || title).slice(0, 4000),
    department: department || null,
    assignedTo: assignedTo || null,
    status: "queued",
    result: null,
    reviewNotes: null,
    attempts: 0,
    createdBy,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  };
  state.tasks.set(task.id, task);
  persistTask(task);
  bus.emit("task", serializeTask(task));
  pruneTasks();
  return task;
}

// Keep memory bounded: drop the oldest finished tasks once we exceed a cap.
function pruneTasks() {
  const MAX = 150, KEEP = 100;
  if (state.tasks.size <= MAX) return;
  const finished = [...state.tasks.values()]
    .filter((t) => t.status === "done" || t.status === "failed")
    .sort((a, b) => a.createdAt - b.createdAt);
  let toRemove = state.tasks.size - KEEP;
  for (const t of finished) {
    if (toRemove-- <= 0) break;
    state.tasks.delete(t.id);
    if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [t.id]).catch(() => {});
    bus.emit("task", { id: t.id, deleted: true });
  }
}

export function updateTask(id, patch) {
  const t = state.tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  persistTask(t);
  bus.emit("task", serializeTask(t));
  return t;
}

export function deleteTask(id) {
  const t = state.tasks.get(id);
  if (!t) return false;
  state.tasks.delete(id);
  if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [id]).catch(() => {});
  bus.emit("task", { id, deleted: true });
  return true;
}
