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
  documents: [], // newest-first deliverables (durable, not pruned with the queue)
  memory: new Map(), // scope (department) -> rolling knowledge base
  issues: [], // newest-first; system/quality problems raised to the Group CTO
  attachments: new Map(), // id -> {id, taskId, filename, mime, data(base64), size}
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

/* ---------- attachments (files for the agent to work with) ---------- */
export const getAttachments = (taskId) => [...state.attachments.values()].filter((a) => a.taskId === taskId);
export const getAttachment = (id) => state.attachments.get(id);
export const serializeAttachment = (a) => ({ id: a.id, taskId: a.taskId, filename: a.filename, mime: a.mime, size: a.size });
export function createAttachment({ taskId, filename, mime, data, size }) {
  const att = { id: randomUUID(), taskId, filename: filename || "file", mime: mime || "application/octet-stream", data, size: size || 0 };
  state.attachments.set(att.id, att);
  if (pool) pool.query(
    "INSERT INTO attachments (id,task_id,filename,mime,data,size) VALUES ($1,$2,$3,$4,$5,$6)",
    [att.id, att.taskId, att.filename, att.mime, att.data, att.size]
  ).catch((e) => console.error("[store] persistAttachment", e.message));
  return att;
}
function deleteAttachmentsForTask(taskId) {
  for (const a of getAttachments(taskId)) state.attachments.delete(a.id);
  if (pool) pool.query("DELETE FROM attachments WHERE task_id=$1", [taskId]).catch(() => {});
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
  return { ...t, attachments: getAttachments(t.id).map(serializeAttachment) };
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
  if (pool) { await loadTasks(); await loadDocuments(); await loadMemory(); await loadIssues(); await loadAttachments(); }
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
    CREATE TABLE IF NOT EXISTS documents (
      id text PRIMARY KEY, task_id text, title text, prompt text,
      department text, agent_id text, content text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS memory (
      scope text PRIMARY KEY, title text, content text,
      updated_at timestamptz DEFAULT now(), updated_by text
    );
    CREATE TABLE IF NOT EXISTS issues (
      id text PRIMARY KEY, kind text, title text, detail text,
      task_id text, agent_id text, resolved boolean DEFAULT false,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id text PRIMARY KEY, task_id text, filename text, mime text,
      data text, size int, created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
  `);
}

async function loadDocuments() {
  const { rows } = await pool.query("SELECT * FROM documents ORDER BY created_at DESC LIMIT 300");
  for (const r of rows) state.documents.push({
    id: r.id, taskId: r.task_id, title: r.title, prompt: r.prompt,
    department: r.department, agentId: r.agent_id, content: r.content,
    createdAt: new Date(r.created_at).getTime(),
  });
}
async function loadMemory() {
  const { rows } = await pool.query("SELECT * FROM memory");
  for (const r of rows) state.memory.set(r.scope, {
    scope: r.scope, title: r.title, content: r.content,
    updatedAt: new Date(r.updated_at).getTime(), updatedBy: r.updated_by,
  });
}
async function loadIssues() {
  const { rows } = await pool.query("SELECT * FROM issues WHERE resolved=false ORDER BY created_at DESC LIMIT 100");
  for (const r of rows) state.issues.push({
    id: r.id, kind: r.kind, title: r.title, detail: r.detail,
    taskId: r.task_id, agentId: r.agent_id, resolved: r.resolved,
    createdAt: new Date(r.created_at).getTime(),
  });
}
async function loadAttachments() {
  // Load metadata only (data is fetched on demand) for tasks still around.
  const { rows } = await pool.query("SELECT id, task_id, filename, mime, data, size FROM attachments");
  for (const r of rows) state.attachments.set(r.id, { id: r.id, taskId: r.task_id, filename: r.filename, mime: r.mime, data: r.data, size: r.size });
}

async function loadAgents() {
  let rows = [];
  if (pool) rows = (await pool.query("SELECT * FROM agents")).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const def of AGENT_DEFS) {
    const row = byId.get(def.id);
    // Status/task are transient (driven by the live loop). Always boot agents
    // at rest — never restore a mid-task "thinking"/"working" state from the
    // DB, or a restart leaves them stuck with no task actually running.
    const agent = {
      ...def,
      status: def.cto ? "command" : "idle",
      task: def.cto ? "running the office" : "standing by",
      currentTaskId: null,
      lastRunAt: row?.last_run_at ? new Date(row.last_run_at).getTime() : null,
    };
    state.agents.set(def.id, agent);
    if (pool) await persistAgent(agent);
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
async function persistDocument(d) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO documents (id,task_id,title,prompt,department,agent_id,content,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
    [d.id, d.taskId, d.title, d.prompt, d.department, d.agentId, d.content, new Date(d.createdAt)]
  ).catch((e) => console.error("[store] persistDocument", e.message));
}
async function persistMemory(m) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO memory (scope,title,content,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (scope) DO UPDATE SET title=$2, content=$3, updated_at=$4, updated_by=$5`,
    [m.scope, m.title, m.content, new Date(m.updatedAt), m.updatedBy]
  ).catch((e) => console.error("[store] persistMemory", e.message));
}
async function persistIssue(i) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO issues (id,kind,title,detail,task_id,agent_id,resolved,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET resolved=$7`,
    [i.id, i.kind, i.title, i.detail, i.taskId, i.agentId, i.resolved, new Date(i.createdAt)]
  ).catch((e) => console.error("[store] persistIssue", e.message));
}

/* ---------- reads ---------- */
export const getAgent = (id) => state.agents.get(id);
export const getAgents = () => [...state.agents.values()];
export const getWorkers = () => getAgents().filter((a) => !a.cto);
export const getTasks = () => [...state.tasks.values()];
export const getTask = (id) => state.tasks.get(id);

const serializeDocMeta = (d) => ({
  id: d.id, taskId: d.taskId, title: d.title, department: d.department,
  agentId: d.agentId, createdAt: d.createdAt, snippet: (d.content || "").slice(0, 160),
});
const serializeMemory = (m) => ({ scope: m.scope, title: m.title, content: m.content, updatedAt: m.updatedAt, updatedBy: m.updatedBy });
const serializeIssue = (i) => ({ id: i.id, kind: i.kind, title: i.title, detail: (i.detail || "").slice(0, 600), taskId: i.taskId, agentId: i.agentId, createdAt: i.createdAt });

export function snapshot() {
  return {
    agents: getAgents().map(serializeAgent),
    tasks: getTasks().map(serializeTask),
    events: state.events.slice(0, 60),
    documents: state.documents.slice(0, 60).map(serializeDocMeta),
    memory: [...state.memory.values()].map(serializeMemory),
    issues: getIssues().map(serializeIssue),
  };
}

/* ---------- issues (raised to the Group CTO) ---------- */
export const getIssues = () => state.issues.filter((i) => !i.resolved);
export function createIssue({ kind, title, detail, taskId, agentId }) {
  // Dedupe: one open issue per kind+title (don't spam 100 identical quota errors).
  const existing = state.issues.find((i) => !i.resolved && i.kind === kind && i.title === title);
  if (existing) return existing;
  const issue = { id: randomUUID(), kind, title, detail: detail || "", taskId: taskId || null, agentId: agentId || null, resolved: false, createdAt: Date.now() };
  state.issues.unshift(issue);
  if (state.issues.length > 200) state.issues.length = 200;
  persistIssue(issue);
  bus.emit("issue", serializeIssue(issue));
  return issue;
}
export function resolveIssue(id) {
  const idx = state.issues.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  state.issues.splice(idx, 1); // dismiss = delete permanently
  if (pool) pool.query("DELETE FROM issues WHERE id=$1", [id]).catch(() => {});
  bus.emit("issue", { id, resolved: true });
  return true;
}
function deleteIssuesForTask(taskId) {
  const removed = state.issues.filter((i) => i.taskId === taskId);
  if (!removed.length) return;
  state.issues = state.issues.filter((i) => i.taskId !== taskId);
  if (pool) pool.query("DELETE FROM issues WHERE task_id=$1", [taskId]).catch(() => {});
  for (const i of removed) bus.emit("issue", { id: i.id, resolved: true });
}
export function clearIssues() {
  const n = state.issues.length;
  state.issues = [];
  if (pool) pool.query("DELETE FROM issues").catch(() => {});
  bus.emit("issuesReset", []);
  return n;
}

/* ---------- documents (deliverables) ---------- */
export const getDocument = (id) => state.documents.find((d) => d.id === id);
export function createDocument({ taskId, title, prompt, department, agentId, content }) {
  const doc = {
    id: randomUUID(), taskId: taskId || null, title, prompt: prompt || "",
    department: department || null, agentId: agentId || null, content: content || "",
    createdAt: Date.now(),
  };
  state.documents.unshift(doc);
  if (state.documents.length > 400) state.documents.length = 400;
  persistDocument(doc);
  bus.emit("document", serializeDocMeta(doc));
  return doc;
}

export function deleteDocument(id) {
  const i = state.documents.findIndex((d) => d.id === id);
  if (i < 0) return false;
  state.documents.splice(i, 1);
  if (pool) pool.query("DELETE FROM documents WHERE id=$1", [id]).catch(() => {});
  bus.emit("document", { id, deleted: true });
  return true;
}

/* ---------- memory (rolling knowledge base per department) ---------- */
export const getMemoryText = (scope) => state.memory.get(scope)?.content || "";
export function deleteMemory(scope) {
  if (!state.memory.has(scope)) return false;
  state.memory.delete(scope);
  if (pool) pool.query("DELETE FROM memory WHERE scope=$1", [scope]).catch(() => {});
  bus.emit("memory", { scope, deleted: true });
  return true;
}
export function upsertMemory(scope, { title, content, updatedBy }) {
  let m = state.memory.get(scope);
  if (!m) { m = { scope, title: title || scope, content: content || "", updatedAt: Date.now(), updatedBy: updatedBy || "system" }; state.memory.set(scope, m); }
  else { if (title) m.title = title; m.content = content; m.updatedAt = Date.now(); m.updatedBy = updatedBy || m.updatedBy; }
  if (m.content.length > 4000) m.content = m.content.slice(m.content.length - 4000); // keep recent
  persistMemory(m);
  bus.emit("memory", serializeMemory(m));
  return m;
}
export function appendMemory(scope, line, title, updatedBy) {
  const cur = getMemoryText(scope);
  return upsertMemory(scope, { title, content: (cur ? cur + "\n" : "") + line, updatedBy });
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
  deleteAttachmentsForTask(id);
  deleteIssuesForTask(id);
  if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [id]).catch(() => {});
  bus.emit("task", { id, deleted: true });
  return true;
}

// Bulk clear. Never removes tasks an agent is actively working (in_progress/
// review). Broadcasts the remaining list so clients replace in one frame.
export function clearTasks(scope = "done") {
  const match = (t) => {
    if (t.status === "in_progress" || t.status === "review") return false;
    if (scope === "auto") return t.createdBy !== "user";
    if (scope === "done") return t.status === "done" || t.status === "failed";
    if (scope === "all") return true;
    return false;
  };
  const ids = getTasks().filter(match).map((t) => t.id);
  for (const id of ids) {
    state.tasks.delete(id);
    deleteAttachmentsForTask(id);
    deleteIssuesForTask(id);
    if (pool) pool.query("DELETE FROM tasks WHERE id=$1", [id]).catch(() => {});
  }
  if (ids.length) bus.emit("tasksReset", getTasks().map(serializeTask));
  return ids.length;
}
